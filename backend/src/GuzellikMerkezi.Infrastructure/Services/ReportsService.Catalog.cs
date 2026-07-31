using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Paket &amp; hizmet detay raporu — "hangi paket, kim sattı, kim uyguladı".
///
/// KAYNAKLAR
///  • Satış  → CustomerAccount (dönem = SoldAtUtc). Tutar, satışın seans ağırlığına göre paket/hizmet
///    kalemlerine dağıtılır; bir satışta birden çok paket olabilir (adisyondan çoklu satış).
///  • Seans bakiyesi → CustomerPackageSession. ServicePackageId = Guid.Empty ⇒ paketsiz tekil hizmet satışı.
///  • Uygulama (kim yaptı) → dönemde TAMAMLANAN randevular. Randevu (müşteri, hizmet) çiftiyle
///    müşterinin o hizmeti içeren paketine bağlanır; paket yoksa yalnız hizmet uygulaması sayılır.
/// </summary>
public sealed partial class ReportsService
{
    private sealed record SessionRow(
        Guid AccountId,
        Guid CustomerId,
        Guid PackageId,
        Guid ServiceId,
        string ServiceName,
        string? ServiceCategory,
        string? ServiceSubCategory,
        int TotalSessions,
        int UsedSessions,
        DateTime CreatedAtUtc);

    /// <summary>Bir paket/hizmet kaleminin dönem boyunca biriken sayaçları.</summary>
    private sealed class CatalogAccumulator
    {
        public string Name = string.Empty;
        public string Category = "Kategorisiz";
        public string? SubCategory;
        public readonly HashSet<Guid> Customers = [];
        public int SoldCount;
        public decimal GrossAmount;
        public decimal CollectedAmount;
        public int SessionsTotal;
        public int SessionsUsed;
        public int SessionsInPeriod;
        public decimal SessionRevenue;
        /// <summary>Uygulayan personelin prim maliyeti — hizmet kârlılığı için ciro'dan düşülür.</summary>
        public decimal CommissionCost;
        public int CancelledCount;
        public decimal CancelledAmount;
        /// <summary>Satıcı anahtarı (personel Id ya da kullanıcı Id) → satış sayaçları.</summary>
        public readonly Dictionary<Guid, PartyAcc> Sellers = [];
        /// <summary>Uygulayan personel Id → seans sayaçları.</summary>
        public readonly Dictionary<Guid, PartyAcc> Performers = [];
    }

    /// <summary>Satıcı/uygulayıcı kırılımındaki tek kişi.</summary>
    private sealed class PartyAcc
    {
        public int Count;
        public readonly HashSet<Guid> Customers = [];
        public decimal Amount;
    }

    public async Task<Result<CatalogReportDto>> GetCatalogAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default)
    {
        var (from, to, compareFrom, compareTo, _) = Normalize(range);

        var accounts = await LoadAccountsAsync(tenantId, cancellationToken);
        var sessions = await LoadSessionsAsync(tenantId, cancellationToken);
        var paidByAccount = await LoadPaidByAccountAsync(tenantId, cancellationToken);
        var packageMeta = await LoadPackageMetaAsync(tenantId, cancellationToken);
        var serviceMeta = await LoadServiceMetaAsync(tenantId, cancellationToken);
        var sellers = await LoadSellerLookupAsync(tenantId, cancellationToken);
        var commissionRates = (await _db.StaffMembers.AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .Select(s => new { s.Id, s.CommissionRate })
                .ToListAsync(cancellationToken))
            .GroupBy(s => s.Id)
            .ToDictionary(g => g.Key, g => g.First().CommissionRate ?? 0m);

        var sessionsByAccount = sessions.GroupBy(s => s.AccountId).ToDictionary(g => g.Key, g => g.ToList());
        // (müşteri, hizmet) → o hizmeti içeren paketler; randevuyu doğru pakete bağlamak için.
        var packagesByCustomerService = sessions
            .Where(s => s.PackageId != Guid.Empty)
            .GroupBy(s => (s.CustomerId, s.ServiceId))
            .ToDictionary(g => g.Key, g => g.OrderBy(x => x.CreatedAtUtc).Select(x => x.PackageId).Distinct().ToList());

        var ctx = new CatalogContext(accounts, sessionsByAccount, packagesByCustomerService, paidByAccount, packageMeta, serviceMeta, commissionRates, sellers);

        var current = await BuildCatalogAsync(tenantId, ctx, from, to, cancellationToken);
        var previous = compareFrom.HasValue && compareTo.HasValue
            ? await BuildCatalogAsync(tenantId, ctx, compareFrom.Value, compareTo.Value, cancellationToken)
            : null;

        var packages = current.Packages
            .Select(kv => ToCatalogDto(kv.Key, kv.Value, sellers))
            .OrderByDescending(p => p.GrossAmount).ThenByDescending(p => p.SoldCount)
            .ToList();
        var services = current.Services
            .Select(kv => ToCatalogDto(kv.Key, kv.Value, sellers))
            .OrderByDescending(s => s.GrossAmount).ThenByDescending(s => s.SessionsInPeriod)
            .ToList();

        return Result<CatalogReportDto>.Success(new CatalogReportDto(
            packages,
            services,
            SliceByCategory(packages),
            SliceByCategory(services),
            // Kurum geneli "kim sattı" / "kim uyguladı" sıralaması — paket + tekil hizmet satışları birlikte.
            MergeSellers(current.Services.Values, sellers),
            MergePerformers(current.Services.Values, sellers),
            Totals(current.Packages.Values),
            previous is null ? EmptyTotals : Totals(previous.Packages.Values),
            Totals(current.Services.Values),
            previous is null ? EmptyTotals : Totals(previous.Services.Values)));
    }

    /// <summary>Dönemden bağımsız, bir kez yüklenen ortak veri (iki dönem için de kullanılır).</summary>
    private sealed record CatalogContext(
        List<AccountRow> Accounts,
        Dictionary<Guid, List<SessionRow>> SessionsByAccount,
        Dictionary<(Guid CustomerId, Guid ServiceId), List<Guid>> PackagesByCustomerService,
        Dictionary<Guid, decimal> PaidByAccount,
        Dictionary<Guid, CatalogMeta> PackageMeta,
        Dictionary<Guid, CatalogMeta> ServiceMeta,
        /// <summary>StaffMember.Id → komisyon oranı (%); prim maliyeti bundan hesaplanır.</summary>
        Dictionary<Guid, decimal> CommissionRates,
        SellerLookup Sellers);

    private sealed record CatalogMeta(string Name, string? Category, string? SubCategory);

    private sealed record CatalogSnapshot(Dictionary<Guid, CatalogAccumulator> Packages, Dictionary<Guid, CatalogAccumulator> Services);

    private async Task<CatalogSnapshot> BuildCatalogAsync(Guid tenantId, CatalogContext ctx, DateTime from, DateTime to, CancellationToken ct)
    {
        var packages = new Dictionary<Guid, CatalogAccumulator>();
        var services = new Dictionary<Guid, CatalogAccumulator>();

        CatalogAccumulator Pkg(Guid id)
        {
            if (packages.TryGetValue(id, out var found)) return found;
            var meta = ctx.PackageMeta.TryGetValue(id, out var m) ? m : new CatalogMeta("Paket", null, null);
            return packages[id] = new CatalogAccumulator { Name = meta.Name, Category = CategoryOrDefault(meta.Category), SubCategory = meta.SubCategory };
        }

        CatalogAccumulator Svc(Guid id, SessionRow? sample)
        {
            if (services.TryGetValue(id, out var found)) return found;
            var meta = ctx.ServiceMeta.TryGetValue(id, out var m)
                ? m
                : new CatalogMeta(sample?.ServiceName ?? "Hizmet", sample?.ServiceCategory, sample?.ServiceSubCategory);
            return services[id] = new CatalogAccumulator { Name = meta.Name, Category = CategoryOrDefault(meta.Category), SubCategory = meta.SubCategory };
        }

        // ---------- 1) Dönemde yapılan satışlar → adet, tutar, tahsilat, seans bakiyesi ----------
        foreach (var account in ctx.Accounts.Where(a => a.SoldAt >= from && a.SoldAt < to))
        {
            var accSessions = ctx.SessionsByAccount.TryGetValue(account.Id, out var list) ? list : [];
            var paidRatio = account.TotalAmount > 0
                ? Math.Min(1m, (ctx.PaidByAccount.TryGetValue(account.Id, out var paid) ? paid : 0m) / account.TotalAmount)
                : 0m;
            var sellerKey = ctx.Sellers.KeyFor(account.SoldByStaffMemberId, account.CreatedBy);
            // İptal edilen satış ana hesaplara girmez; yalnız "İptal Edilen" sayacına yazılır.
            var cancelled = account.CancelledAtUtc != null;

            if (accSessions.Count == 0)
            {
                // Seans satırı yoksa satış ancak doğrudan paket bağıyla atfedilebilir (manuel cari değilse).
                if (account.ServicePackageId is not { } directId || directId == Guid.Empty) continue;
                var bucket = Pkg(directId);
                if (cancelled)
                {
                    bucket.CancelledCount++;
                    bucket.CancelledAmount += account.TotalAmount;
                    continue;
                }
                bucket.SoldCount++;
                bucket.Customers.Add(account.CustomerId);
                bucket.GrossAmount += account.TotalAmount;
                bucket.CollectedAmount += account.TotalAmount * paidRatio;
                Bump(bucket.Sellers, sellerKey, account.CustomerId, account.TotalAmount);
                continue;
            }

            var totalWeight = Math.Max(1, accSessions.Sum(s => Math.Max(1, s.TotalSessions)));

            // Paket kırılımı: aynı satıştaki her paket ayrı bir "satılan paket örneği"dir.
            foreach (var group in accSessions.Where(s => s.PackageId != Guid.Empty).GroupBy(s => s.PackageId))
            {
                var bucket = Pkg(group.Key);
                var share = account.TotalAmount * group.Sum(s => Math.Max(1, s.TotalSessions)) / totalWeight;
                if (cancelled)
                {
                    bucket.CancelledCount++;
                    bucket.CancelledAmount += share;
                    continue;
                }
                bucket.SoldCount++;
                bucket.Customers.Add(account.CustomerId);
                bucket.GrossAmount += share;
                bucket.CollectedAmount += share * paidRatio;
                bucket.SessionsTotal += group.Sum(s => s.TotalSessions);
                bucket.SessionsUsed += group.Sum(s => s.UsedSessions);
                Bump(bucket.Sellers, sellerKey, account.CustomerId, share);
            }

            // Hizmet kırılımı: paketten gelen ve tekil satılan seansların TAMAMI sayılır.
            foreach (var group in accSessions.GroupBy(s => s.ServiceId))
            {
                var bucket = Svc(group.Key, group.First());
                var share = account.TotalAmount * group.Sum(s => Math.Max(1, s.TotalSessions)) / totalWeight;
                if (cancelled)
                {
                    bucket.CancelledCount++;
                    bucket.CancelledAmount += share;
                    continue;
                }
                bucket.SoldCount++;
                bucket.Customers.Add(account.CustomerId);
                bucket.GrossAmount += share;
                bucket.CollectedAmount += share * paidRatio;
                bucket.SessionsTotal += group.Sum(s => s.TotalSessions);
                bucket.SessionsUsed += group.Sum(s => s.UsedSessions);
                Bump(bucket.Sellers, sellerKey, account.CustomerId, share);
            }
        }

        // ---------- 2) Dönemde UYGULANAN seanslar → "kim yaptı" ----------
        var completed = (await LoadAppointmentsAsync(tenantId, from, to, ct))
            .Where(a => a.Status == AppointmentStatus.Completed)
            .ToList();

        foreach (var appt in completed)
        {
            // Prim maliyeti: uygulayan personelin komisyon oranı (tanımsızsa 0).
            var rate = ctx.CommissionRates.TryGetValue(appt.StaffMemberId, out var r) ? r : 0m;
            var commission = appt.Price * rate / 100m;

            var svcBucket = Svc(appt.ServiceDefinitionId, null);
            svcBucket.SessionsInPeriod++;
            svcBucket.SessionRevenue += appt.Price;
            svcBucket.CommissionCost += commission;
            Bump(svcBucket.Performers, appt.StaffMemberId, appt.CustomerId, appt.Price);

            if (ctx.PackagesByCustomerService.TryGetValue((appt.CustomerId, appt.ServiceDefinitionId), out var pkgIds) && pkgIds.Count > 0)
            {
                var pkgBucket = Pkg(pkgIds[0]);
                pkgBucket.SessionsInPeriod++;
                pkgBucket.SessionRevenue += appt.Price;
                pkgBucket.CommissionCost += commission;
                Bump(pkgBucket.Performers, appt.StaffMemberId, appt.CustomerId, appt.Price);
            }
        }

        return new CatalogSnapshot(packages, services);
    }

    private static void Bump(Dictionary<Guid, PartyAcc> map, Guid key, Guid customerId, decimal amount)
    {
        if (!map.TryGetValue(key, out var acc)) map[key] = acc = new PartyAcc();
        acc.Count++;
        acc.Customers.Add(customerId);
        acc.Amount += amount;
    }

    // ------------------------------------------------------------------ DTO üretimi ---

    private static CatalogItemReportDto ToCatalogDto(Guid id, CatalogAccumulator a, SellerLookup lookup) =>
        new(
            id,
            a.Name,
            a.Category,
            a.SubCategory,
            a.SoldCount,
            a.Customers.Count,
            Round(a.GrossAmount),
            Round(a.CollectedAmount),
            Round(Math.Max(0m, a.GrossAmount - a.CollectedAmount)),
            a.SessionsTotal,
            a.SessionsUsed,
            Math.Max(0, a.SessionsTotal - a.SessionsUsed),
            a.SessionsInPeriod,
            Round(a.SessionRevenue),
            Round(a.CommissionCost),
            Round(a.SessionRevenue - a.CommissionCost),
            a.CancelledCount,
            Round(a.CancelledAmount),
            a.Sellers
                .Select(kv => new ReportSellerDto(
                    lookup.IsStaff(kv.Key) ? kv.Key : null, lookup.NameFor(kv.Key),
                    kv.Value.Count, kv.Value.Customers.Count, Round(kv.Value.Amount)))
                .OrderByDescending(s => s.Amount)
                .ToList(),
            a.Performers
                .Select(kv => new ReportPerformerDto(
                    lookup.IsStaff(kv.Key) ? kv.Key : null, lookup.NameFor(kv.Key),
                    kv.Value.Count, kv.Value.Customers.Count, Round(kv.Value.Amount)))
                .OrderByDescending(p => p.SessionCount)
                .ToList());

    private static readonly CatalogTotalsDto EmptyTotals = new(0, 0, 0m, 0m, 0m, 0, 0, 0, 0, 0m, 0m, 0m, 0, 0m);

    private static CatalogTotalsDto Totals(IEnumerable<CatalogAccumulator> items)
    {
        var list = items.ToList();
        var customers = new HashSet<Guid>();
        foreach (var i in list) customers.UnionWith(i.Customers);
        var gross = list.Sum(i => i.GrossAmount);
        var collected = list.Sum(i => i.CollectedAmount);
        var total = list.Sum(i => i.SessionsTotal);
        var used = list.Sum(i => i.SessionsUsed);
        return new CatalogTotalsDto(
            list.Sum(i => i.SoldCount),
            customers.Count,
            Round(gross),
            Round(collected),
            Round(Math.Max(0m, gross - collected)),
            total,
            used,
            Math.Max(0, total - used),
            list.Sum(i => i.SessionsInPeriod),
            Round(list.Sum(i => i.SessionRevenue)),
            Round(list.Sum(i => i.CommissionCost)),
            Round(list.Sum(i => i.SessionRevenue) - list.Sum(i => i.CommissionCost)),
            list.Sum(i => i.CancelledCount),
            Round(list.Sum(i => i.CancelledAmount)));
    }

    private static List<ReportSliceDto> SliceByCategory(IEnumerable<CatalogItemReportDto> items) =>
        items.GroupBy(i => i.Category)
            .Select(g => new ReportSliceDto(g.Key, g.Key, Round(g.Sum(x => x.GrossAmount)), g.Sum(x => x.SoldCount)))
            .OrderByDescending(s => s.Amount)
            .ToList();

    /// <summary>Tüm kalemlerdeki satıcıları tek listede toplar (kurum geneli "kim sattı" sıralaması).</summary>
    private static List<ReportSellerDto> MergeSellers(IEnumerable<CatalogAccumulator> items, SellerLookup lookup)
    {
        var merged = new Dictionary<Guid, PartyAcc>();
        foreach (var item in items)
        {
            foreach (var (key, acc) in item.Sellers)
            {
                if (!merged.TryGetValue(key, out var target)) merged[key] = target = new PartyAcc();
                target.Count += acc.Count;
                target.Amount += acc.Amount;
                target.Customers.UnionWith(acc.Customers);
            }
        }
        return merged
            .Select(kv => new ReportSellerDto(
                lookup.IsStaff(kv.Key) ? kv.Key : null, lookup.NameFor(kv.Key),
                kv.Value.Count, kv.Value.Customers.Count, Round(kv.Value.Amount)))
            .OrderByDescending(s => s.Amount)
            .ToList();
    }

    /// <summary>Tüm kalemlerdeki uygulayıcıları tek listede toplar ("kim yaptı" sıralaması).</summary>
    private static List<ReportPerformerDto> MergePerformers(IEnumerable<CatalogAccumulator> items, SellerLookup lookup)
    {
        var merged = new Dictionary<Guid, PartyAcc>();
        foreach (var item in items)
        {
            foreach (var (key, acc) in item.Performers)
            {
                if (!merged.TryGetValue(key, out var target)) merged[key] = target = new PartyAcc();
                target.Count += acc.Count;
                target.Amount += acc.Amount;
                target.Customers.UnionWith(acc.Customers);
            }
        }
        return merged
            .Select(kv => new ReportPerformerDto(
                lookup.IsStaff(kv.Key) ? kv.Key : null, lookup.NameFor(kv.Key),
                kv.Value.Count, kv.Value.Customers.Count, Round(kv.Value.Amount)))
            .OrderByDescending(p => p.SessionCount)
            .ToList();
    }

    // ------------------------------------------------------------------ yükleyiciler ---

    private async Task<List<SessionRow>> LoadSessionsAsync(Guid tenantId, CancellationToken ct)
    {
        var rows = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new
            {
                s.CustomerAccountId,
                s.CustomerId,
                s.ServicePackageId,
                s.ServiceDefinitionId,
                ServiceName = s.ServiceDefinition != null ? s.ServiceDefinition.Name : null,
                Category = s.ServiceDefinition != null ? s.ServiceDefinition.Category : null,
                SubCategory = s.ServiceDefinition != null ? s.ServiceDefinition.SubCategory : null,
                s.TotalSessions,
                s.UsedSessions,
                s.CreatedAtUtc,
            })
            .ToListAsync(ct);

        var live = rows.Select(s => new SessionRow(
            s.CustomerAccountId, s.CustomerId, s.ServicePackageId, s.ServiceDefinitionId,
            string.IsNullOrWhiteSpace(s.ServiceName) ? "Hizmet" : s.ServiceName,
            s.Category, s.SubCategory, s.TotalSessions, s.UsedSessions, s.CreatedAtUtc)).ToList();

        // İptal edilen satışın seansları silindi; paket/hizmet kırılımı yedekten beslenir.
        live.AddRange((await LoadCancelledArchiveAsync(tenantId, crossBranch: false, ct)).Sessions);
        return live;
    }

    /// <summary>
    /// Cari başına toplam tahsilat. Normalde kapsam CustomerAccounts'un global (tenant+şube)
    /// filtresinden gelir; şube KARŞILAŞTIRMASI bu filtreyi atladığı için orada alt sorgu
    /// kullanılmaz (sonuç yalnızca sözlükten okunur, fazla satır zarar vermez).
    /// </summary>
    private async Task<Dictionary<Guid, decimal>> LoadPaidByAccountAsync(
        Guid tenantId, CancellationToken ct, bool ignoreBranchFilter = false)
    {
        var query = _db.AccountPayments.AsNoTracking().AsQueryable();
        if (!ignoreBranchFilter)
        {
            query = query.Where(p => _db.CustomerAccounts.Any(a => a.Id == p.CustomerAccountId && a.TenantId == tenantId));
        }

        var rows = await query
            .GroupBy(p => p.CustomerAccountId)
            .Select(g => new { AccountId = g.Key, Paid = g.Sum(x => x.Amount) })
            .ToListAsync(ct);
        var result = rows.ToDictionary(r => r.AccountId, r => r.Paid);

        // İptal edilen satışın tahsilatı canlı tabloda yok; katalog/paket raporunda "ne kadar
        // tahsil edilmişti" sorusu kalıcı defterden yanıtlanır (satır silindi ≠ para alınmadı).
        var archived = await ArchivedPaymentQuery(tenantId, ignoreBranchFilter)
            .GroupBy(p => p.OriginalAccountId)
            .Select(g => new { AccountId = g.Key, Paid = g.Sum(x => x.Amount) })
            .ToListAsync(ct);
        foreach (var row in archived)
            result[row.AccountId] = (result.TryGetValue(row.AccountId, out var cur) ? cur : 0m) + row.Paid;

        return result;
    }

    private async Task<Dictionary<Guid, CatalogMeta>> LoadPackageMetaAsync(Guid tenantId, CancellationToken ct)
    {
        var rows = await _db.ServicePackages.AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .Select(p => new { p.Id, p.Name, p.Category, p.SubCategory })
            .ToListAsync(ct);
        return rows.GroupBy(p => p.Id)
            .ToDictionary(g => g.Key, g => new CatalogMeta(g.First().Name, g.First().Category, g.First().SubCategory));
    }

    private async Task<Dictionary<Guid, CatalogMeta>> LoadServiceMetaAsync(Guid tenantId, CancellationToken ct)
    {
        var rows = await _db.ServiceDefinitions.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.Name, s.Category, s.SubCategory })
            .ToListAsync(ct);
        return rows.GroupBy(s => s.Id)
            .ToDictionary(g => g.Key, g => new CatalogMeta(g.First().Name, g.First().Category, g.First().SubCategory));
    }
}

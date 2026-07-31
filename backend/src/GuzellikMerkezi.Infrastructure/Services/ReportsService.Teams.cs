using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Personel performansı ve şube karşılaştırması.
///
/// ŞUBE KAPSAMI — Operasyonel tablolar EF global query filter'ıyla üst menüde seçili şubeye daralır.
/// Şubeleri KARŞILAŞTIRMAK için bu filtre yalnızca kurum yöneticisi (ve platform admin) adına
/// bilinçli olarak atlanır: yönetici zaten tüm şubelerini görmeye yetkilidir ve tek şube seçiliyken
/// "karşılaştırma" tek satıra düşerdi. Personel/şube müdürü için filtre olduğu gibi kalır.
/// </summary>
public sealed partial class ReportsService
{
    /// <summary>Kullanıcı kurumun tüm şubelerini görebiliyor mu?</summary>
    private bool CanSeeAllBranches =>
        _currentUser.IsPlatformAdmin || _currentUser.Role == UserRole.InstitutionOwner;

    // =======================================================================
    // Personel performansı
    // =======================================================================

    public async Task<Result<StaffReportDto>> GetStaffAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default)
    {
        var (from, to, compareFrom, compareTo, _) = Normalize(range);

        var staff = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName, s.Title, s.BranchId, s.CommissionRate, s.IsActive })
            .ToListAsync(cancellationToken);

        var branches = await _db.Branches.AsNoTracking()
            .Where(b => b.TenantId == tenantId)
            .Select(b => new { b.Id, b.Name })
            .ToListAsync(cancellationToken);
        var branchNames = branches.GroupBy(b => b.Id).ToDictionary(g => g.Key, g => g.First().Name);

        var accounts = await LoadAccountsAsync(tenantId, cancellationToken);
        var sellers = await LoadSellerLookupAsync(tenantId, cancellationToken);

        var current = await BuildStaffSliceAsync(tenantId, accounts, sellers, from, to, cancellationToken);
        var previous = compareFrom.HasValue && compareTo.HasValue
            ? await BuildStaffSliceAsync(tenantId, accounts, sellers, compareFrom.Value, compareTo.Value, cancellationToken)
            : null;

        var rows = staff
            .Select(s =>
            {
                var cur = current.For(s.Id);
                var prev = previous?.For(s.Id);
                return new StaffReportRowDto(
                    s.Id,
                    s.FullName,
                    string.IsNullOrWhiteSpace(s.Title) ? "Personel" : s.Title,
                    s.BranchId,
                    branchNames.TryGetValue(s.BranchId, out var bn) ? bn : null,
                    cur.AppointmentCount,
                    cur.CompletedCount,
                    cur.CancelledCount,
                    cur.NoShowCount,
                    cur.Customers.Count,
                    Round(cur.ServiceRevenue),
                    Round(cur.SalesAmount),
                    cur.SalesCount,
                    Round(cur.CommissionEarned),
                    Round(cur.CommissionPaid),
                    s.CommissionRate ?? 0m,
                    cur.WorkedMinutes,
                    cur.RatingCount > 0 ? Math.Round(cur.RatingSum / (double)cur.RatingCount, 2) : 0d,
                    cur.RatingCount,
                    Round(prev?.ServiceRevenue ?? 0m),
                    Round(prev?.SalesAmount ?? 0m),
                    prev?.CompletedCount ?? 0);
            })
            // Kayıtsız (silinmiş) personelin geçmiş verisi kaybolmasın diye pasifler de listelenir;
            // hiç hareketi olmayan pasifler sona düşer.
            .Where(r => r.AppointmentCount > 0 || r.SalesAmount > 0 || r.CommissionEarned > 0 || staff.First(s => s.Id == r.StaffMemberId).IsActive)
            .OrderByDescending(r => r.ServiceRevenue + r.SalesAmount)
            .ThenByDescending(r => r.CompletedCount)
            .ToList();

        return Result<StaffReportDto>.Success(new StaffReportDto(
            rows,
            Round(rows.Sum(r => r.ServiceRevenue)),
            Round(rows.Sum(r => r.SalesAmount)),
            Round(rows.Sum(r => r.CommissionEarned)),
            rows.Sum(r => r.AppointmentCount),
            rows.Sum(r => r.CompletedCount),
            rows.Sum(r => r.WorkedMinutes),
            Round(rows.Sum(r => r.PreviousServiceRevenue)),
            Round(rows.Sum(r => r.PreviousSalesAmount)),
            rows.Sum(r => r.PreviousCompletedCount)));
    }

    private sealed class StaffAcc
    {
        public int AppointmentCount;
        public int CompletedCount;
        public int CancelledCount;
        public int NoShowCount;
        public int WorkedMinutes;
        public decimal ServiceRevenue;
        public decimal SalesAmount;
        public int SalesCount;
        public decimal CommissionEarned;
        public decimal CommissionPaid;
        public int RatingCount;
        public double RatingSum;
        public readonly HashSet<Guid> Customers = [];
    }

    private sealed class StaffSlice
    {
        /// <summary>Hiç hareketi olmayan personel için paylaşılan boş kova (yalnız okunur).</summary>
        private static readonly StaffAcc Empty = new();
        public readonly Dictionary<Guid, StaffAcc> Map = [];

        public StaffAcc For(Guid id) => Map.TryGetValue(id, out var acc) ? acc : Empty;

        public StaffAcc Get(Guid id)
        {
            if (Map.TryGetValue(id, out var acc)) return acc;
            return Map[id] = new StaffAcc();
        }
    }

    private async Task<StaffSlice> BuildStaffSliceAsync(
        Guid tenantId, List<AccountRow> accounts, SellerLookup sellers, DateTime from, DateTime to, CancellationToken ct)
    {
        var slice = new StaffSlice();

        foreach (var appt in await LoadAppointmentsAsync(tenantId, from, to, ct))
        {
            var acc = slice.Get(appt.StaffMemberId);
            acc.AppointmentCount++;
            acc.Customers.Add(appt.CustomerId);
            switch (appt.Status)
            {
                case AppointmentStatus.Completed:
                    acc.CompletedCount++;
                    acc.ServiceRevenue += appt.Price;
                    acc.WorkedMinutes += appt.DurationMinutes;
                    break;
                case AppointmentStatus.Cancelled:
                    acc.CancelledCount++;
                    break;
                case AppointmentStatus.NoShow:
                    acc.NoShowCount++;
                    break;
            }
        }

        // Satışlar — "kim sattı" düşümüyle aynı kural (personel seçilmemişse kaydı oluşturan).
        foreach (var account in accounts.Where(a => a.CancelledAtUtc == null && a.SoldAt >= from && a.SoldAt < to))
        {
            var key = sellers.KeyFor(account.SoldByStaffMemberId, account.CreatedBy);
            if (!sellers.IsStaff(key)) continue;   // yönetici satışları personel karnesine yazılmaz
            var acc = slice.Get(key);
            acc.SalesAmount += account.TotalAmount;
            acc.SalesCount++;
        }

        var commissions = await _db.StaffCommissions.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.EarnedAtUtc >= from && c.EarnedAtUtc < to)
            .Select(c => new { c.StaffMemberId, c.Amount, c.IsPaid })
            .ToListAsync(ct);
        foreach (var c in commissions)
        {
            var acc = slice.Get(c.StaffMemberId);
            acc.CommissionEarned += c.Amount;
            if (c.IsPaid) acc.CommissionPaid += c.Amount;
        }

        var ratings = await _db.AppointmentRatings.AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.SubmittedAtUtc != null && r.SubmittedAtUtc >= from && r.SubmittedAtUtc < to)
            .Select(r => new { r.StaffMemberId, r.Stars })
            .ToListAsync(ct);
        foreach (var r in ratings)
        {
            var acc = slice.Get(r.StaffMemberId);
            acc.RatingCount++;
            acc.RatingSum += r.Stars;
        }

        return slice;
    }

    // =======================================================================
    // Şube karşılaştırması
    // =======================================================================

    public async Task<Result<BranchReportDto>> GetBranchesAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default)
    {
        var (from, to, compareFrom, compareTo, granularity) = Normalize(range);
        var crossBranch = CanSeeAllBranches;

        var branches = await _db.Branches.AsNoTracking()
            .Where(b => b.TenantId == tenantId)
            .Select(b => new { b.Id, b.Name, b.City })
            .ToListAsync(cancellationToken);

        var staffCounts = (await StaffQuery(tenantId, crossBranch)
                .Select(s => new { s.BranchId, s.IsActive })
                .ToListAsync(cancellationToken))
            .Where(s => s.IsActive)
            .GroupBy(s => s.BranchId)
            .ToDictionary(g => g.Key, g => g.Count());

        var accounts = await BranchAccountsAsync(tenantId, crossBranch, cancellationToken);
        var accountsById = accounts.ToDictionary(a => a.Id);

        var current = await BuildBranchSliceAsync(tenantId, crossBranch, accounts, accountsById, from, to, granularity, cancellationToken);
        var previous = compareFrom.HasValue && compareTo.HasValue
            ? await BuildBranchSliceAsync(tenantId, crossBranch, accounts, accountsById, compareFrom.Value, compareTo.Value, granularity, cancellationToken)
            : null;

        // Açık alacak: kalan taksit (dönemden bağımsız anlık bakiye).
        var receivables = await BranchReceivablesAsync(tenantId, accountsById, cancellationToken, crossBranch);

        // Şubesiz (BranchId = null) hareketler için sanal satır — para kaybolmasın.
        var unassigned = Guid.Empty;
        var ids = branches.Select(b => b.Id).ToList();
        if (current.Map.ContainsKey(unassigned) || previous?.Map.ContainsKey(unassigned) == true) ids.Add(unassigned);

        var rows = ids
            .Select(id =>
            {
                var cur = current.For(id);
                var prev = previous?.For(id);
                var meta = branches.FirstOrDefault(b => b.Id == id);
                var net = cur.Income - cur.Expense;
                return new BranchReportRowDto(
                    id,
                    meta?.Name ?? "Şube atanmamış",
                    meta?.City ?? "—",
                    Round(cur.Income),
                    Round(cur.Expense),
                    Round(net),
                    Round(prev?.Income ?? 0m),
                    Round(prev?.Expense ?? 0m),
                    Round((prev?.Income ?? 0m) - (prev?.Expense ?? 0m)),
                    Round(cur.Sales),
                    Round(receivables.TryGetValue(id, out var r) ? r : 0m),
                    cur.AppointmentCount,
                    cur.CompletedCount,
                    cur.Customers.Count,
                    cur.NewCustomers,
                    staffCounts.TryGetValue(id, out var sc) ? sc : 0,
                    cur.PaymentCount > 0 ? Round(cur.Income / cur.PaymentCount) : 0m,
                    cur.Income > 0 ? Round(net / cur.Income * 100m) : 0m,
                    cur.BuildSeries());
            })
            .OrderByDescending(r => r.Net)
            .ToList();

        return Result<BranchReportDto>.Success(new BranchReportDto(
            rows,
            Round(rows.Sum(r => r.Income)),
            Round(rows.Sum(r => r.Expense)),
            Round(rows.Sum(r => r.Net)),
            Round(rows.Sum(r => r.PreviousIncome)),
            Round(rows.Sum(r => r.PreviousExpense)),
            Round(rows.Sum(r => r.PreviousNet)),
            granularity,
            !crossBranch && _currentUser.BranchId is not null));
    }

    private sealed class BranchAcc
    {
        public decimal Income;
        public decimal Expense;
        public decimal Sales;
        public int PaymentCount;
        public int AppointmentCount;
        public int CompletedCount;
        public int NewCustomers;
        public readonly HashSet<Guid> Customers = [];
        /// <summary>Kova anahtarı → (gelir, gider, satış, randevu, tamamlanan).</summary>
        public readonly Dictionary<string, decimal[]> Buckets = [];
        public readonly Dictionary<string, string> BucketLabels = [];

        public void Bucketize(string key, string label, int index, decimal value)
        {
            if (!Buckets.TryGetValue(key, out var arr)) Buckets[key] = arr = new decimal[5];
            arr[index] += value;
            BucketLabels[key] = label;
        }

        public List<ReportPointDto> BuildSeries()
        {
            return Buckets
                .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => new ReportPointDto(
                    kv.Key, BucketLabels.TryGetValue(kv.Key, out var l) ? l : kv.Key,
                    Math.Round(kv.Value[0], 2), Math.Round(kv.Value[1], 2), Math.Round(kv.Value[0] - kv.Value[1], 2),
                    Math.Round(kv.Value[2], 2), (int)kv.Value[3], (int)kv.Value[4], 0))
                .ToList();
        }
    }

    private sealed class BranchSlice
    {
        /// <summary>Hiç hareketi olmayan şube için paylaşılan boş kova (yalnız okunur).</summary>
        private static readonly BranchAcc Empty = new();
        public readonly Dictionary<Guid, BranchAcc> Map = [];

        public BranchAcc For(Guid id) => Map.TryGetValue(id, out var acc) ? acc : Empty;

        /// <summary>BranchId null ⇒ "şube atanmamış" sanal kovası (Guid.Empty).</summary>
        public BranchAcc Get(Guid? id)
        {
            var key = id ?? Guid.Empty;
            if (Map.TryGetValue(key, out var acc)) return acc;
            return Map[key] = new BranchAcc();
        }
    }

    private async Task<BranchSlice> BuildBranchSliceAsync(
        Guid tenantId,
        bool crossBranch,
        List<AccountRow> accounts,
        Dictionary<Guid, AccountRow> accountsById,
        DateTime from,
        DateTime to,
        string granularity,
        CancellationToken ct)
    {
        var slice = new BranchSlice();

        // Tahsilat (gelir)
        var payments = await _db.AccountPayments.AsNoTracking()
            .Where(p => p.OccurredAtUtc >= from && p.OccurredAtUtc < to)
            .Select(p => new { p.CustomerAccountId, p.Amount, p.OccurredAtUtc })
            .ToListAsync(ct);
        foreach (var p in payments)
        {
            if (!accountsById.TryGetValue(p.CustomerAccountId, out var account)) continue;
            var acc = slice.Get(account.BranchId);
            acc.Income += p.Amount;
            acc.PaymentCount++;
            var (key, label) = Bucket(p.OccurredAtUtc, granularity);
            acc.Bucketize(key, label, 0, p.Amount);
        }

        // Gider
        var expenses = await ExpenseQuery(tenantId, crossBranch)
            .Where(e => e.OccurredAtUtc >= from && e.OccurredAtUtc < to)
            .Select(e => new { e.BranchId, e.Amount, e.OccurredAtUtc })
            .ToListAsync(ct);
        foreach (var e in expenses)
        {
            var acc = slice.Get(e.BranchId);
            acc.Expense += e.Amount;
            var (key, label) = Bucket(e.OccurredAtUtc, granularity);
            acc.Bucketize(key, label, 1, e.Amount);
        }

        // Satış
        foreach (var account in accounts.Where(a => a.CancelledAtUtc == null && a.SoldAt >= from && a.SoldAt < to))
        {
            var acc = slice.Get(account.BranchId);
            acc.Sales += account.TotalAmount;
            var (key, label) = Bucket(account.SoldAt, granularity);
            acc.Bucketize(key, label, 2, account.TotalAmount);
        }

        // Randevu
        var appointments = await AppointmentQuery(tenantId, crossBranch)
            .Where(a => a.StartUtc >= from && a.StartUtc < to)
            .Select(a => new { a.BranchId, a.CustomerId, a.Status, a.StartUtc })
            .ToListAsync(ct);
        foreach (var a in appointments)
        {
            var acc = slice.Get(a.BranchId);
            acc.AppointmentCount++;
            acc.Customers.Add(a.CustomerId);
            var (key, label) = Bucket(a.StartUtc, granularity);
            acc.Bucketize(key, label, 3, 1);
            if (a.Status == AppointmentStatus.Completed)
            {
                acc.CompletedCount++;
                acc.Bucketize(key, label, 4, 1);
            }
        }

        // Yeni müşteri
        var newCustomers = await CustomerQuery(tenantId, crossBranch)
            .Where(c => c.CreatedAtUtc >= from && c.CreatedAtUtc < to)
            .Select(c => new { c.BranchId })
            .ToListAsync(ct);
        foreach (var c in newCustomers) slice.Get(c.BranchId).NewCustomers++;

        return slice;
    }

    /// <summary>
    /// Şube başına kalan taksit (açık alacak). <paramref name="ignoreBranchFilter"/> şube
    /// karşılaştırmasında true'dur: <paramref name="accountsById"/> tüm şubeleri kapsadığı için
    /// alt sorgudaki şube filtresi kaldırılmalı, yoksa diğer şubelerin taksitleri 0 görünürdü.
    /// </summary>
    private async Task<Dictionary<Guid, decimal>> BranchReceivablesAsync(
        Guid tenantId, Dictionary<Guid, AccountRow> accountsById, CancellationToken ct, bool ignoreBranchFilter = false)
    {
        var query = _db.Installments.AsNoTracking()
            .Where(i => i.Status != InstallmentStatus.Cancelled);
        if (!ignoreBranchFilter)
        {
            query = query.Where(i => _db.CustomerAccounts.Any(a => a.Id == i.CustomerAccountId && a.TenantId == tenantId));
        }

        var installments = await query
            .GroupBy(i => i.CustomerAccountId)
            .Select(g => new { AccountId = g.Key, Planned = g.Sum(x => x.Amount) })
            .ToListAsync(ct);

        var paid = await LoadPaidByAccountAsync(tenantId, ct, ignoreBranchFilter);
        var result = new Dictionary<Guid, decimal>();
        foreach (var row in installments)
        {
            if (!accountsById.TryGetValue(row.AccountId, out var account) || account.CancelledAtUtc != null) continue;
            var remaining = Math.Max(0m, row.Planned - (paid.TryGetValue(row.AccountId, out var p) ? p : 0m));
            var key = account.BranchId ?? Guid.Empty;
            result[key] = (result.TryGetValue(key, out var cur) ? cur : 0m) + remaining;
        }
        return result;
    }

    // ------------------------------------------------- şube filtresini atlayan sorgular ---
    // IgnoreQueryFilters soft-delete filtresini de kapatır → !IsDeleted elle eklenir.

    private IQueryable<Appointment> AppointmentQuery(Guid tenantId, bool crossBranch) => crossBranch
        ? _db.Appointments.AsNoTracking().IgnoreQueryFilters().Where(a => !a.IsDeleted && a.TenantId == tenantId)
        : _db.Appointments.AsNoTracking().Where(a => a.TenantId == tenantId);

    private IQueryable<BusinessExpense> ExpenseQuery(Guid tenantId, bool crossBranch) => crossBranch
        ? _db.BusinessExpenses.AsNoTracking().IgnoreQueryFilters().Where(e => !e.IsDeleted && e.TenantId == tenantId)
        : _db.BusinessExpenses.AsNoTracking().Where(e => e.TenantId == tenantId);

    private IQueryable<Customer> CustomerQuery(Guid tenantId, bool crossBranch) => crossBranch
        ? _db.Customers.AsNoTracking().IgnoreQueryFilters().Where(c => !c.IsDeleted && c.TenantId == tenantId)
        : _db.Customers.AsNoTracking().Where(c => c.TenantId == tenantId);

    private IQueryable<StaffMember> StaffQuery(Guid tenantId, bool crossBranch) => crossBranch
        ? _db.StaffMembers.AsNoTracking().IgnoreQueryFilters().Where(s => !s.IsDeleted && s.TenantId == tenantId)
        : _db.StaffMembers.AsNoTracking().Where(s => s.TenantId == tenantId);

    private async Task<List<AccountRow>> BranchAccountsAsync(Guid tenantId, bool crossBranch, CancellationToken ct)
    {
        if (!crossBranch) return await LoadAccountsAsync(tenantId, ct);

        var rows = await _db.CustomerAccounts.AsNoTracking().IgnoreQueryFilters()
            .Where(a => !a.IsDeleted && a.TenantId == tenantId)
            .Select(a => new
            {
                a.Id, a.BranchId, a.CustomerId, a.ServicePackageId, a.Name, a.TotalAmount,
                a.SoldAtUtc, a.CreatedAtUtc, a.CancelledAtUtc, a.SoldByStaffMemberId, a.CreatedBy,
            })
            .ToListAsync(ct);

        var live = rows.Select(a => new AccountRow(
                a.Id, a.BranchId, a.CustomerId, a.ServicePackageId, a.Name ?? string.Empty, a.TotalAmount,
                EffectiveSoldAt(a.SoldAtUtc, a.CreatedAtUtc), a.CancelledAtUtc, a.SoldByStaffMemberId, a.CreatedBy))
            .ToList();

        // İptal edilenler canlı tabloda yok (arşive taşındı); "İptal Edilen" kartları için eklenir.
        live.AddRange((await LoadCancelledArchiveAsync(tenantId, crossBranch: true, ct)).Accounts);
        return live;
    }
}

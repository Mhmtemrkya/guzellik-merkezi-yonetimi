using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Raporlar sayfasının tüm hesaplamaları. Sınıf parça (partial) dosyalara bölünmüştür:
/// bu dosya ortak yardımcıları + Genel Bakış'ı, diğerleri katalog / personel-şube /
/// müşteri-stok bloklarını taşır.
///
/// TASARIM KURALLARI
///  • Gelir = tahsilat (AccountPayment). Gider = BusinessExpense. Net = gelir − gider.
///    Kasa sayfası ve pano ile AYNI kaynak — rakamlar sayfalar arası tutarlı olsun diye.
///  • Satış (ciro değil) = CustomerAccount.TotalAmount; dönem satışın GERÇEK tarihine göre süzülür
///    (SoldAtUtc; eski kayıtlarda CreatedAtUtc'ye düşer — bkz. LegacySoldAtThreshold).
///  • İptal edilmiş satışlar ana hesaplara girmez, ayrı sayılır.
///  • Şube kapsamı EF global query filter'ından gelir; yalnız şube KARŞILAŞTIRMASI bunu bilerek
///    atlar (kurum yöneticisi tüm şubelerini görmeye yetkilidir).
///  • MySQL sağlayıcısı Guid listesi .Contains() çeviremez → önce ToListAsync, sonra bellekte süz.
/// </summary>
public sealed partial class ReportsService : IReportsService
{
    private readonly GuzellikDbContext _db;
    private readonly ICurrentUser _currentUser;

    /// <summary>Türkiye sabit UTC+3 — yaz saati yok. Yerel gün/ay kırılımı bu offsetle yapılır.</summary>
    private static readonly TimeSpan TrOffset = TimeSpan.FromHours(3);

    /// <summary>SoldAtUtc kolonu eklenmeden önceki cariler bu eşiğin altında kalır (0001-01-01).</summary>
    private static readonly DateTime LegacySoldAtThreshold = new(1900, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public ReportsService(GuzellikDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    // =======================================================================
    // Ortak yardımcılar
    // =======================================================================

    /// <summary>
    /// Query'den gelen tarihi güvenli biçimde UTC'ye çevirir. ASP.NET bağlayıcısı "…Z" değerini
    /// bazen Local olarak üretir; Unspecified gelirse UTC varsayılır.
    /// </summary>
    private static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    private static (DateTime From, DateTime To, DateTime? CompareFrom, DateTime? CompareEnd, string Granularity) Normalize(ReportRangeRequest range)
    {
        var from = ToUtc(range.FromUtc);
        var to = ToUtc(range.ToUtc);
        if (to <= from) to = from.AddDays(1);

        DateTime? compareFrom = null;
        DateTime? compareTo = null;
        if (range.CompareFromUtc.HasValue && range.CompareToUtc.HasValue)
        {
            compareFrom = ToUtc(range.CompareFromUtc.Value);
            compareTo = ToUtc(range.CompareToUtc.Value);
            if (compareTo <= compareFrom) compareTo = compareFrom.Value.AddDays(1);
        }

        return (from, to, compareFrom, compareTo, ResolveGranularity(from, to, range.Granularity));
    }

    /// <summary>Kova genişliği: istenmişse o, yoksa dönem uzunluğundan (≤45 gün → gün, ≤26 hafta → hafta, ötesi ay).</summary>
    private static string ResolveGranularity(DateTime from, DateTime to, string? requested)
    {
        var wanted = requested?.Trim().ToLowerInvariant();
        if (wanted is "day" or "week" or "month") return wanted;
        var days = (to - from).TotalDays;
        if (days <= 45) return "day";
        if (days <= 190) return "week";
        return "month";
    }

    /// <summary>UTC anı → yerel kova anahtarı (sıralanabilir) ve ekran etiketi.</summary>
    private static (string Key, string Label) Bucket(DateTime utc, string granularity)
    {
        var local = utc + TrOffset;
        switch (granularity)
        {
            case "month":
                return ($"{local.Year:0000}-{local.Month:00}", $"{TrMonths[local.Month - 1]} {local.Year}");
            case "week":
            {
                // Pazartesi başlangıçlı hafta.
                var offset = ((int)local.DayOfWeek + 6) % 7;
                var monday = local.Date.AddDays(-offset);
                return ($"{monday:yyyy-MM-dd}", $"{monday.Day:00} {TrMonthsShort[monday.Month - 1]}");
            }
            default:
                return ($"{local:yyyy-MM-dd}", $"{local.Day:00} {TrMonthsShort[local.Month - 1]}");
        }
    }

    private static readonly string[] TrMonths =
        ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

    private static readonly string[] TrMonthsShort =
        ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

    /// <summary>Dönemi kovalara böler; veri olmayan kovalar da 0 değerle döner (grafikte boşluk olmasın).</summary>
    private static List<(string Key, string Label)> BuildBuckets(DateTime from, DateTime to, string granularity)
    {
        var result = new List<(string, string)>();
        var seen = new HashSet<string>();
        var cursor = (from + TrOffset).Date;
        var end = (to + TrOffset);
        // Güvenlik freni: 400 kovadan fazlası hem grafiği hem yanıtı şişirir.
        var guard = 0;
        while (cursor < end && guard++ < 400)
        {
            var (key, label) = Bucket(cursor - TrOffset, granularity);
            if (seen.Add(key)) result.Add((key, label));
            cursor = granularity switch
            {
                "month" => new DateTime(cursor.Year, cursor.Month, 1).AddMonths(1),
                "week" => cursor.AddDays(7),
                _ => cursor.AddDays(1),
            };
        }
        return result;
    }

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>Satışın döneme düşen tarihi: SoldAtUtc yoksa (eski kayıt) CreatedAtUtc.</summary>
    private static DateTime EffectiveSoldAt(DateTime soldAtUtc, DateTime createdAtUtc) =>
        soldAtUtc < LegacySoldAtThreshold ? createdAtUtc : soldAtUtc;

    // ----------------------------------------------------------------- veri yükleyiciler ---

    /// <summary>Rapor boyunca tekrar tekrar gereken cari (satış) özeti.</summary>
    private sealed record AccountRow(
        Guid Id,
        Guid? BranchId,
        Guid CustomerId,
        Guid? ServicePackageId,
        string Name,
        decimal TotalAmount,
        DateTime SoldAt,
        DateTime? CancelledAtUtc,
        Guid? SoldByStaffMemberId,
        Guid? CreatedBy);

    private async Task<List<AccountRow>> LoadAccountsAsync(Guid tenantId, CancellationToken ct)
    {
        var rows = await _db.CustomerAccounts.AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .Select(a => new
            {
                a.Id,
                a.BranchId,
                a.CustomerId,
                a.ServicePackageId,
                a.Name,
                a.TotalAmount,
                a.SoldAtUtc,
                a.CreatedAtUtc,
                a.CancelledAtUtc,
                a.SoldByStaffMemberId,
                a.CreatedBy,
            })
            .ToListAsync(ct);

        var live = rows.Select(a => new AccountRow(
                a.Id, a.BranchId, a.CustomerId, a.ServicePackageId, a.Name ?? string.Empty, a.TotalAmount,
                EffectiveSoldAt(a.SoldAtUtc, a.CreatedAtUtc), a.CancelledAtUtc, a.SoldByStaffMemberId, a.CreatedBy))
            .ToList();

        // İptal edilenler canlı tabloda yok (arşive taşındı); "İptal Edilen" kartları için eklenir.
        live.AddRange((await LoadCancelledArchiveAsync(tenantId, crossBranch: false, ct)).Accounts);
        return live;
    }

    private sealed record PaymentRow(Guid AccountId, Guid? BranchId, Guid CustomerId, decimal Amount, string? Method, DateTime OccurredAtUtc);

    /// <summary>
    /// Dönemdeki tahsilatlar. AccountPayment tablosunda kiracı/şube kolonu yoktur; kapsam bağlı
    /// olduğu cariden gelir — böylece şube filtresi otomatik uygulanır.
    /// </summary>
    private async Task<List<PaymentRow>> LoadPaymentsAsync(Guid tenantId, IReadOnlyDictionary<Guid, AccountRow> accounts, DateTime from, DateTime to, CancellationToken ct)
    {
        var raw = await _db.AccountPayments.AsNoTracking()
            .Where(p => p.OccurredAtUtc >= from && p.OccurredAtUtc < to)
            .Select(p => new { p.CustomerAccountId, p.Amount, p.Method, p.OccurredAtUtc })
            .ToListAsync(ct);

        var result = new List<PaymentRow>(raw.Count);
        foreach (var p in raw)
        {
            if (!accounts.TryGetValue(p.CustomerAccountId, out var acc)) continue;
            result.Add(new PaymentRow(acc.Id, acc.BranchId, acc.CustomerId, p.Amount, p.Method, p.OccurredAtUtc));
        }

        // İptal edilen satışın tahsilatları canlı tabloda yok (cari silindi) ama para geçmişte
        // kasaya girmiştir — kalıcı defterden eklenir, iade kısmı gider tarafında düşülür.
        var archived = await _db.ArchivedSalePayments.AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.OccurredAtUtc >= from && p.OccurredAtUtc < to)
            .Select(p => new { p.OriginalAccountId, p.BranchId, p.CustomerId, p.Amount, p.Method, p.OccurredAtUtc })
            .ToListAsync(ct);
        result.AddRange(archived.Select(p =>
            new PaymentRow(p.OriginalAccountId, p.BranchId, p.CustomerId, p.Amount, p.Method, p.OccurredAtUtc)));

        return result;
    }

    private sealed record ExpenseRow(Guid? BranchId, ExpenseCategory Category, decimal Amount, DateTime OccurredAtUtc);

    private async Task<List<ExpenseRow>> LoadExpensesAsync(Guid tenantId, DateTime from, DateTime to, CancellationToken ct)
    {
        var rows = await _db.BusinessExpenses.AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.OccurredAtUtc >= from && e.OccurredAtUtc < to)
            .Select(e => new { e.BranchId, e.Category, e.Amount, e.OccurredAtUtc })
            .ToListAsync(ct);
        var result = rows.Select(e => new ExpenseRow(e.BranchId, e.Category, e.Amount, e.OccurredAtUtc)).ToList();

        // MÜŞTERİ İADELERİ: satış iptalinde geri ödenen para da giderdir. "Other" kategorisine
        // yazılır — ayrı bir ExpenseCategory eklemek mevcut kırılım/etiket setini bozardı.
        var refunds = await _db.RefundTransactions.AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.RefundedAtUtc >= from && r.RefundedAtUtc < to)
            .Select(r => new { r.BranchId, r.Amount, r.RefundedAtUtc })
            .ToListAsync(ct);
        result.AddRange(refunds.Select(r =>
            new ExpenseRow(r.BranchId, ExpenseCategory.Other, r.Amount, r.RefundedAtUtc)));

        return result;
    }

    private sealed record ApptRow(
        Guid Id,
        Guid BranchId,
        Guid CustomerId,
        Guid StaffMemberId,
        Guid ServiceDefinitionId,
        AppointmentStatus Status,
        decimal Price,
        DateTime StartUtc,
        int DurationMinutes);

    private async Task<List<ApptRow>> LoadAppointmentsAsync(Guid tenantId, DateTime from, DateTime to, CancellationToken ct)
    {
        var rows = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.StartUtc >= from && a.StartUtc < to)
            .Select(a => new
            {
                a.Id,
                a.BranchId,
                a.CustomerId,
                a.StaffMemberId,
                a.ServiceDefinitionId,
                a.Status,
                a.Price,
                a.StartUtc,
                a.EndUtc,
            })
            .ToListAsync(ct);

        return rows.Select(a => new ApptRow(
                a.Id, a.BranchId, a.CustomerId, a.StaffMemberId, a.ServiceDefinitionId, a.Status, a.Price, a.StartUtc,
                (int)Math.Max(0, (a.EndUtc - a.StartUtc).TotalMinutes)))
            .ToList();
    }

    /// <summary>Satıcı adı çözümlemesi — personel seçilmemiş satışlar kaydı oluşturan kullanıcıya düşer.</summary>
    private sealed record SellerLookup(
        Dictionary<Guid, string> StaffNames,
        Dictionary<Guid, Guid> StaffIdByUserId,
        Dictionary<Guid, string> UserLabels)
    {
        public Guid KeyFor(Guid? soldByStaffMemberId, Guid? createdBy)
        {
            if (soldByStaffMemberId is { } staffId && staffId != Guid.Empty) return staffId;
            if (createdBy is not { } userId || userId == Guid.Empty) return Guid.Empty;
            return StaffIdByUserId.TryGetValue(userId, out var mapped) ? mapped : userId;
        }

        public string NameFor(Guid key) =>
            key == Guid.Empty ? "Belirtilmemiş"
            : StaffNames.TryGetValue(key, out var staffName) ? staffName
            : UserLabels.TryGetValue(key, out var label) ? label
            : "Belirtilmemiş";

        public bool IsStaff(Guid key) => StaffNames.ContainsKey(key);
    }

    private async Task<SellerLookup> LoadSellerLookupAsync(Guid tenantId, CancellationToken ct)
    {
        var staff = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName, s.TenantUserId })
            .ToListAsync(ct);
        var users = await _db.TenantUsers.AsNoTracking()
            .Where(u => u.TenantId == tenantId
                        && (u.Role == UserRole.InstitutionOwner || u.Role == UserRole.BranchManager || u.Role == UserRole.Staff))
            .Select(u => new { u.Id, u.FullName, u.Role })
            .ToListAsync(ct);

        var staffNames = staff.GroupBy(s => s.Id).ToDictionary(g => g.Key, g => g.First().FullName);
        var staffIdByUserId = staff
            .Where(s => s.TenantUserId is { } uid && uid != Guid.Empty)
            .GroupBy(s => s.TenantUserId!.Value)
            .ToDictionary(g => g.Key, g => g.First().Id);

        var userLabels = new Dictionary<Guid, string>();
        foreach (var user in users)
        {
            var name = string.IsNullOrWhiteSpace(user.FullName) ? null : user.FullName.Trim();
            var title = user.Role switch
            {
                UserRole.InstitutionOwner => "Kurum Yöneticisi",
                UserRole.BranchManager => "Şube Yöneticisi",
                _ => null,
            };
            var label = title is null ? name : name is null ? title : $"{title} ({name})";
            if (label is not null) userLabels[user.Id] = label;
        }

        return new SellerLookup(staffNames, staffIdByUserId, userLabels);
    }

    // =======================================================================
    // Genel Bakış
    // =======================================================================

    public async Task<Result<ReportSummaryDto>> GetSummaryAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default)
    {
        var (from, to, compareFrom, compareTo, granularity) = Normalize(range);

        var accounts = await LoadAccountsAsync(tenantId, cancellationToken);
        var accountsById = accounts.ToDictionary(a => a.Id);

        var current = await ComputeCoreAsync(tenantId, accounts, accountsById, from, to, granularity, cancellationToken);
        var previous = compareFrom.HasValue && compareTo.HasValue
            ? await ComputeCoreAsync(tenantId, accounts, accountsById, compareFrom.Value, compareTo.Value, granularity, cancellationToken)
            : null;

        decimal Prev(Func<CorePeriod, decimal> pick) => previous is null ? 0m : pick(previous);

        var metrics = new List<ReportMetricDto>
        {
            new("income", "Toplam Gelir", Round(current.Income), Round(Prev(p => p.Income)), "currency", $"{current.PaymentCount} tahsilat"),
            new("expense", "Toplam Gider", Round(current.Expense), Round(Prev(p => p.Expense)), "currency", $"{current.ExpenseCount} gider"),
            new("net", "Net Kâr", Round(current.Income - current.Expense), Round(Prev(p => p.Income - p.Expense)), "currency",
                current.Income - current.Expense >= 0 ? "kârda" : "zararda"),
            new("margin", "Kâr Marjı", current.Income > 0 ? Round((current.Income - current.Expense) / current.Income * 100m) : 0m,
                previous is { Income: > 0 } ? Round((previous.Income - previous.Expense) / previous.Income * 100m) : 0m, "percent", "gelire oranla net"),
            new("sales", "Satış Tutarı", Round(current.Sales), Round(Prev(p => p.Sales)), "currency", $"{current.SalesCount} satış"),
            new("appointments", "Randevu", current.AppointmentCount, Prev(p => p.AppointmentCount), "count", $"{current.CompletedCount} tamamlandı"),
            new("completed", "Tamamlanan İşlem", current.CompletedCount, Prev(p => p.CompletedCount), "count", "uygulanan seans"),
            new("occupancy", "Tamamlanma Oranı",
                current.AppointmentCount > 0 ? Round((decimal)current.CompletedCount / current.AppointmentCount * 100m) : 0m,
                previous is { AppointmentCount: > 0 } ? Round((decimal)previous.CompletedCount / previous.AppointmentCount * 100m) : 0m,
                "percent", "randevuya oranla"),
            new("activeCustomers", "Aktif Müşteri", current.ActiveCustomers, Prev(p => p.ActiveCustomers), "count", "dönemde işlem gören"),
            new("newCustomers", "Yeni Müşteri", current.NewCustomers, Prev(p => p.NewCustomers), "count", "ilk kez kayıt olan"),
            new("avgTicket", "Ortalama Sepet",
                current.PaymentCount > 0 ? Round(current.Income / current.PaymentCount) : 0m,
                previous is { PaymentCount: > 0 } ? Round(previous.Income / previous.PaymentCount) : 0m, "currency", "tahsilat başına"),
            new("revenuePerCustomer", "Müşteri Başına Ciro",
                current.ActiveCustomers > 0 ? Round(current.Income / current.ActiveCustomers) : 0m,
                previous is { ActiveCustomers: > 0 } ? Round(previous.Income / previous.ActiveCustomers) : 0m, "currency", "aktif müşteri başına"),
        };

        return Result<ReportSummaryDto>.Success(new ReportSummaryDto(
            from, to, compareFrom, compareTo, granularity,
            metrics,
            current.Series,
            previous?.Series ?? [],
            current.PaymentMethods,
            current.ExpenseCategories,
            current.RevenueSources,
            current.AppointmentStatuses,
            current.Heatmap));
    }

    /// <summary>Bir dönemin çekirdek büyüklükleri — mevcut ve karşılaştırma dönemi için ayrı ayrı çalışır.</summary>
    private sealed record CorePeriod(
        decimal Income,
        decimal Expense,
        decimal Sales,
        int SalesCount,
        int PaymentCount,
        int ExpenseCount,
        int AppointmentCount,
        int CompletedCount,
        int ActiveCustomers,
        int NewCustomers,
        IReadOnlyList<ReportPointDto> Series,
        IReadOnlyList<ReportSliceDto> PaymentMethods,
        IReadOnlyList<ReportSliceDto> ExpenseCategories,
        IReadOnlyList<ReportSliceDto> RevenueSources,
        IReadOnlyList<ReportSliceDto> AppointmentStatuses,
        IReadOnlyList<ReportHeatCellDto> Heatmap);

    private async Task<CorePeriod> ComputeCoreAsync(
        Guid tenantId,
        List<AccountRow> accounts,
        Dictionary<Guid, AccountRow> accountsById,
        DateTime from,
        DateTime to,
        string granularity,
        CancellationToken ct)
    {
        var payments = await LoadPaymentsAsync(tenantId, accountsById, from, to, ct);
        var expenses = await LoadExpensesAsync(tenantId, from, to, ct);
        var appointments = await LoadAppointmentsAsync(tenantId, from, to, ct);

        var periodSales = accounts
            .Where(a => a.CancelledAtUtc == null && a.SoldAt >= from && a.SoldAt < to)
            .ToList();

        var newCustomers = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.CreatedAtUtc >= from && c.CreatedAtUtc < to)
            .Select(c => new { c.Id, c.CreatedAtUtc })
            .ToListAsync(ct);

        // --- zaman serisi -----------------------------------------------------
        var buckets = BuildBuckets(from, to, granularity);
        var order = buckets.Select((b, i) => (b.Key, Index: i)).ToDictionary(x => x.Key, x => x.Index);
        var acc = buckets.Select(b => new
        {
            b.Key,
            b.Label,
            Value = new decimal[3],   // 0 gelir, 1 gider, 2 satış
            Counts = new int[3],      // 0 randevu, 1 tamamlanan, 2 yeni müşteri
        }).ToList();

        void Add(DateTime utc, int valueIndex, decimal amount)
        {
            var key = Bucket(utc, granularity).Key;
            if (order.TryGetValue(key, out var i)) acc[i].Value[valueIndex] += amount;
        }
        void Bump(DateTime utc, int countIndex)
        {
            var key = Bucket(utc, granularity).Key;
            if (order.TryGetValue(key, out var i)) acc[i].Counts[countIndex]++;
        }

        foreach (var p in payments) Add(p.OccurredAtUtc, 0, p.Amount);
        foreach (var e in expenses) Add(e.OccurredAtUtc, 1, e.Amount);
        foreach (var s in periodSales) Add(s.SoldAt, 2, s.TotalAmount);
        foreach (var a in appointments)
        {
            Bump(a.StartUtc, 0);
            if (a.Status == AppointmentStatus.Completed) Bump(a.StartUtc, 1);
        }
        foreach (var c in newCustomers) Bump(c.CreatedAtUtc, 2);

        var series = acc.Select(x => new ReportPointDto(
            x.Key, x.Label,
            Round(x.Value[0]), Round(x.Value[1]), Round(x.Value[0] - x.Value[1]), Round(x.Value[2]),
            x.Counts[0], x.Counts[1], x.Counts[2])).ToList();

        // --- dağılımlar -------------------------------------------------------
        var paymentMethods = payments
            .GroupBy(p => NormalizeMethod(p.Method))
            .Select(g => new ReportSliceDto(g.Key, MethodLabel(g.Key), Round(g.Sum(x => x.Amount)), g.Count()))
            .OrderByDescending(s => s.Amount)
            .ToList();

        var expenseCategories = expenses
            .GroupBy(e => e.Category)
            .Select(g => new ReportSliceDto(g.Key.ToString(), ExpenseLabel(g.Key), Round(g.Sum(x => x.Amount)), g.Count()))
            .OrderByDescending(s => s.Amount)
            .ToList();

        var appointmentStatuses = appointments
            .GroupBy(a => a.Status)
            .Select(g => new ReportSliceDto(g.Key.ToString(), StatusLabel(g.Key), Round(g.Sum(x => x.Price)), g.Count()))
            .OrderByDescending(s => s.Count)
            .ToList();

        // Ciro kaynağı: onaylı adisyonların borç yazan kalemleri (tahsilat/indirim/paketten kullanım hariç).
        var adisyonItems = await _db.Adisyonlar.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Status == AdisyonStatus.Approved
                        && (a.ApprovedAtUtc ?? a.CreatedAtUtc) >= from && (a.ApprovedAtUtc ?? a.CreatedAtUtc) < to)
            .SelectMany(a => a.Items.Select(i => new { i.Type, i.Quantity, i.UnitPrice, i.CoveredByPackage }))
            .ToListAsync(ct);

        var revenueSources = adisyonItems
            .Where(i => i.Type is AdisyonItemType.Service or AdisyonItemType.Product or AdisyonItemType.PackageSale or AdisyonItemType.Extra)
            .Where(i => !i.CoveredByPackage)
            .GroupBy(i => i.Type)
            .Select(g => new ReportSliceDto(g.Key.ToString(), ItemTypeLabel(g.Key), Round(g.Sum(x => x.Quantity * x.UnitPrice)), g.Count()))
            .OrderByDescending(s => s.Amount)
            .ToList();

        // Yoğunluk haritası — yerel gün/saat.
        var heatmap = appointments
            .Select(a => a.StartUtc + TrOffset)
            .GroupBy(l => new { Day = ((int)l.DayOfWeek + 6) % 7, l.Hour })
            .Select(g => new ReportHeatCellDto(g.Key.Day, g.Key.Hour, g.Count()))
            .ToList();

        return new CorePeriod(
            payments.Sum(p => p.Amount),
            expenses.Sum(e => e.Amount),
            periodSales.Sum(s => s.TotalAmount),
            periodSales.Count,
            payments.Count,
            expenses.Count,
            appointments.Count,
            appointments.Count(a => a.Status == AppointmentStatus.Completed),
            appointments.Select(a => a.CustomerId).Distinct().Count(),
            newCustomers.Count,
            series, paymentMethods, expenseCategories, revenueSources, appointmentStatuses, heatmap);
    }

    // ----------------------------------------------------------------- etiketler ---

    private static string NormalizeMethod(string? method)
    {
        if (string.IsNullOrWhiteSpace(method)) return "unknown";
        var m = method.ToLowerInvariant();
        if (m.Contains("cash") || m.Contains("nakit")) return "cash";
        if (m.Contains("card") || m.Contains("kart")) return "card";
        if (m.Contains("transfer") || m.Contains("eft") || m.Contains("havale") || m.Contains("bank")) return "transfer";
        if (m.Contains("check") || m.Contains("çek")) return "check";
        // "Adisyon" bir ödeme yöntemi DEĞİL. Adisyon tahsilatları yöntem kırılımıyla yazılmadan
        // önceki sürümde tek "Adisyon" kaydına düşüyordu; o kayıtlarda gerçek yöntem hiç
        // saklanmamış. Yöntemmiş gibi göstermek yerine "kaydedilmemiş" kovasına alınır.
        if (m == "adisyon" || m == "adisyon tahsilatı") return "unknown";
        return m;
    }

    /// <summary>Türkçe büyük harf kuralı (i → İ) — serbest metin yöntem adları için.</summary>
    private static readonly System.Globalization.CultureInfo TrCulture =
        System.Globalization.CultureInfo.GetCultureInfo("tr-TR");

    private static string MethodLabel(string key) => key switch
    {
        "cash" => "Nakit",
        "card" => "Kredi Kartı",
        "transfer" => "Havale / EFT",
        "check" => "Çek",
        // Yöntemi hiç yazılmamış tahsilatlar (eski adisyon kayıtları dâhil) — uydurma yapılmaz.
        "unknown" => "Yöntem Kaydedilmemiş",
        // Adisyon kalemindeki yöntem alanı serbest metindir; sık görülenler adlandırılır,
        // gerisi ham bırakılmaz — baş harfi büyütülerek okunur hâle getirilir.
        "giftcard" or "gift" or "hediye" => "Hediye Çeki",
        "loyalty" or "puan" or "sadakat" => "Sadakat Puanı",
        _ => key.Length == 0 ? "Diğer" : string.Concat(key[..1].ToUpper(TrCulture), key[1..]),
    };

    private static string ExpenseLabel(ExpenseCategory category) => category switch
    {
        ExpenseCategory.Salary => "Personel Maaşı",
        ExpenseCategory.Tax => "Vergi / SGK",
        ExpenseCategory.Rent => "Kira",
        ExpenseCategory.Utilities => "Fatura",
        ExpenseCategory.Supplies => "Sarf Malzeme",
        ExpenseCategory.Inventory => "Ürün Alımı",
        ExpenseCategory.Marketing => "Pazarlama",
        ExpenseCategory.Maintenance => "Bakım Onarım",
        ExpenseCategory.Professional => "Danışmanlık",
        ExpenseCategory.Equipment => "Demirbaş",
        ExpenseCategory.Office => "Ofis",
        _ => "Diğer",
    };

    private static string StatusLabel(AppointmentStatus status) => status switch
    {
        AppointmentStatus.Scheduled => "Planlandı",
        AppointmentStatus.Confirmed => "Onaylandı",
        AppointmentStatus.InProgress => "İşlemde",
        AppointmentStatus.Completed => "Tamamlandı",
        AppointmentStatus.Cancelled => "İptal",
        AppointmentStatus.NoShow => "Gelmedi",
        AppointmentStatus.Draft => "Onay Bekliyor",
        _ => status.ToString(),
    };

    private static string ItemTypeLabel(AdisyonItemType type) => type switch
    {
        AdisyonItemType.Service => "Hizmet",
        AdisyonItemType.Product => "Ürün",
        AdisyonItemType.PackageSale => "Paket Satışı",
        AdisyonItemType.Extra => "Ek Kalem",
        _ => type.ToString(),
    };

    private static string CategoryOrDefault(string? category) =>
        string.IsNullOrWhiteSpace(category) ? "Kategorisiz" : category.Trim();
}

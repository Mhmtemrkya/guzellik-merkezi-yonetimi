using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Müşteri analitiği + stok/ürün ve hediye çeki raporları.
///  • Müşteri: dönemde işlem gören / yeni / tekrar gelen / kaybedilen, harcama ve yaş-cinsiyet dağılımı.
///  • Stok: dönem hareketlerinden (StockMovement) satılan adet, maliyet, kâr; anlık stok değeri.
///  • Hediye çeki: dönemde kesilen ve harcanan tutar, açık bakiye.
/// </summary>
public sealed partial class ReportsService
{
    // =======================================================================
    // Müşteri analitiği
    // =======================================================================

    public async Task<Result<CustomerReportDto>> GetCustomersAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default)
    {
        var (from, to, compareFrom, compareTo, granularity) = Normalize(range);

        var customers = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .Select(c => new
            {
                c.Id, c.FullName, c.Phone, c.BirthDate, c.Gender, c.KvkkConsent,
                c.IsVip, c.IsBlacklisted, c.BranchId, c.CreatedAtUtc,
            })
            .ToListAsync(cancellationToken);

        var branchNames = (await _db.Branches.AsNoTracking()
                .Where(b => b.TenantId == tenantId)
                .Select(b => new { b.Id, b.Name })
                .ToListAsync(cancellationToken))
            .GroupBy(b => b.Id).ToDictionary(g => g.Key, g => g.First().Name);

        var appointments = await LoadAppointmentsAsync(tenantId, from, to, cancellationToken);
        var accounts = await LoadAccountsAsync(tenantId, cancellationToken);
        var accountsById = accounts.ToDictionary(a => a.Id);
        var payments = await LoadPaymentsAsync(accountsById, from, to, cancellationToken);

        // Dönem sayaçları
        var visitsByCustomer = appointments
            .GroupBy(a => a.CustomerId)
            .ToDictionary(g => g.Key, g => g.Count());
        var spentByCustomer = payments
            .GroupBy(p => p.CustomerId)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));

        var newCustomers = customers.Count(c => c.CreatedAtUtc >= from && c.CreatedAtUtc < to);
        var activeCustomers = visitsByCustomer.Count;
        var returning = visitsByCustomer.Count(kv => kv.Value > 1);
        var oneTime = visitsByCustomer.Count(kv => kv.Value == 1);

        // Kaybedilen: dönem başından önce kaydı olan ama son 180 gündür hiç randevusu olmayan.
        var lostThreshold = to.AddDays(-180);
        var lastVisitAll = (await _db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.StartUtc < to)
                .GroupBy(a => a.CustomerId)
                .Select(g => new { CustomerId = g.Key, Last = g.Max(x => x.StartUtc) })
                .ToListAsync(cancellationToken))
            .ToDictionary(x => x.CustomerId, x => x.Last);
        var lost = customers.Count(c => c.CreatedAtUtc < lostThreshold
                                        && (!lastVisitAll.TryGetValue(c.Id, out var last) || last < lostThreshold));

        // Açık borç (kalan taksit) — anlık.
        var receivables = await BranchReceivablesAsync(tenantId, accountsById, cancellationToken);
        var totalDebt = receivables.Values.Sum();

        // Karşılaştırma dönemi
        var prevNew = 0;
        var prevActive = 0;
        var prevSpent = 0m;
        if (compareFrom.HasValue && compareTo.HasValue)
        {
            prevNew = customers.Count(c => c.CreatedAtUtc >= compareFrom.Value && c.CreatedAtUtc < compareTo.Value);
            var prevAppts = await LoadAppointmentsAsync(tenantId, compareFrom.Value, compareTo.Value, cancellationToken);
            prevActive = prevAppts.Select(a => a.CustomerId).Distinct().Count();
            var prevPayments = await LoadPaymentsAsync(accountsById, compareFrom.Value, compareTo.Value, cancellationToken);
            prevSpent = prevPayments.Sum(p => p.Amount);
        }

        // Yaş segmentleri
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var ageBuckets = new (string Label, int Min, int Max)[]
        {
            ("18-24", 18, 24), ("25-34", 25, 34), ("35-44", 35, 44), ("45-54", 45, 54), ("55+", 55, 200),
        };
        var ageSegments = ageBuckets
            .Select(b => new ReportSliceDto(b.Label, b.Label, 0m,
                customers.Count(c => c.BirthDate is { } bd && AgeOf(bd, today) >= b.Min && AgeOf(bd, today) <= b.Max)))
            .Where(s => s.Count > 0)
            .ToList();

        var genderSlices = customers
            .GroupBy(c => c.Gender)
            .Select(g => new ReportSliceDto(g.Key.ToString(), GenderLabel(g.Key), 0m, g.Count()))
            .OrderByDescending(s => s.Count)
            .ToList();

        var visitFrequency = new List<ReportSliceDto>
        {
            new("once", "1 kez", 0m, visitsByCustomer.Count(kv => kv.Value == 1)),
            new("few", "2-3 kez", 0m, visitsByCustomer.Count(kv => kv.Value is >= 2 and <= 3)),
            new("regular", "4-6 kez", 0m, visitsByCustomer.Count(kv => kv.Value is >= 4 and <= 6)),
            new("loyal", "7+ kez", 0m, visitsByCustomer.Count(kv => kv.Value >= 7)),
        }.Where(s => s.Count > 0).ToList();

        // Zaman serisi: yeni müşteri + aktif müşteri (randevu) + tahsilat
        var buckets = BuildBuckets(from, to, granularity);
        var order = buckets.Select((b, i) => (b.Key, Index: i)).ToDictionary(x => x.Key, x => x.Index);
        var seriesAcc = buckets.Select(b => new { b.Key, b.Label, Values = new decimal[2], Counts = new int[3] }).ToList();
        foreach (var c in customers.Where(c => c.CreatedAtUtc >= from && c.CreatedAtUtc < to))
            if (order.TryGetValue(Bucket(c.CreatedAtUtc, granularity).Key, out var i)) seriesAcc[i].Counts[2]++;
        foreach (var a in appointments)
            if (order.TryGetValue(Bucket(a.StartUtc, granularity).Key, out var i)) seriesAcc[i].Counts[0]++;
        foreach (var p in payments)
            if (order.TryGetValue(Bucket(p.OccurredAtUtc, granularity).Key, out var i)) seriesAcc[i].Values[0] += p.Amount;

        var series = seriesAcc.Select(x => new ReportPointDto(
            x.Key, x.Label, Round(x.Values[0]), 0m, Round(x.Values[0]), 0m, x.Counts[0], x.Counts[1], x.Counts[2])).ToList();

        var topCustomers = customers
            .Select(c => new
            {
                Customer = c,
                Visits = visitsByCustomer.TryGetValue(c.Id, out var v) ? v : 0,
                Spent = spentByCustomer.TryGetValue(c.Id, out var s) ? s : 0m,
            })
            .Where(x => x.Visits > 0 || x.Spent > 0)
            .OrderByDescending(x => x.Spent).ThenByDescending(x => x.Visits)
            .Take(100)
            .Select(x => new CustomerReportRowDto(
                x.Customer.Id,
                x.Customer.FullName,
                MaskPhoneIfStaff(x.Customer.Phone),
                x.Visits,
                Round(x.Spent),
                0m,
                lastVisitAll.TryGetValue(x.Customer.Id, out var last) ? last : null,
                x.Customer.IsVip,
                x.Customer.KvkkConsent,
                branchNames.TryGetValue(x.Customer.BranchId, out var bn) ? bn : null))
            .ToList();

        var totalSpent = payments.Sum(p => p.Amount);

        return Result<CustomerReportDto>.Success(new CustomerReportDto(
            customers.Count,
            newCustomers,
            activeCustomers,
            returning,
            oneTime,
            lost,
            customers.Count(c => c.IsVip),
            customers.Count(c => c.IsBlacklisted),
            customers.Count(c => c.KvkkConsent),
            Round(totalSpent),
            activeCustomers > 0 ? Round(totalSpent / activeCustomers) : 0m,
            Round(totalDebt),
            activeCustomers > 0 ? Round((decimal)returning / activeCustomers * 100m) : 0m,
            prevNew,
            prevActive,
            Round(prevSpent),
            ageSegments,
            genderSlices,
            visitFrequency,
            series,
            topCustomers));
    }

    private static int AgeOf(DateOnly birth, DateOnly today)
    {
        var age = today.Year - birth.Year;
        if (today < birth.AddYears(age)) age--;
        return age;
    }

    private static string GenderLabel(Gender gender) => gender switch
    {
        Gender.Female => "Kadın",
        Gender.Male => "Erkek",
        Gender.Other => "Diğer",
        _ => "Belirtilmemiş",
    };

    /// <summary>Personel müşteri telefonunu yalnızca son 4 hane görür (kurum genelindeki kuralla aynı).</summary>
    private string MaskPhoneIfStaff(string? phone) =>
        _currentUser.Role == UserRole.Staff ? PhoneMask.Mask(phone) ?? string.Empty : phone ?? string.Empty;

    // =======================================================================
    // Stok / ürün + hediye çeki
    // =======================================================================

    public async Task<Result<InventoryReportDto>> GetInventoryAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default)
    {
        var (from, to, compareFrom, compareTo, granularity) = Normalize(range);

        var products = await _db.Products.AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .Select(p => new
            {
                p.Id, p.Name, p.Category, p.Brand, p.Cost, p.SalePrice,
                p.CurrentStock, p.MinStockLevel, p.IsActive,
            })
            .ToListAsync(cancellationToken);
        var productById = products.GroupBy(p => p.Id).ToDictionary(g => g.Key, g => g.First());

        var movements = await LoadMovementsAsync(tenantId, from, to, cancellationToken);
        var previousMovements = compareFrom.HasValue && compareTo.HasValue
            ? await LoadMovementsAsync(tenantId, compareFrom.Value, compareTo.Value, cancellationToken)
            : [];

        decimal SoldAmount(List<MovementRow> rows) => rows
            .Where(m => m.Type == StockMovementType.Sale)
            .Sum(m => m.Quantity * (productById.TryGetValue(m.ProductId, out var p) ? p.SalePrice : 0m));
        decimal SoldCost(List<MovementRow> rows) => rows
            .Where(m => m.Type == StockMovementType.Sale)
            .Sum(m => m.Quantity * (m.UnitCost ?? (productById.TryGetValue(m.ProductId, out var p) ? p.Cost : 0m)));

        var soldAmount = SoldAmount(movements);
        var soldCost = SoldCost(movements);

        var rows = products
            .Select(p =>
            {
                var own = movements.Where(m => m.ProductId == p.Id).ToList();
                var sold = own.Where(m => m.Type == StockMovementType.Sale).Sum(m => m.Quantity);
                var used = own.Where(m => m.Type is StockMovementType.Outbound or StockMovementType.Damage).Sum(m => m.Quantity);
                var amount = sold * p.SalePrice;
                var cost = own.Where(m => m.Type == StockMovementType.Sale).Sum(m => m.Quantity * (m.UnitCost ?? p.Cost));
                return new ProductReportRowDto(
                    p.Id,
                    p.Name,
                    ProductCategoryLabel(p.Category),
                    p.Brand,
                    sold,
                    Round(amount),
                    Round(cost),
                    Round(amount - cost),
                    used,
                    p.CurrentStock,
                    p.MinStockLevel,
                    p.CurrentStock <= p.MinStockLevel,
                    Round(p.CurrentStock * p.Cost));
            })
            .OrderByDescending(r => r.SoldAmount).ThenByDescending(r => r.StockValue)
            .ToList();

        var categories = rows
            .GroupBy(r => r.Category)
            .Select(g => new ReportSliceDto(g.Key, g.Key, Round(g.Sum(x => x.SoldAmount)), (int)g.Sum(x => x.SoldQuantity)))
            .OrderByDescending(s => s.Amount)
            .ToList();

        var movementTypes = movements
            .GroupBy(m => m.Type)
            .Select(g => new ReportSliceDto(g.Key.ToString(), MovementLabel(g.Key),
                Round(g.Sum(x => x.Quantity * (x.UnitCost ?? (productById.TryGetValue(x.ProductId, out var p) ? p.Cost : 0m)))),
                (int)g.Sum(x => x.Quantity)))
            .OrderByDescending(s => s.Count)
            .ToList();

        // Zaman serisi: satış tutarı (gelir sütunu) + alım maliyeti (gider sütunu)
        var buckets = BuildBuckets(from, to, granularity);
        var order = buckets.Select((b, i) => (b.Key, Index: i)).ToDictionary(x => x.Key, x => x.Index);
        var seriesAcc = buckets.Select(b => new { b.Key, b.Label, Values = new decimal[2] }).ToList();
        foreach (var m in movements)
        {
            if (!order.TryGetValue(Bucket(m.OccurredAtUtc, granularity).Key, out var i)) continue;
            var meta = productById.TryGetValue(m.ProductId, out var p) ? p : null;
            if (m.Type == StockMovementType.Sale) seriesAcc[i].Values[0] += m.Quantity * (meta?.SalePrice ?? 0m);
            if (m.Type == StockMovementType.Inbound) seriesAcc[i].Values[1] += m.Quantity * (m.UnitCost ?? meta?.Cost ?? 0m);
        }
        var series = seriesAcc.Select(x => new ReportPointDto(
            x.Key, x.Label, Round(x.Values[0]), Round(x.Values[1]), Round(x.Values[0] - x.Values[1]), 0m, 0, 0, 0)).ToList();

        // ---------- hediye çeki ----------
        var giftCards = await _db.GiftCards.AsNoTracking()
            .Where(g => g.TenantId == tenantId)
            .Select(g => new
            {
                g.Id, g.Code, g.Kind, g.Value, g.Balance, g.MaxUses, g.UsedCount,
                g.IsActive, g.ValidUntilUtc, g.CustomerId, g.CreatedAtUtc,
            })
            .ToListAsync(cancellationToken);

        var customerNames = giftCards.Any(g => g.CustomerId != null)
            ? (await _db.Customers.AsNoTracking()
                    .Where(c => c.TenantId == tenantId)
                    .Select(c => new { c.Id, c.FullName })
                    .ToListAsync(cancellationToken))
                .GroupBy(c => c.Id).ToDictionary(g => g.Key, g => g.First().FullName)
            : [];

        var issuedInPeriod = giftCards.Where(g => g.CreatedAtUtc >= from && g.CreatedAtUtc < to).ToList();
        var nowUtc = DateTime.UtcNow;
        // Harcanan: yüklü bakiyeli çekte (Value − Balance); indirim kuponunda kullanım × değer.
        decimal Redeemed(decimal value, decimal balance, GiftCardKind kind, int usedCount) =>
            kind == GiftCardKind.StoredValue ? Math.Max(0m, value - balance) : usedCount * value;

        var giftRows = giftCards
            .OrderByDescending(g => g.CreatedAtUtc)
            .Take(200)
            .Select(g => new GiftCardReportRowDto(
                g.Id,
                g.Code,
                GiftCardKindLabel(g.Kind),
                Round(g.Value),
                Round(g.Balance),
                Round(Redeemed(g.Value, g.Balance, g.Kind, g.UsedCount)),
                g.UsedCount,
                g.MaxUses,
                g.IsActive,
                g.ValidUntilUtc,
                g.CustomerId is { } cid && customerNames.TryGetValue(cid, out var cn) ? cn : null))
            .ToList();

        return Result<InventoryReportDto>.Success(new InventoryReportDto(
            products.Count(p => p.IsActive),
            products.Count(p => p.IsActive && p.CurrentStock > 0 && p.CurrentStock <= p.MinStockLevel),
            products.Count(p => p.IsActive && p.CurrentStock <= 0),
            Round(products.Sum(p => p.CurrentStock * p.Cost)),
            Round(products.Sum(p => p.CurrentStock * p.SalePrice)),
            movements.Where(m => m.Type == StockMovementType.Sale).Sum(m => m.Quantity),
            Round(soldAmount),
            Round(soldCost),
            Round(soldAmount - soldCost),
            movements.Where(m => m.Type == StockMovementType.Outbound).Sum(m => m.Quantity),
            movements.Where(m => m.Type == StockMovementType.Damage).Sum(m => m.Quantity),
            Round(movements.Where(m => m.Type == StockMovementType.Inbound)
                .Sum(m => m.Quantity * (m.UnitCost ?? (productById.TryGetValue(m.ProductId, out var p) ? p.Cost : 0m)))),
            Round(SoldAmount(previousMovements)),
            Round(SoldAmount(previousMovements) - SoldCost(previousMovements)),
            rows,
            categories,
            movementTypes,
            series,
            issuedInPeriod.Count,
            Round(issuedInPeriod.Sum(g => g.Value)),
            Round(giftCards.Sum(g => Redeemed(g.Value, g.Balance, g.Kind, g.UsedCount))),
            Round(giftCards.Where(g => g.Kind == GiftCardKind.StoredValue && g.IsActive).Sum(g => g.Balance)),
            giftCards.Count(g => g.IsActive && (g.ValidUntilUtc == null || g.ValidUntilUtc > nowUtc)),
            giftCards.Count(g => g.ValidUntilUtc != null && g.ValidUntilUtc <= nowUtc),
            giftRows));
    }

    private sealed record MovementRow(Guid ProductId, StockMovementType Type, decimal Quantity, decimal? UnitCost, DateTime OccurredAtUtc);

    private async Task<List<MovementRow>> LoadMovementsAsync(Guid tenantId, DateTime from, DateTime to, CancellationToken ct)
    {
        var rows = await _db.StockMovements.AsNoTracking()
            .Where(m => m.TenantId == tenantId && m.OccurredAtUtc >= from && m.OccurredAtUtc < to)
            .Select(m => new { m.ProductId, m.Type, m.Quantity, m.UnitCost, m.OccurredAtUtc })
            .ToListAsync(ct);
        return rows.Select(m => new MovementRow(m.ProductId, m.Type, m.Quantity, m.UnitCost, m.OccurredAtUtc)).ToList();
    }

    private static string ProductCategoryLabel(ProductCategory category) => category switch
    {
        ProductCategory.SkinCare => "Cilt Bakımı",
        ProductCategory.Consumable => "Sarf Malzeme",
        ProductCategory.Sale => "Satış Ürünü",
        ProductCategory.HairCare => "Saç Bakımı",
        ProductCategory.Makeup => "Makyaj",
        ProductCategory.NailCare => "Tırnak Bakımı",
        _ => "Diğer",
    };

    private static string MovementLabel(StockMovementType type) => type switch
    {
        StockMovementType.Inbound => "Giriş (Alım)",
        StockMovementType.Outbound => "Çıkış (Sarf)",
        StockMovementType.Sale => "Satış",
        StockMovementType.Adjustment => "Düzeltme",
        StockMovementType.Damage => "Fire / Bozulma",
        _ => type.ToString(),
    };

    private static string GiftCardKindLabel(GiftCardKind kind) => kind switch
    {
        GiftCardKind.Percentage => "Yüzde İndirim",
        GiftCardKind.FixedAmount => "Tutar İndirimi",
        GiftCardKind.StoredValue => "Hediye Çeki",
        _ => kind.ToString(),
    };
}

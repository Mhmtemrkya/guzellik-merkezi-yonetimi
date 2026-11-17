using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformOps;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// PLATFORM › FATURALAMA — tüm sayılar SUNUCUDA, fiyatlama motoruyla (SubscriptionPricing) hesaplanır.
///
/// <para>
/// Geçmiş faturalar kendi kalem anlık görüntüsüyle gösterilir; yeniden hesaplanan YALNIZ geleceğe
/// dair tutarlardır (sonraki yenileme teklifi, MRR). Tahsilat toplamları ödenmiş faturalardan (brüt
/// + aynen saklanan net) toplanır, tahmin edilmez.
/// </para>
/// </summary>
internal static class PlatformBillingOverview
{
    public static async Task<Result<PlatformBillingOverviewDto>> BuildAsync(GuzellikDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var lastMonthStart = monthStart.AddMonths(-1);
        var yearAgo = monthStart.AddMonths(-11);

        var tenants = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .Where(t => !t.IsDeleted)
            .ToListAsync(ct);

        var cards = (await db.TenantPaymentMethods.IgnoreQueryFilters().AsNoTracking()
                .Where(c => c.IsActive && !c.IsDeleted)
                .OrderByDescending(c => c.CreatedAtUtc)
                .Select(c => new { c.TenantId, c.MaskedNumber })
                .ToListAsync(ct))
            .GroupBy(c => c.TenantId)
            .ToDictionary(g => g.Key, g => g.First().MaskedNumber);

        var counts = await BillingCountsQuery.CountManyAsync(db, tenants.Select(t => t.Id).ToList(), ct);

        var rows = new List<PlatformSubscriptionRowDto>(tenants.Count);
        foreach (var t in tenants)
        {
            var c = counts.GetValueOrDefault(t.Id) ?? new BillingCounts(0, 0, 0);
            SubscriptionQuote? next = null;
            decimal monthly = 0;
            if (t.SubscriptionPlan is { } plan)
            {
                var period = t.SubscriptionPeriod ?? BillingPeriod.Monthly;
                if (SubscriptionPricing.UnitPrice(plan, period) > 0)
                {
                    next = SubscriptionPricing.Quote(plan, period, c);
                    if (t.Status == TenantStatus.Active) monthly = SubscriptionPricing.MonthlyEquivalentNet(plan, t.SubscriptionPeriod, c);
                }
            }

            rows.Add(new PlatformSubscriptionRowDto(
                t.Id, t.Name, t.Status.ToString(), t.SubscriptionPlan?.Name, t.SubscriptionPeriod?.ToString(),
                AsUtc(t.SubscriptionEndsAtUtc), AsUtc(t.TrialEndsAtUtc),
                cards.ContainsKey(t.Id), cards.GetValueOrDefault(t.Id),
                c.Branches, c.Customers, c.SignedConsentForms, monthly, next));
        }

        // ---- Faturalar: tahsilat + açık alacak (iptal/silinmiş hariç) ----
        var invoices = await db.TenantInvoices.IgnoreQueryFilters().AsNoTracking()
            .Where(i => !i.IsDeleted && i.Status != "Cancelled")
            .ToListAsync(ct);
        var paid = invoices.Where(i => i.Status == "Paid" && i.PaidAtUtc != null).ToList();
        decimal Gross(IEnumerable<TenantInvoice> list) => list.Sum(i => i.AmountTRY);
        decimal Net(IEnumerable<TenantInvoice> list) => list.Sum(i => i.NetAmountTRY);
        var thisMonth = paid.Where(i => i.PaidAtUtc >= monthStart).ToList();
        var lastMonth = paid.Where(i => i.PaidAtUtc >= lastMonthStart && i.PaidAtUtc < monthStart).ToList();
        var open = invoices.Where(i => i.Status is "Draft" or "Sent" or "Overdue").ToList();
        var overdue = open.Count(i => i.Status == "Overdue" || (i.Status == "Sent" && i.DueDateUtc < now));

        var monthly12 = Enumerable.Range(0, 12)
            .Select(k => yearAgo.AddMonths(k))
            .Select(m =>
            {
                var inMonth = paid.Where(i => i.PaidAtUtc >= m && i.PaidAtUtc < m.AddMonths(1)).ToList();
                return new PlatformMonthlyCollectionDto(m.Year, m.Month, Gross(inMonth), Net(inMonth), inMonth.Count);
            })
            .ToList();

        // ---- Tahsilat denemeleri (son 60) ----
        var names = tenants.ToDictionary(t => t.Id, t => t.Name);
        var payments = await db.SubscriptionPayments.IgnoreQueryFilters().AsNoTracking()
            .Where(p => !p.IsDeleted)
            .OrderByDescending(p => p.CreatedAtUtc)
            .Take(60)
            .ToListAsync(ct);
        var since30 = now.AddDays(-30);
        var failed30 = await db.SubscriptionPayments.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(p => !p.IsDeleted && p.Status == SubscriptionPayment.Failed && p.CreatedAtUtc >= since30, ct);
        var pendingCount = await db.SubscriptionPayments.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(p => !p.IsDeleted && p.Status == SubscriptionPayment.Pending, ct);

        var paymentRows = payments.Select(p => new PlatformPaymentRowDto(
            p.Id, p.TenantId, names.GetValueOrDefault(p.TenantId) ?? "—", p.Kind, p.Status, p.AmountTRY, p.ErrorMessage,
            p.AttemptNumber, AsUtc(p.CreatedAtUtc)!.Value, AsUtc(p.CompletedAtUtc))).ToList();

        // Önümüzdeki 30 günde kartla yenilenecek tutar (güncel sayaçlarla, KDV dahil).
        var in30 = now.AddDays(30);
        var renewals30 = rows
            .Where(r => r.HasCard && r.NextRenewalQuote is not null && r.Period is not null
                        && r.SubscriptionEndsAtUtc is { } end && end <= in30 && r.Status is "Active" or "Suspended")
            .Sum(r => r.NextRenewalQuote!.Total);

        var mrr = rows.Sum(r => r.MonthlyEquivalentNet);
        var kpis = new PlatformBillingKpisDto(
            mrr,
            mrr * 12m,
            Gross(thisMonth),
            Net(thisMonth),
            Gross(lastMonth),
            Gross(open),
            overdue,
            tenants.Count(t => t.Status == TenantStatus.Active && t.SubscriptionPlanId != null),
            tenants.Count(t => t.Status == TenantStatus.Trial),
            cards.Count,
            failed30,
            pendingCount,
            renewals30);

        return Result<PlatformBillingOverviewDto>.Success(new PlatformBillingOverviewDto(
            kpis,
            rows.OrderBy(r => r.Status == "Active" ? 0 : r.Status == "Trial" ? 1 : 2)
                .ThenBy(r => r.SubscriptionEndsAtUtc ?? r.TrialEndsAtUtc ?? DateTime.MaxValue)
                .ToList(),
            paymentRows,
            monthly12,
            now));
    }

    private static DateTime? AsUtc(DateTime? value) =>
        value is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;
}

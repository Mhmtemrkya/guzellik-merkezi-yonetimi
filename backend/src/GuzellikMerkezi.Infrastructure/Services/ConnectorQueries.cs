using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <inheritdoc cref="IConnectorQueries"/>
public sealed class ConnectorQueries(GuzellikDbContext db) : IConnectorQueries
{
    public const int MaxPageSize = 200;

    public async Task<PagedResult<ConnectorTenantDto>> ListTenantsAsync(int page, int pageSize, CancellationToken ct = default)
    {
        var request = new PageRequest(page, Math.Clamp(pageSize, 1, MaxPageSize));
        var query = db.Tenants.AsNoTracking();
        var total = await query.CountAsync(ct);
        var rows = await Project(query.OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id).Skip(request.Skip).Take(request.SafePageSize))
            .ToListAsync(ct);
        var counts = await BillingCountsQuery.CountManyAsync(db, rows.Select(r => r.Id).ToList(), ct);
        return new PagedResult<ConnectorTenantDto>(rows.Select(r => ToDto(r, counts.GetValueOrDefault(r.Id))).ToList(), total, request.SafePage, request.SafePageSize);
    }

    public async Task<ConnectorTenantDto?> GetTenantAsync(Guid id, CancellationToken ct = default)
    {
        var row = await Project(db.Tenants.AsNoTracking().Where(x => x.Id == id)).SingleOrDefaultAsync(ct);
        if (row is null) return null;
        var counts = await BillingCountsQuery.CountManyAsync(db, [row.Id], ct);
        return ToDto(row, counts.GetValueOrDefault(row.Id));
    }

    private sealed record Row(Guid Id, string? Code, string Name, TenantStatus Status, SubscriptionPlan? Plan, BillingPeriod? Period,
        DateTime? TrialEndsAtUtc, DateTime? SubscriptionEndsAtUtc, int BranchCount, bool IsSelfSignup, DateTime CreatedAtUtc);

    // Yalnız gereken kolonlar okunur: şifreli kişisel alanlar (telefon, vergi no) belleğe de alınmaz.
    // Paket, aylık değerin hesabı için okunur (fiyat ve kademe alanları; kişisel veri taşımaz).
    private static IQueryable<Row> Project(IQueryable<Tenant> query) =>
        query.Select(x => new Row(x.Id, x.Code, x.Name, x.Status, x.SubscriptionPlan,
            x.SubscriptionPeriod, x.TrialEndsAtUtc, x.SubscriptionEndsAtUtc,
            x.Branches.Count(), x.IsSelfSignup, x.CreatedAtUtc));

    private static ConnectorTenantDto ToDto(Row r, BillingCounts? counts)
    {
        var value = MonthlyValueOf(r.Plan, r.Period, counts ?? new BillingCounts(r.BranchCount, 0, 0));
        return new ConnectorTenantDto(r.Id, r.Code, r.Name, StatusText(r.Status), r.Plan?.PlanKey,
            r.Period switch { BillingPeriod.Monthly => "monthly", BillingPeriod.Yearly => "yearly", _ => null },
            r.TrialEndsAtUtc, r.SubscriptionEndsAtUtc, r.BranchCount, r.IsSelfSignup, r.CreatedAtUtc,
            value?.Net, value?.Gross, value?.PeriodGross);
    }

    /// <summary>Fiyatlama motorunun aylık değeri; fiyatlı paketi olmayan kurumda (ör. paketsiz deneme) null.</summary>
    public static MonthlyValue? MonthlyValueOf(SubscriptionPlan? plan, BillingPeriod? period, BillingCounts counts) =>
        plan is not null && SubscriptionPricing.UnitPrice(plan, period ?? BillingPeriod.Monthly) > 0
            ? SubscriptionPricing.MonthlyEquivalent(plan, period, counts)
            : null;

    public static string StatusText(TenantStatus status) => status switch
    {
        TenantStatus.Trial => "trial",
        TenantStatus.Active => "active",
        TenantStatus.Suspended => "suspended",
        TenantStatus.Cancelled => "cancelled",
        _ => "unknown",
    };
}

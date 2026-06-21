namespace GuzellikMerkezi.Application.Features.Usage;

/// <summary>
/// Bir metrikin gerçek kullanımı vs paket limiti. -1 limit = sınırsız.
/// </summary>
public sealed record UsageMetric(string Key, string Label, int Used, int Limit)
{
    public bool IsUnlimited => Limit < 0;
    public int Percent => IsUnlimited || Limit == 0 ? 0 : (int)Math.Min(100, Math.Round(Used * 100.0 / Limit));
    public bool IsOver => !IsUnlimited && Used > Limit;
    public bool IsWarning => !IsUnlimited && !IsOver && Percent >= 80;
}

public sealed record TenantUsageDto(
    Guid TenantId,
    string TenantName,
    Guid? SubscriptionPlanId,
    string? PlanName,
    string? PlanKey,
    decimal PlanMonthlyPriceTRY,
    IReadOnlyCollection<UsageMetric> Metrics)
{
    public bool HasAnyOverflow => Metrics.Any(m => m.IsOver);
    public bool HasWarning => Metrics.Any(m => m.IsWarning);
    public int MaxPercent => Metrics.Any() ? Metrics.Max(m => m.Percent) : 0;
}

public sealed record PlatformUsageSummaryDto(
    int TotalTenants,
    int ActiveTenants,
    int TrialTenants,
    int PausedTenants,
    decimal MonthlyRecurringRevenueTRY,
    int TenantsAtWarning,
    int TenantsOverLimit,
    IReadOnlyCollection<PlanUsageBreakdown> PlanBreakdown,
    IReadOnlyCollection<TenantUsageDto> Tenants);

public sealed record PlanUsageBreakdown(
    Guid? PlanId,
    string PlanKey,
    string PlanName,
    int TenantCount,
    decimal MonthlyRevenueTRY);

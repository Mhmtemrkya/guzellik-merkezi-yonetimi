using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class FeatureService : IFeatureService
{
    private readonly GuzellikDbContext _db;

    public FeatureService(GuzellikDbContext db) => _db = db;

    public async Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(featureKey)) return false;

        var plan = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(ct);

        return plan is not null && plan.Has(featureKey);
    }

    public async Task<bool> IsFeatureAllowedAsync(Guid tenantId, string featureKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(featureKey)) return true;
        var plan = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(ct);
        // Plan yoksa kısıtlama uygulamayız (limit kontrolüyle aynı yaklaşım).
        return plan is null || plan.Has(featureKey);
    }

    public async Task<Result<TenantFeaturesDto>> GetTenantFeaturesAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);

        if (tenant is null) return Result<TenantFeaturesDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var plan = tenant.SubscriptionPlan;
        var active = ParseFeatures(plan?.Features);

        return Result<TenantFeaturesDto>.Success(new TenantFeaturesDto(
            tenant.Id,
            plan?.Id,
            plan?.PlanKey,
            plan?.Name,
            active));
    }

    public FeatureCatalogDto GetCatalog()
    {
        var items = FeatureCatalog.All
            .Select(f => new FeatureCatalogItem(
                f.Key,
                f.Name,
                f.Description,
                f.Category.ToString(),
                (int)f.Category))
            .ToArray();

        return new FeatureCatalogDto(items);
    }

    private static IReadOnlyCollection<string> ParseFeatures(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return Array.Empty<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(f => f.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }
}

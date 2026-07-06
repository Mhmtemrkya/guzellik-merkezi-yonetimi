using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class FeatureService : IFeatureService
{
    // Feature gating HER gated istekte çağrılır → tenant'ın feature-set'i kısa süre önbelleğe alınır
    // (Tenant→SubscriptionPlan JOIN'i her seferinde tekrarlanmasın). Yalnız STATİK feature-set önbekklenir;
    // usage/kota sayaçları (UsageService) önbekklenmez — onlar sık değişir.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    private readonly GuzellikDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly bool _failOpenWhenNoPlan;

    public FeatureService(GuzellikDbContext db, IMemoryCache cache, IConfiguration configuration)
    {
        _db = db;
        _cache = cache;
        // Plan ataması olmayan tenant davranışı:
        //  - Development: fail-OPEN (test kolaylığı).
        //  - Production: fail-CLOSED (plansız tenant ücretli özellikleri/limitsiz kullanımı ELDE ETMESİN).
        // Açık override: "Features:FailOpenWhenNoPlan".
        var env = configuration["ASPNETCORE_ENVIRONMENT"]
                  ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
                  ?? "Production";
        var isDevelopment = string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase);
        _failOpenWhenNoPlan = bool.TryParse(configuration["Features:FailOpenWhenNoPlan"], out var f) ? f : isDevelopment;
    }

    public async Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(featureKey)) return false;
        var f = await GetFeatureSetAsync(tenantId, ct);
        return f.HasPlan && f.Features.Contains(featureKey);
    }

    public async Task<bool> IsFeatureAllowedAsync(Guid tenantId, string featureKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(featureKey)) return true;
        var f = await GetFeatureSetAsync(tenantId, ct);
        // Plan yoksa: production'da fail-CLOSED (deny), Development'ta fail-open. Bkz. ctor.
        return f.HasPlan ? f.Features.Contains(featureKey) : _failOpenWhenNoPlan;
    }

    public void InvalidateTenant(Guid tenantId) => _cache.Remove(CacheKey(tenantId));

    private static string CacheKey(Guid tenantId) => $"feature-set:{tenantId}";

    /// <summary>Tenant'ın feature-set'ini önbellekten döndürür; yoksa DB'den okuyup (Tenant→Plan) doldurur.</summary>
    private async Task<CachedFeatures> GetFeatureSetAsync(Guid tenantId, CancellationToken ct)
    {
        if (_cache.TryGetValue(CacheKey(tenantId), out CachedFeatures? cached) && cached is not null)
            return cached;

        var plan = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(ct);

        // plan.Has() = case-insensitive CSV üyeliği → OrdinalIgnoreCase HashSet.Contains() birebir eşdeğer.
        var set = new HashSet<string>(ParseFeatures(plan?.Features), StringComparer.OrdinalIgnoreCase);
        var result = new CachedFeatures(plan is not null, set);
        _cache.Set(CacheKey(tenantId), result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheTtl,
        });
        return result;
    }

    private sealed record CachedFeatures(bool HasPlan, HashSet<string> Features);

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

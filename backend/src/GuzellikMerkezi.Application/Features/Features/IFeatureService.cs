using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Application.Features.Features;

public interface IFeatureService
{
    /// <summary>Tenant'ın aktif paketinde belirtilen feature açık mı?</summary>
    Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken ct = default);

    /// <summary>
    /// Feature kullanılabilir mi — plan YOKSA serbest (CheckLimitAsync ile tutarlı), plan VARSA
    /// feature'ı içermesi gerekir. Yazma uçlarında paket kapısı olarak kullanılır.
    /// </summary>
    Task<bool> IsFeatureAllowedAsync(Guid tenantId, string featureKey, CancellationToken ct = default);

    /// <summary>Tenant'ın paketinde tanımlı tüm feature key'lerinin listesi.</summary>
    Task<Result<TenantFeaturesDto>> GetTenantFeaturesAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Projedeki tüm feature kataloğu — plan kataloğu UI'ı için.</summary>
    FeatureCatalogDto GetCatalog();
}

public sealed record TenantFeaturesDto(
    Guid TenantId,
    Guid? PlanId,
    string? PlanKey,
    string? PlanName,
    IReadOnlyCollection<string> ActiveFeatures);

public sealed record FeatureCatalogDto(
    IReadOnlyCollection<FeatureCatalogItem> Items);

public sealed record FeatureCatalogItem(
    string Key,
    string Name,
    string Description,
    string Category,
    int CategoryOrder);

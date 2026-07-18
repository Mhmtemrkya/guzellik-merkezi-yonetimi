using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Tenants;

public interface ITenantService
{
    Task<Result<PagedResult<TenantDto>>> ListAsync(PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<TenantAvailabilityDto>> CheckAvailabilityAsync(string? name, string? slug, string? domain, string? ownerName, string? ownerEmail, CancellationToken cancellationToken = default);
    Task<Result<TenantDto>> GetAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result<TenantWithCredentialsDto>> CreateAsync(CreateTenantRequest request, CancellationToken cancellationToken = default);
    Task<Result<TenantDto>> UpdateAsync(Guid id, UpdateTenantRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> GrantAccessAsync(Guid tenantId, GrantTenantAccessRequest request, CancellationToken cancellationToken = default);
    /// <summary>Kurum yetkilisinin şifresini sıfırlar: yeni geçici şifre üretilir, ilk girişte değişim zorunlu olur, aktif oturumları düşer.</summary>
    Task<Result<TenantCredentialsDto>> ResetOwnerPasswordAsync(Guid tenantId, CancellationToken cancellationToken = default);

    /// <summary>Kullanım kılavuzunu sıfırlar — kurumun tüm kullanıcı/cihazlarında kılavuz baştan gösterilir (platform admin).</summary>
    Task<Result<GuideResetDto>> ResetGuideAsync(Guid tenantId, CancellationToken cancellationToken = default);
    /// <summary>Kılavuz sıfırlama zamanını döner — panel yerel "görüldü" kayıtlarıyla karşılaştırır.</summary>
    Task<Result<GuideResetDto>> GetGuideResetAsync(Guid tenantId, CancellationToken cancellationToken = default);
}

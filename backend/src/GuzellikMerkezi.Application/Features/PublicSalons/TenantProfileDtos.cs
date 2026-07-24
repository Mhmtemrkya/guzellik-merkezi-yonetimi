namespace GuzellikMerkezi.Application.Features.PublicSalons;

/// <summary>Kurumun salon vitrini profili (yönetim tarafı).</summary>
public sealed record TenantPublicProfileDto(
    bool IsPublished,
    string? LogoData,
    string? Description,
    string? Address,
    string? City,
    string? Instagram,
    string? PublicEmail,
    string? PublicPhone,
    string? WorkingHoursText,
    string? MapUrl,
    string? KvkkConsentText);

public sealed record UpdateTenantPublicProfileRequest(
    bool IsPublished,
    string? Description,
    string? Address,
    string? City,
    string? Instagram,
    string? PublicEmail,
    string? PublicPhone,
    string? WorkingHoursText,
    string? MapUrl);

public sealed record TenantGalleryPhotoDto(Guid Id, string Kind, string ImageData, string? Caption, int SortOrder);

public sealed record AddTenantGalleryPhotoRequest(string Kind, string ImageData, string? Caption);

/// <summary>Kurum logosu — ImageData null/boş gönderilirse logo kaldırılır.</summary>
public sealed record SetTenantLogoRequest(string? ImageData);

/// <summary>KVKK aydınlatma metni — Text null/boş gönderilirse yerleşik varsayılana döner.</summary>
public sealed record SetTenantKvkkTextRequest(string? Text);

/// <summary>Platform admin: kuruma Premium/Öne Çıkan etiketi ver/kaldır.</summary>
public sealed record SetTenantFeaturedRequest(bool IsFeatured);
public sealed record TenantFeaturedDto(bool IsFeatured);

public interface ITenantProfileService
{
    Task<Common.Result<TenantPublicProfileDto>> GetProfileAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Common.Result<TenantPublicProfileDto>> UpdateProfileAsync(Guid tenantId, UpdateTenantPublicProfileRequest request, CancellationToken cancellationToken = default);
    Task<Common.Result<IReadOnlyCollection<TenantGalleryPhotoDto>>> ListGalleryAsync(Guid tenantId, string? kind, CancellationToken cancellationToken = default);
    Task<Common.Result<TenantGalleryPhotoDto>> AddGalleryPhotoAsync(Guid tenantId, AddTenantGalleryPhotoRequest request, CancellationToken cancellationToken = default);
    Task<Common.Result> DeleteGalleryPhotoAsync(Guid tenantId, Guid photoId, CancellationToken cancellationToken = default);
    /// <summary>Kurum logosunu ayarlar (null = kaldır).</summary>
    Task<Common.Result<TenantPublicProfileDto>> SetLogoAsync(Guid tenantId, SetTenantLogoRequest request, CancellationToken cancellationToken = default);
    /// <summary>Kuruma özel KVKK aydınlatma metnini ayarlar (null/boş = varsayılana dön).</summary>
    Task<Common.Result<TenantPublicProfileDto>> SetKvkkTextAsync(Guid tenantId, SetTenantKvkkTextRequest request, CancellationToken cancellationToken = default);
    /// <summary>Premium/Öne Çıkan etiketini okur (platform admin liste satırı için hafif uç).</summary>
    Task<Common.Result<TenantFeaturedDto>> GetFeaturedAsync(Guid tenantId, CancellationToken cancellationToken = default);
    /// <summary>Premium/Öne Çıkan etiketini ayarlar (yalnızca platform admin çağırır).</summary>
    Task<Common.Result<TenantFeaturedDto>> SetFeaturedAsync(Guid tenantId, SetTenantFeaturedRequest request, CancellationToken cancellationToken = default);
}

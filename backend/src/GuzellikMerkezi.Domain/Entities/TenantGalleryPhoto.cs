using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Salon vitrini fotoğrafı (slider veya hizmet galerisi). Base64 data-URL olarak saklanır
/// (projedeki görsel deseni: LONGTEXT). Tür başına üst sınır servis katmanında uygulanır.
/// </summary>
public sealed class TenantGalleryPhoto : Entity
{
    private TenantGalleryPhoto() { }

    public TenantGalleryPhoto(Guid tenantId, GalleryPhotoKind kind, string imageData, string? caption, int sortOrder)
    {
        if (tenantId == Guid.Empty) throw new DomainException("Kurum kimliği boş olamaz.");
        if (string.IsNullOrWhiteSpace(imageData)) throw new DomainException("Fotoğraf boş olamaz.");
        TenantId = tenantId;
        Kind = kind;
        ImageData = imageData;
        Caption = string.IsNullOrWhiteSpace(caption) ? null : caption.Trim();
        SortOrder = sortOrder;
    }

    public Guid TenantId { get; private set; }
    public GalleryPhotoKind Kind { get; private set; }
    /// <summary>Base64 data-URL (data:image/jpeg;base64,...).</summary>
    public string ImageData { get; private set; } = string.Empty;
    public string? Caption { get; private set; }
    public int SortOrder { get; private set; }
}

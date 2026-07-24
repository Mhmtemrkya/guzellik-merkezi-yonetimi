using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Salon vitrini profil + galeri yönetimi (kurum yöneticisi ve platform admin).
/// Fotoğraflar base64 data-URL olarak saklanır; tür başına en fazla <see cref="MaxPhotosPerKind"/> adet.
/// </summary>
public sealed class TenantProfileService : ITenantProfileService
{
    public const int MaxPhotosPerKind = 10;
    /// <summary>Base64 data-URL üst sınırı (~1.5 MB metin ≈ ~1.1 MB görsel) — DB şişmesini frenler.</summary>
    public const int MaxImageDataLength = 1_500_000;

    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public TenantProfileService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result<TenantPublicProfileDto>> GetProfileAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var profile = await _db.TenantPublicProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId, cancellationToken);
        return Result<TenantPublicProfileDto>.Success(ToDto(profile));
    }

    public async Task<Result<TenantPublicProfileDto>> UpdateProfileAsync(Guid tenantId, UpdateTenantPublicProfileRequest request, CancellationToken cancellationToken = default)
    {
        var profile = await _db.TenantPublicProfiles
            .FirstOrDefaultAsync(p => p.TenantId == tenantId, cancellationToken);
        if (profile is null)
        {
            profile = new TenantPublicProfile(tenantId);
            _db.TenantPublicProfiles.Add(profile);
        }

        profile.Update(
            request.IsPublished,
            request.Description,
            request.Address,
            request.City,
            request.Instagram,
            request.PublicEmail,
            request.PublicPhone,
            request.WorkingHoursText,
            request.MapUrl);

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Update", "TenantPublicProfile", profile.Id,
            request.IsPublished ? "Salon profili güncellendi ve yayında." : "Salon profili güncellendi (yayında değil).",
            new { request.IsPublished, request.City, request.Instagram }, cancellationToken);
        return Result<TenantPublicProfileDto>.Success(ToDto(profile));
    }

    public async Task<Result<IReadOnlyCollection<TenantGalleryPhotoDto>>> ListGalleryAsync(Guid tenantId, string? kind, CancellationToken cancellationToken = default)
    {
        var query = _db.TenantGalleryPhotos.AsNoTracking().Where(g => g.TenantId == tenantId);
        if (TryParseKind(kind, out var parsed)) query = query.Where(g => g.Kind == parsed);
        var items = await query
            .OrderBy(g => g.Kind).ThenBy(g => g.SortOrder).ThenBy(g => g.CreatedAtUtc)
            .Select(g => new TenantGalleryPhotoDto(g.Id, g.Kind.ToString(), g.ImageData, g.Caption, g.SortOrder))
            .ToArrayAsync(cancellationToken);
        return Result<IReadOnlyCollection<TenantGalleryPhotoDto>>.Success(items);
    }

    public async Task<Result<TenantGalleryPhotoDto>> AddGalleryPhotoAsync(Guid tenantId, AddTenantGalleryPhotoRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryParseKind(request.Kind, out var kind))
            return Result<TenantGalleryPhotoDto>.Failure(Error.Validation("Fotoğraf türü 'Slider' veya 'Service' olmalı."));
        if (string.IsNullOrWhiteSpace(request.ImageData) || !request.ImageData.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            return Result<TenantGalleryPhotoDto>.Failure(Error.Validation("Fotoğraf base64 data-URL biçiminde olmalı."));
        if (request.ImageData.Length > MaxImageDataLength)
            return Result<TenantGalleryPhotoDto>.Failure(Error.Validation("Fotoğraf çok büyük. Lütfen daha küçük bir görsel yükleyin."));

        var count = await _db.TenantGalleryPhotos.CountAsync(g => g.TenantId == tenantId && g.Kind == kind, cancellationToken);
        if (count >= MaxPhotosPerKind)
            return Result<TenantGalleryPhotoDto>.Failure(Error.Conflict($"Bu galeriye en fazla {MaxPhotosPerKind} fotoğraf eklenebilir. Önce bir fotoğraf silin."));

        var maxSort = await _db.TenantGalleryPhotos
            .Where(g => g.TenantId == tenantId && g.Kind == kind)
            .Select(g => (int?)g.SortOrder).MaxAsync(cancellationToken) ?? -1;

        var photo = new TenantGalleryPhoto(tenantId, kind, request.ImageData, request.Caption, maxSort + 1);
        _db.TenantGalleryPhotos.Add(photo);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Create", "TenantGalleryPhoto", photo.Id,
            $"Salon vitrinine fotoğraf eklendi ({kind}).", new { Kind = kind.ToString(), photo.Caption }, cancellationToken);
        return Result<TenantGalleryPhotoDto>.Success(new TenantGalleryPhotoDto(photo.Id, photo.Kind.ToString(), photo.ImageData, photo.Caption, photo.SortOrder));
    }

    public async Task<Result> DeleteGalleryPhotoAsync(Guid tenantId, Guid photoId, CancellationToken cancellationToken = default)
    {
        var photo = await _db.TenantGalleryPhotos
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == photoId, cancellationToken);
        if (photo is null) return Result.Failure(Error.NotFound("Fotoğraf bulunamadı."));
        photo.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Delete", "TenantGalleryPhoto", photo.Id,
            "Salon vitrini fotoğrafı silindi.", null, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<TenantPublicProfileDto>> SetLogoAsync(Guid tenantId, SetTenantLogoRequest request, CancellationToken cancellationToken = default)
    {
        var hasImage = !string.IsNullOrWhiteSpace(request.ImageData);
        if (hasImage && !request.ImageData!.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            return Result<TenantPublicProfileDto>.Failure(Error.Validation("Logo base64 data-URL biçiminde olmalı."));
        if (hasImage && request.ImageData!.Length > MaxImageDataLength)
            return Result<TenantPublicProfileDto>.Failure(Error.Validation("Logo çok büyük. Lütfen daha küçük bir görsel yükleyin."));

        var profile = await _db.TenantPublicProfiles
            .FirstOrDefaultAsync(p => p.TenantId == tenantId, cancellationToken);
        if (profile is null)
        {
            profile = new TenantPublicProfile(tenantId);
            _db.TenantPublicProfiles.Add(profile);
        }
        profile.SetLogo(request.ImageData);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Update", "TenantPublicProfile", profile.Id,
            hasImage ? "Kurum logosu güncellendi." : "Kurum logosu kaldırıldı.", null, cancellationToken);
        return Result<TenantPublicProfileDto>.Success(ToDto(profile));
    }

    public async Task<Result<TenantFeaturedDto>> GetFeaturedAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var featured = await _db.TenantPublicProfiles.AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .Select(p => (bool?)p.IsFeatured)
            .FirstOrDefaultAsync(cancellationToken);
        return Result<TenantFeaturedDto>.Success(new TenantFeaturedDto(featured ?? false));
    }

    public async Task<Result<TenantFeaturedDto>> SetFeaturedAsync(Guid tenantId, SetTenantFeaturedRequest request, CancellationToken cancellationToken = default)
    {
        var profile = await _db.TenantPublicProfiles
            .FirstOrDefaultAsync(p => p.TenantId == tenantId, cancellationToken);
        if (profile is null)
        {
            profile = new TenantPublicProfile(tenantId);
            _db.TenantPublicProfiles.Add(profile);
        }
        profile.SetFeatured(request.IsFeatured);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Update", "TenantPublicProfile", profile.Id,
            request.IsFeatured ? "Kuruma Premium/Öne Çıkan etiketi verildi." : "Premium/Öne Çıkan etiketi kaldırıldı.",
            null, cancellationToken);
        return Result<TenantFeaturedDto>.Success(new TenantFeaturedDto(profile.IsFeatured));
    }

    public async Task<Result<TenantPublicProfileDto>> SetKvkkTextAsync(Guid tenantId, SetTenantKvkkTextRequest request, CancellationToken cancellationToken = default)
    {
        // Aşırı büyük metin frenle — sözleşme metni birkaç sayfayı geçmez.
        if (!string.IsNullOrEmpty(request.Text) && request.Text.Length > 20_000)
            return Result<TenantPublicProfileDto>.Failure(Error.Validation("KVKK metni çok uzun (en fazla 20.000 karakter)."));

        var profile = await _db.TenantPublicProfiles
            .FirstOrDefaultAsync(p => p.TenantId == tenantId, cancellationToken);
        if (profile is null)
        {
            profile = new TenantPublicProfile(tenantId);
            _db.TenantPublicProfiles.Add(profile);
        }
        profile.SetKvkkConsentText(request.Text);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Update", "TenantPublicProfile", profile.Id,
            string.IsNullOrWhiteSpace(request.Text) ? "KVKK metni varsayılana döndürüldü." : "KVKK aydınlatma metni güncellendi.",
            null, cancellationToken);
        return Result<TenantPublicProfileDto>.Success(ToDto(profile));
    }

    private static TenantPublicProfileDto ToDto(TenantPublicProfile? p) =>
        new(p?.IsPublished ?? false, p?.LogoData, p?.Description, p?.Address, p?.City, p?.Instagram,
            p?.PublicEmail, p?.PublicPhone, p?.WorkingHoursText, p?.MapUrl, p?.KvkkConsentText);

    private static bool TryParseKind(string? kind, out GalleryPhotoKind parsed)
    {
        parsed = default;
        return !string.IsNullOrWhiteSpace(kind) && Enum.TryParse(kind, ignoreCase: true, out parsed);
    }
}

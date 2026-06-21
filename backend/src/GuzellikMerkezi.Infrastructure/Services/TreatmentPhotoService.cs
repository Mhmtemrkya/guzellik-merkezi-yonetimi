using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.TreatmentPhotos;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class TreatmentPhotoService : ITreatmentPhotoService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;

    public TreatmentPhotoService(GuzellikDbContext db, IAuditLogger audit, IFeatureService features)
    {
        _db = db;
        _audit = audit;
        _features = features;
    }

    public async Task<Result<IReadOnlyCollection<TreatmentPhotoDto>>> ListAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var rows = await _db.CustomerTreatmentPhotos.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.CustomerId == customerId)
            .OrderByDescending(x => x.TakenAtUtc)
            .Select(x => new TreatmentPhotoDto(
                x.Id, x.CustomerId, x.ServiceDefinitionId,
                x.ServiceDefinition != null ? x.ServiceDefinition.Name : null,
                x.Kind, x.ImageUrl, x.TakenAtUtc, x.Note))
            .ToListAsync(cancellationToken);
        return Result<IReadOnlyCollection<TreatmentPhotoDto>>.Success(rows);
    }

    public async Task<Result<TreatmentPhotoDto>> AddAsync(Guid tenantId, Guid customerId, CreateTreatmentPhotoRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.ClinicalBeforeAfter, cancellationToken))
            return Result<TreatmentPhotoDto>.Failure(Error.Conflict("Önce/Sonra galerisi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == customerId, cancellationToken);
        if (customer is null) return Result<TreatmentPhotoDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        if (string.IsNullOrWhiteSpace(request.ImageUrl)) return Result<TreatmentPhotoDto>.Failure(Error.Validation("İşlem fotoğrafı zorunlu."));

        var photo = new CustomerTreatmentPhoto(
            tenantId, customer.BranchId, customerId, request.ServiceDefinitionId, request.Kind,
            request.ImageUrl, request.TakenAtUtc ?? DateTime.UtcNow, request.Note);
        _db.CustomerTreatmentPhotos.Add(photo);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Create", "TreatmentPhoto", photo.Id,
            $"İşlem fotoğrafı eklendi ({photo.Kind})",
            new { photo.CustomerId, photo.Kind, photo.ServiceDefinitionId }, cancellationToken);

        string? serviceName = null;
        if (photo.ServiceDefinitionId.HasValue)
        {
            serviceName = await _db.ServiceDefinitions.AsNoTracking()
                .Where(s => s.Id == photo.ServiceDefinitionId.Value)
                .Select(s => s.Name).FirstOrDefaultAsync(cancellationToken);
        }
        return Result<TreatmentPhotoDto>.Success(new TreatmentPhotoDto(
            photo.Id, photo.CustomerId, photo.ServiceDefinitionId, serviceName,
            photo.Kind, photo.ImageUrl, photo.TakenAtUtc, photo.Note));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var photo = await _db.CustomerTreatmentPhotos.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (photo is null) return Result.Failure(Error.NotFound("Fotoğraf bulunamadı."));
        photo.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Delete", "TreatmentPhoto", photo.Id, "İşlem fotoğrafı silindi", null, cancellationToken);
        return Result.Success();
    }
}

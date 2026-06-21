using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.TreatmentPhotos;

/// <summary>Müşteri işlem günlüğü (önce/sonra/süreç fotoğrafları).</summary>
public interface ITreatmentPhotoService
{
    Task<Result<IReadOnlyCollection<TreatmentPhotoDto>>> ListAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);
    Task<Result<TreatmentPhotoDto>> AddAsync(Guid tenantId, Guid customerId, CreateTreatmentPhotoRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}

using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.TreatmentPhotos;

public sealed record TreatmentPhotoDto(
    Guid Id,
    Guid CustomerId,
    Guid? ServiceDefinitionId,
    string? ServiceName,
    TreatmentPhotoKind Kind,
    string ImageUrl,
    DateTime TakenAtUtc,
    string? Note);

public sealed record CreateTreatmentPhotoRequest(
    Guid? ServiceDefinitionId,
    TreatmentPhotoKind Kind,
    string ImageUrl,
    DateTime? TakenAtUtc,
    string? Note);

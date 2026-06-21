using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Ratings;

public interface IRatingService
{
    /// <summary>Randevu tamamlanınca çağrılır; 15 dk geçerli puanlama linki üretir (idempotent).</summary>
    Task<Result<RatingTokenDto>> IssueAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default);

    /// <summary>Public sayfa için link durumunu döner (anonim, token üzerinden).</summary>
    Task<Result<PublicRatingDto>> GetPublicAsync(Guid token, CancellationToken cancellationToken = default);

    /// <summary>Müşteri telefon + yıldız gönderir; telefon eşleşir ve süre dolmadıysa kaydeder.</summary>
    Task<Result<PublicRatingDto>> SubmitAsync(Guid token, SubmitRatingRequest request, CancellationToken cancellationToken = default);
}

namespace GuzellikMerkezi.Application.Features.Ratings;

/// <summary>Randevu "tamamlandı" işaretlenince personele dönen QR/link bilgisi.</summary>
/// <summary>
/// Panelde gösterilen müşteri yorumu. Herkese açık vitrinde (bkz. PublicSalonService) müşteri adı
/// MASKELENİR; burada kurum kendi müşterisini gördüğü için AD SOYAD AÇIK gelir.
/// </summary>
public sealed record AdminReviewDto(
    Guid Id,
    string CustomerName,
    DateTime SubmittedAtUtc,
    string? Comment,
    int StaffStars,
    int? SalonStars,
    string StaffName,
    string? ServiceName,
    string? BranchName);

/// <summary>Panel yorum özeti: salon ve personel ortalaması + toplam yorum sayısı.</summary>
public sealed record AdminReviewSummaryDto(
    int TotalCount,
    double? SalonAverage,
    double? StaffAverage,
    int WithCommentCount,
    IReadOnlyCollection<AdminReviewDto> Recent);

public sealed record RatingTokenDto(
    Guid Token,
    DateTime ExpiresAtUtc,
    string MaskedPhone,
    string StaffName,
    string? ServiceName,
    int LinkLifetimeMinutes);

/// <summary>Public puanlama sayfası için durum bilgisi (anonim, token üzerinden).</summary>
public sealed record PublicRatingDto(
    string Status,
    string StaffName,
    string? ServiceName,
    string? BusinessName,
    string MaskedPhone,
    DateTime ExpiresAtUtc,
    int? Stars,
    int? SalonStars);

/// <summary>Müşterinin yıldız gönderimi — telefon eşleşmesiyle doğrulanır.</summary>
public sealed record SubmitRatingRequest(string Phone, int Stars, string? Comment, int? SalonStars = null);

/// <summary>Personel panelinde randevu için puanlama linki üretme isteği.</summary>
public sealed record IssueRatingRequest(Guid AppointmentId);

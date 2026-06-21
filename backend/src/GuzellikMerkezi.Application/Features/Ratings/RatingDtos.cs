namespace GuzellikMerkezi.Application.Features.Ratings;

/// <summary>Randevu "tamamlandı" işaretlenince personele dönen QR/link bilgisi.</summary>
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
    int? Stars);

/// <summary>Müşterinin yıldız gönderimi — telefon eşleşmesiyle doğrulanır.</summary>
public sealed record SubmitRatingRequest(string Phone, int Stars, string? Comment);

/// <summary>Personel panelinde randevu için puanlama linki üretme isteği.</summary>
public sealed record IssueRatingRequest(Guid AppointmentId);

namespace GuzellikMerkezi.Application.Features.PublicSalons;

/// <summary>Salon listesi kartı (/salonlar).</summary>
public sealed record PublicSalonListItemDto(
    string Slug,
    string Name,
    string? City,
    string? CoverImage,
    string? Logo,
    double? SalonAvg,
    double? StaffAvg,
    int ReviewCount,
    IReadOnlyCollection<string> Categories,
    bool IsFeatured = false);

public sealed record PublicSalonListDto(IReadOnlyCollection<PublicSalonListItemDto> Items, int Total, int Page, int PageSize);

public sealed record PublicSalonServiceDto(Guid Id, string Name, int DurationMinutes, decimal Price, Guid? BranchId = null);
public sealed record PublicSalonServiceGroupDto(string Category, IReadOnlyCollection<PublicSalonServiceDto> Items);
public sealed record PublicSalonStaffDto(Guid Id, string FullName, string Title, string? PhotoUrl, double? AvgStars, int RatingCount, Guid? BranchId = null);
public sealed record PublicSalonBranchDto(Guid Id, string Name, string? City);
/// <summary>StarCounts: indeks 0→1 yıldız … 4→5 yıldız adetleri (salon yıldızı; yoksa personel yıldızı).</summary>
public sealed record PublicSalonAggregatesDto(double? SalonAvg, double? StaffAvg, int ReviewCount, IReadOnlyList<int> StarCounts);

/// <summary>Salon detay sayfası (/salon/[slug]).</summary>
public sealed record PublicSalonDetailDto(
    string Slug,
    string Name,
    string? Logo,
    bool IsFeatured,
    string? Description,
    string? Address,
    string? City,
    string? Instagram,
    string? PublicEmail,
    string? PublicPhone,
    string? WorkingHoursText,
    string? MapUrl,
    IReadOnlyCollection<string> SliderPhotos,
    IReadOnlyCollection<string> ServicePhotos,
    IReadOnlyCollection<PublicSalonServiceGroupDto> Services,
    IReadOnlyCollection<PublicSalonStaffDto> Staff,
    PublicSalonAggregatesDto Aggregates,
    IReadOnlyCollection<PublicSalonBranchDto> Branches);

/// <summary>Yorum kartı — müşteri adı maskeli döner.</summary>
public sealed record PublicSalonReviewDto(
    string MaskedName,
    DateTime SubmittedAtUtc,
    string? Comment,
    int StaffStars,
    int? SalonStars,
    string StaffName,
    string? ServiceName,
    string? BranchName = null);

/// <summary>Aggregates: istenen şube filtresine göre hesaplanmış ortalama/dağılım (şube bazlı yorum özeti).</summary>
public sealed record PublicSalonReviewListDto(IReadOnlyCollection<PublicSalonReviewDto> Items, int Total, int Page, int PageSize, PublicSalonAggregatesDto? Aggregates = null);

/// <summary>Filtre seçenekleri — yayında olan kurumların gerçek hizmet kategorileri ve şehirleri.</summary>
public sealed record PublicSalonFacetsDto(IReadOnlyCollection<string> Categories, IReadOnlyCollection<string> Cities);

/// <summary>Girişli müşterinin salon sayfasından manuel yorum göndermesi.</summary>
public sealed record SubmitSalonReviewRequest(int StaffStars, int SalonStars, string? Comment);

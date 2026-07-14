using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.PublicSalons;

/// <summary>
/// Herkese açık salon vitrini: yayınlanmış (IsPublished) + aktif/deneme + online randevu
/// özellikli kurumların listesi, detay profili ve yorumları. Anonim erişilir.
/// </summary>
public interface IPublicSalonService
{
    Task<Result<PublicSalonListDto>> ListAsync(string? q, string? city, string? category, int page, int pageSize, CancellationToken cancellationToken = default);
    Task<Result<PublicSalonDetailDto>> GetBySlugAsync(string slug, CancellationToken cancellationToken = default);
    /// <summary>Filtre seçenekleri: yayındaki kurumların hizmet kategorileri + şehirleri (60 sn cache).</summary>
    Task<Result<PublicSalonFacetsDto>> GetFacetsAsync(CancellationToken cancellationToken = default);
    Task<Result<PublicSalonReviewListDto>> GetReviewsAsync(string slug, Guid? branchId, int page, int pageSize, CancellationToken cancellationToken = default);

    /// <summary>
    /// Girişli portal müşterisinin manuel yorumu: o kurumda tamamlanmış ve henüz puanlanmamış
    /// en son randevusu bulunur, üzerinden doğrudan Submitted bir değerlendirme oluşturulur.
    /// </summary>
    Task<Result<PublicSalonReviewDto>> SubmitReviewAsync(Guid customerId, string slug, SubmitSalonReviewRequest request, CancellationToken cancellationToken = default);
}

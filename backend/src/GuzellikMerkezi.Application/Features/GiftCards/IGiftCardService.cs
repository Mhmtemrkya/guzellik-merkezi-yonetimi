using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.GiftCards;

public interface IGiftCardService
{
    Task<Result<IReadOnlyCollection<GiftCardDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Bir müşterinin BUGÜN KULLANILABİLİR çekleri. Satış ekranı müşteri seçilince bunu sorar ve
    /// çeke bağlı hizmeti/paketi kendiliğinden seçer.
    /// </summary>
    Task<Result<IReadOnlyCollection<GiftCardDto>>> ListForCustomerAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// QR okutup çeki bir müşteriye bağlar. Kart başka müşteriye bağlıysa devir yalnızca
    /// açık onayla (<c>AllowReassign</c>) yapılır — kart yanlışlıkla başkasının hesabına geçmemeli.
    /// </summary>
    Task<Result<GiftCardDto>> AssignCustomerAsync(Guid tenantId, AssignGiftCardCustomerRequest request, CancellationToken cancellationToken = default);
    Task<Result<GiftCardDto>> CreateAsync(Guid tenantId, CreateGiftCardRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Kartı düzeltir. KOD/TÜR/DEĞER DEĞİŞTİRİLEMEZ (bkz. <see cref="UpdateGiftCardRequest"/>);
    /// kullanılmaya başlanmış kartın müşterisi de devredilemez.
    /// </summary>
    Task<Result<GiftCardDto>> UpdateAsync(Guid tenantId, Guid id, UpdateGiftCardRequest request, CancellationToken cancellationToken = default);
    /// <summary>Koda göre doğrula (satış/adisyon akışında uygulamadan önce).</summary>
    Task<Result<GiftCardDto>> GetByCodeAsync(Guid tenantId, string code, CancellationToken cancellationToken = default);
    Task<Result<GiftCardDto>> RedeemAsync(Guid tenantId, Guid id, RedeemGiftCardRequest request, CancellationToken cancellationToken = default);
    Task<Result<GiftCardDto>> SetActiveAsync(Guid tenantId, Guid id, SetGiftCardActiveRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Kart üzerindeki QR'ın hedefi — ANONİM. Kod kurum içinde benzersiz olduğu için kurum
    /// anahtarı (slug) ZORUNLUDUR: yalnız kodla arama iki kurumun aynı kodunu karıştırırdı.
    /// </summary>
    Task<Result<PublicGiftCardDto>> GetPublicByCodeAsync(string slug, string code, CancellationToken cancellationToken = default);
}

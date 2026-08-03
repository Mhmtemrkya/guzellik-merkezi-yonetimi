using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Billing;

/// <summary>
/// Ödeme sağlayıcısı soyutlaması (iyzico / simülasyon).
///
/// <para>
/// KART VERİSİ BU ARAYÜZDEN GEÇMEZ. Kart, sağlayıcının barındırdığı ödeme formunda girilir;
/// biz yalnızca formu başlatır ve sonucunu okuruz. Böylece PCI-DSS kapsamı sağlayıcıda kalır.
/// İlk tahsilat "kartı kaydet" işaretli formla yapılır; sonraki yenilemeler
/// <see cref="ChargeStoredCardAsync"/> ile saklı kart referansları üzerinden çekilir.
/// </para>
/// </summary>
public interface IPaymentGateway
{
    /// <summary>Sağlayıcı adı (Iyzico | Simulation) — kayıtlara yazılır.</summary>
    string Provider { get; }

    /// <summary>
    /// Barındırılan ödeme formunu başlatır (ilk tahsilat + kart saklama).
    /// Dönen içerik kullanıcıya gösterilir; ödeme tamamlanınca sağlayıcı
    /// <c>callbackUrl</c>'e döner ve sonuç <see cref="RetrieveCheckoutAsync"/> ile okunur.
    /// </summary>
    Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default);

    /// <summary>Form sonucunu okur: ödeme başarılı mı, saklanan kartın referansları neler.</summary>
    Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default);

    /// <summary>Saklı kartla tahsilat (abonelik yenilemesi — kullanıcı etkileşimi yok).</summary>
    Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default);

    /// <summary>
    /// İşlem anahtarıyla sağlayıcıdaki durumu sorgular.
    /// YANITI KAYBEDİLEN ÇEKİM İÇİN ZORUNLU: ağ koptuğunda "para çekildi mi" sorusunun tek
    /// doğru cevabı sağlayıcıdır; körlemesine tekrar denemek çift çekim üretir.
    /// </summary>
    Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default);

    /// <summary>Tahsilatı iade eder (tutar boşsa tamamı).</summary>
    Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default);
}

/// <param name="ConversationId">Bizim ürettiğimiz benzersiz işlem anahtarı; sağlayıcıya aynen gider.</param>
/// <param name="CardUserKey">Kurumun mevcut kart cüzdanı (varsa) — yeni kart aynı cüzdana eklenir.</param>
/// <param name="CallbackUrl">Sağlayıcının ödeme sonrası POST edeceği mutlak adres.</param>
public sealed record CheckoutInitRequest(
    string ConversationId,
    decimal AmountTry,
    string BasketItemName,
    string BuyerId,
    string BuyerName,
    string BuyerSurname,
    string BuyerEmail,
    string BuyerPhone,
    string BuyerIdentityNumber,
    string BuyerAddress,
    string BuyerCity,
    string BuyerIp,
    string CallbackUrl,
    string? CardUserKey = null,
    bool RegisterCard = true);

/// <param name="CheckoutFormContent">Sayfaya gömülecek HTML/JS parçası (iyzico form script'i).</param>
/// <param name="PaymentPageUrl">Yönlendirme tercih edilirse kullanılacak barındırılan sayfa adresi.</param>
public sealed record CheckoutInitResult(string CheckoutToken, string? CheckoutFormContent, string? PaymentPageUrl);

/// <param name="Succeeded">Ödeme başarıyla tamamlandı mı?</param>
/// <param name="CardUserKey">Kart saklandıysa kurumun cüzdan anahtarı.</param>
/// <param name="CardToken">Kart saklandıysa bu karta özel token.</param>
public sealed record CheckoutResult(
    bool Succeeded,
    string ConversationId,
    string? ProviderPaymentId,
    decimal PaidAmountTry,
    string? CardUserKey,
    string? CardToken,
    string? MaskedCardNumber,
    string? CardAssociation,
    string? CardFamily,
    string? CardBankName,
    string? ErrorCode,
    string? ErrorMessage);

public sealed record StoredCardChargeRequest(
    string ConversationId,
    decimal AmountTry,
    string BasketItemName,
    string CardUserKey,
    string CardToken,
    string BuyerId,
    string BuyerName,
    string BuyerSurname,
    string BuyerEmail,
    string BuyerPhone,
    string BuyerIdentityNumber,
    string BuyerAddress,
    string BuyerCity,
    string BuyerIp);

public sealed record ChargeResult(
    bool Succeeded,
    string ConversationId,
    string? ProviderPaymentId,
    decimal PaidAmountTry,
    string? ErrorCode,
    string? ErrorMessage);

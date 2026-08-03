using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Billing;

/// <summary>
/// Kurum aboneliğinin para tarafı: ödeme formu başlatma, sonuç işleme, saklı kart yönetimi,
/// fatura listesi ve yenileme tahsilatı.
/// </summary>
public interface IBillingService
{
    /// <summary>Kurumun ödeme durumu: aktif paket, sonraki yenileme, saklı kart, son faturalar.</summary>
    Task<Result<BillingSummaryDto>> GetSummaryAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Seçilen paket için barındırılan ödeme formunu başlatır (ilk tahsilat + kart saklama).
    /// Abonelik BU AŞAMADA AÇILMAZ; yalnızca ödeme başarıyla tamamlanınca açılır.
    /// </summary>
    /// <param name="callbackUrl">
    /// Sağlayıcının ödeme sonrası döneceği MUTLAK adres. Uç katmanından geçirilir: doğru şema/host
    /// yalnızca isteğin kendisinden (ters proxy başlıkları uygulanmış hâliyle) bilinir ve iş katmanı
    /// web isteğine bağımlı olmamalıdır.
    /// </param>
    Task<Result<CheckoutStartedDto>> StartCheckoutAsync(Guid tenantId, Guid subscriptionPlanId, BillingPeriod period, string callbackUrl, CancellationToken ct = default);

    /// <summary>
    /// Sağlayıcı dönüşünü işler: ödeme başarılıysa kartı saklar, faturayı kapatır ve aboneliği başlatır.
    /// Aynı form anahtarıyla ikinci kez çağrılırsa idempotenttir.
    /// </summary>
    Task<Result<CheckoutCompletedDto>> CompleteCheckoutAsync(string checkoutToken, CancellationToken ct = default);

    /// <summary>Saklı kartı pasifleştirir — otomatik yenileme durur, abonelik süresi sonuna kadar devam eder.</summary>
    Task<Result> RemoveCardAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Kurumun faturaları (en yeni önce).</summary>
    Task<Result<IReadOnlyList<BillingInvoiceDto>>> ListInvoicesAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Yenileme tahsilatı — otomatik yenileme job'ı çağırır. Saklı karttan çeker, başarılıysa
    /// aboneliği uzatır ve fatura üretir; başarısızsa denemeyi kaydeder (dunning sayacı artar).
    /// </summary>
    Task<Result<RenewalOutcomeDto>> ChargeRenewalAsync(Guid tenantId, CancellationToken ct = default);
}

public sealed record BillingSummaryDto(
    Guid TenantId,
    string? PlanName,
    Guid? SubscriptionPlanId,
    string? BillingPeriod,
    DateTime? SubscriptionEndsAtUtc,
    DateTime? TrialEndsAtUtc,
    string Status,
    bool PaymentsEnabled,
    bool AutoRenewActive,
    StoredCardDto? Card,
    IReadOnlyList<BillingInvoiceDto> RecentInvoices);

/// <summary>Kartın yalnızca gösterilebilir bilgileri — token/cüzdan anahtarı ASLA dönmez.</summary>
public sealed record StoredCardDto(
    Guid Id,
    string? MaskedNumber,
    string? Association,
    string? Family,
    string? BankName,
    DateTime? LastChargedAtUtc,
    int ConsecutiveFailureCount);

public sealed record BillingInvoiceDto(
    Guid Id,
    string Number,
    DateTime PeriodStartUtc,
    DateTime PeriodEndUtc,
    decimal AmountTRY,
    decimal NetAmountTRY,
    decimal VatAmountTRY,
    decimal VatRate,
    string Status,
    DateTime IssuedAtUtc,
    DateTime DueDateUtc,
    DateTime? PaidAtUtc);

/// <param name="FormContent">Sayfaya gömülecek sağlayıcı formu (varsa).</param>
/// <param name="RedirectUrl">Yönlendirme tercih edilirse kullanılacak adres.</param>
public sealed record CheckoutStartedDto(string CheckoutToken, string? FormContent, string? RedirectUrl, decimal AmountTRY);

public sealed record CheckoutCompletedDto(bool Succeeded, string? Message, DateTime? SubscriptionEndsAtUtc, string? PlanName);

public sealed record RenewalOutcomeDto(bool Charged, int AttemptNumber, string? Message, DateTime? SubscriptionEndsAtUtc);

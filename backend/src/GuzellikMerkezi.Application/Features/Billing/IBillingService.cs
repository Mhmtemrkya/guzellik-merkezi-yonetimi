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

    /// <summary>
    /// Seçilen paket + dönem için kurumun GÜNCEL sayaçlarıyla (şube, müşteri, imzalı onam) teklif.
    /// Ödeme ekranı ve paket sayfası tutarı buradan gösterir; tahsilat aynı hesabı yapar.
    /// </summary>
    Task<Result<Domain.Billing.SubscriptionQuote>> GetQuoteAsync(Guid tenantId, Guid subscriptionPlanId, BillingPeriod period, CancellationToken ct = default);

    /// <summary>Yeni şube açılırsa bugün ne çekilir? Ücretsizse (deneme / şube başı olmayan paket) <c>ChargeRequired=false</c>.</summary>
    Task<Result<BranchChargeQuoteDto>> GetBranchChargeQuoteAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// ÜCRETLİ ŞUBE AÇMA — orantılı ücret iki yoldan biriyle HEMEN işlenir:
    /// <list type="bullet">
    /// <item><b>Card</b> (ödeme açık + kayıtlı kart): saklı karttan çekilir; şube ve ödenmiş fatura AYNI işlemde oluşur.
    /// Sonucu kesinleşmeyen çekimde şube açılmaz, satır bekler (tekrar çekilmez); red kesin durdurur.</item>
    /// <item><b>Invoice</b> (kart yok ya da ödeme altyapısı kapalı — platformun elle dönem açtığı kurum): şube ve
    /// AÇIK (Sent) fatura aynı işlemde oluşur; tahsilatı platform yapar. Kart reddi/belirsizliği ASLA buraya düşmez.</item>
    /// </list>
    /// <paramref name="confirmedAmountTRY"/> kullanıcının onayladığı tutardır; güncel teklifle tutmazsa hiçbir şey yazılmaz.
    /// </summary>
    Task<Result<BranchPurchaseResultDto>> PurchaseBranchAsync(Guid tenantId, BranchPurchaseRequest request, decimal confirmedAmountTRY, CancellationToken ct = default);

    /// <summary>
    /// Sonucu bekleyen EK ÜCRET ödemelerini (şube / onam kademesi) sağlayıcıya sorup sonuçlandırır
    /// (başarılıysa şubeyi / kademeyi açar). Arka plan taraması çağırır.
    /// </summary>
    Task<int> ResolvePendingBranchChargesAsync(CancellationToken ct = default);

    /// <summary>
    /// HACİM HAKKI (müşteri / dijital onam): sayaç, ödenmiş kapasite ve (kilitliyse ya da yaklaşıyorsa) bir
    /// sonraki kademenin bedeli — "sınırı geçen ödemeden kullanamaz" kuralının kurum ekranı.
    /// </summary>
    Task<Result<TierAllowanceDto>> GetTierAllowanceAsync(Guid tenantId, Domain.Billing.TierDimension dimension, CancellationToken ct = default);

    /// <summary>
    /// KADEME YÜKSELTME (müşteri / dijital onam) — bir sonraki kademenin orantılı farkı. <b>Card</b>: karttan
    /// çekilir, ödeme kesinleşince kademe açılır. <b>Invoice</b> (kart yok / ödeme kapalı / dönemsiz kurum):
    /// açık fatura kesilir ve kademe ANCAK platform faturayı "Ödendi" yapınca açılır — ödenmeden kullanılamaz.
    /// <paramref name="confirmedAmountTRY"/> güncel teklifle tutmazsa hiçbir şey yazılmaz.
    /// </summary>
    Task<Result<TierUpgradeResultDto>> PurchaseTierUpgradeAsync(Guid tenantId, Domain.Billing.TierDimension dimension, decimal confirmedAmountTRY, CancellationToken ct = default);

    /// <summary>Dijital onam boyutu — <see cref="GetTierAllowanceAsync"/>.</summary>
    Task<Result<TierAllowanceDto>> GetConsentAllowanceAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Dijital onam boyutu — <see cref="PurchaseTierUpgradeAsync"/>.</summary>
    Task<Result<TierUpgradeResultDto>> PurchaseConsentUpgradeAsync(Guid tenantId, decimal confirmedAmountTRY, CancellationToken ct = default);
}

/// <param name="Dimension">Customers | ConsentDocuments.</param>
/// <param name="Allowed">Bir kayıt daha eklenebilir / imzalanabilir mi?</param>
/// <param name="Count">Sayaç: kayıtlı müşteri (silinmemiş) ya da kotaya giren imzalı evrak (silinmiş dahil).</param>
/// <param name="Capacity">Ödenmiş kapasite; null = sınırsız.</param>
/// <param name="PaidTierAbove">Bugünü kapsayan ödenmiş faturalardaki en yüksek kademe eşiği.</param>
/// <param name="NextTierAbove">Satın alınabilecek bir sonraki kademenin eşiği; null = sınırsız.</param>
/// <param name="CanPurchase">Yükseltme şu an istenebilir mi (bekleyen ödeme / açık fatura yok, dönem uygun)?</param>
/// <param name="ChargeMethod">Card | Invoice | None (bkz. <see cref="BranchChargeMethods"/>).</param>
/// <param name="OpenInvoiceNumber">Bu kademe için kesilmiş, henüz ÖDENMEMİŞ fatura (varsa).</param>
public sealed record TierAllowanceDto(
    string Dimension,
    bool Allowed,
    int Count,
    int? Capacity,
    int? PaidTierAbove,
    int? NextTierAbove,
    decimal? NextTierMonthlyFee,
    bool CanPurchase,
    string? Reason,
    Domain.Billing.SubscriptionQuote? Quote,
    string ChargeMethod,
    string? CardMasked,
    string? OpenInvoiceNumber,
    DateTime? SubscriptionEndsAtUtc,
    TierImpactDto? Impact = null);

/// <summary>
/// KADEMENİN ÜCRETE ETKİSİ (kullanıcı isteği 18 Kas 2026: "10 bin onam formu gibi ek ücret gereken yerde 'ücretinize bu kadar
/// yansıyacak' uyarısı"). Sunucu hesaplar: <paramref name="Above"/> eşiği aşılınca aboneliğin dönem toplamı (KDV dahil)
/// <paramref name="CurrentTotal"/> → <paramref name="NextTotal"/>. Dönem = kurumun dönemi; denemede / dönemsizde aylık.
/// </summary>
public sealed record TierImpactDto(bool Trial, string Period, int Above, decimal CurrentTotal, decimal NextTotal, decimal Increase, decimal IncreaseNet);

public sealed record TierUpgradeRequest(decimal ConfirmedChargeTRY);

/// <param name="Unlocked">Kademe ŞİMDİ açıldı mı? (Invoice yolunda ödeme gelene kadar false.)</param>
/// <param name="Pending">Kart ödemesinin sonucu doğrulanıyor (tekrar ödeme yapılmaz).</param>
public sealed record TierUpgradeResultDto(bool Unlocked, bool Pending, string Message, decimal AmountTRY, string? InvoiceNumber);

/// <summary>Açılacak şubenin bilgisi — ödemeye anlık görüntü olarak yazılır (sonradan doğrulanan ödeme şubeyi bundan açar).</summary>
public sealed record BranchPurchaseRequest(string Name, string City, bool IsDefault);

/// <param name="ChargeRequired">Şube açmak bugün ücret gerektiriyor mu?</param>
/// <param name="Reason">Ücretsizse nedeni (deneme süresi, şube başı olmayan paket…) ya da engel (bekleyen kart ödemesi).</param>
/// <param name="CanPurchase">Ücret gerekiyorsa şu an işlenebilir mi (bekleyen şube ödemesi yok)?</param>
/// <param name="ChargeMethod">
/// <c>Card</c> = kayıtlı karttan çekilir; <c>Invoice</c> = açık fatura kesilir (kart yok / ödeme kapalı);
/// <c>None</c> = ücret yok.
/// </param>
public sealed record BranchChargeQuoteDto(
    bool ChargeRequired,
    bool CanPurchase,
    string? Reason,
    Domain.Billing.SubscriptionQuote? Quote,
    DateTime? SubscriptionEndsAtUtc,
    string? CardMasked,
    string ChargeMethod = BranchChargeMethods.None,
    BranchImpactDto? Impact = null,
    bool InvoicePayOnline = false);

// InvoicePayOnline: kesilen şube faturası maydanozasist.com ödeme sayfasında ödenebilir (ödeme sağlayıcısı Maydanoz).
// Değilse fatura platformca tahsil edilir; arayüz "Faturayı öde" düğmesi göstermez.

/// <summary>
/// YENİ ŞUBENİN ÜCRETE ETKİSİ (kullanıcı isteği 18 Kas 2026: şube eklerken "ücretinize bu kadar yansıyacak" görünsün;
/// deneme süresinde de). Tutarları SUNUCU hesaplar: şube başı birim fiyat (KDV hariç) ve bir şube daha eklenince
/// paketin aylık / yıllık toplamı (müşteri ve onam kademeleri dahil). Şube başına olmayan pakette boştur.
/// </summary>
public sealed record BranchImpactDto(
    string PlanName,
    bool Trial,
    int Branches,
    decimal UnitMonthly,
    decimal UnitYearly,
    decimal VatRate,
    Domain.Billing.SubscriptionQuote CurrentMonthly,
    Domain.Billing.SubscriptionQuote NextMonthly,
    Domain.Billing.SubscriptionQuote NextYearly,
    string? Period);

/// <summary>Dönem ortası şube ücretinin işlenme yolu (<see cref="BranchChargeQuoteDto.ChargeMethod"/>).</summary>
public static class BranchChargeMethods
{
    public const string None = "None";
    public const string Card = "Card";
    public const string Invoice = "Invoice";
}

/// <param name="Created">Şube açıldı mı? (false + <paramref name="Pending"/> = ödeme doğrulanıyor)</param>
/// <param name="AwaitingInvoicePayment">Kartsız kurum: şube talebi faturalandı, şube FATURA ÖDENİNCE açılacak.</param>
public sealed record BranchPurchaseResultDto(
    bool Created,
    bool Pending,
    string Message,
    Guid? BranchId,
    decimal AmountTRY,
    string? InvoiceNumber,
    bool AwaitingInvoicePayment = false);

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
    IReadOnlyList<BillingInvoiceDto> RecentInvoices,
    /// <summary>Bir sonraki yenilemede GÜNCEL sayaçlarla ne çekileceği (ücretli abonelik yoksa null).</summary>
    Domain.Billing.SubscriptionQuote? NextRenewalQuote = null,
    /// <summary>
    /// Ödemeyi alan sağlayıcı (ödeme açıkken; ör. "Maydanoz"). Maydanoz'da ödeme maydanozasist.com'da
    /// alınır ve kart saklanmaz: panel "kartını kaydedersen otomatik yenilenir" demez.
    /// </summary>
    string? PaymentProvider = null);

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
    DateTime? PaidAtUtc,
    /// <summary>Tahsilat anındaki kalem dökümü (yoksa eski/elle kesilmiş fatura).</summary>
    IReadOnlyList<Domain.Billing.QuoteLine>? Lines = null,
    string? Notes = null);

/// <param name="FormContent">Sayfaya gömülecek sağlayıcı formu (varsa).</param>
/// <param name="RedirectUrl">Yönlendirme tercih edilirse kullanılacak adres.</param>
public sealed record CheckoutStartedDto(string CheckoutToken, string? FormContent, string? RedirectUrl, decimal AmountTRY);

public sealed record CheckoutCompletedDto(bool Succeeded, string? Message, DateTime? SubscriptionEndsAtUtc, string? PlanName);

public sealed record RenewalOutcomeDto(bool Charged, int AttemptNumber, string? Message, DateTime? SubscriptionEndsAtUtc);

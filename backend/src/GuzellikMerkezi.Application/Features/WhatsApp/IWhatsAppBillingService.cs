using GuzellikMerkezi.Application.Common;
// Kartla kredi alma, abonelikle AYNI ödeme sözleşmesini kullanır (CheckoutStartedDto):
// ikinci bir "checkout başlatıldı" tipi üretmek, iki akışın sessizce ayrışmasına yol açardı.
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>
/// MESAJ KREDİSİ faturalama beyni (WhatsApp + SMS ortak cüzdan): kategori/parça bazlı kredi
/// maliyeti, gönderim öncesi rezervasyon (kota/kredi), teslim/kabul onayında kesinleşme,
/// başarısızlıkta iade; cüzdan yönetimi ve platform maliyet/paket/ayar CRUD'u.
/// Maliyetler KOD İÇİNE SABİT YAZILMAZ — WhatsApp için <see cref="WhatsAppPricingRule"/>, SMS için
/// <see cref="WhatsAppBillingSettings.SmsCreditsPerPart"/> veritabanından gelir.
/// </summary>
public interface IWhatsAppBillingService
{
    // --- WhatsApp gönderim akışı (WhatsAppService çağırır; aynı DbContext scope'unda tracked çalışır) ---

    /// <summary>
    /// Gönderim öncesi karar: kategori için kaynağı belirler ve gerekiyorsa kredi rezerve eder.
    /// SaveChanges ÇAĞIRMAZ — çağıran mesaj kaydıyla birlikte tek transaction'da kaydeder.
    /// </summary>
    Task<BillingDecision> ReserveAsync(Guid tenantId, WhatsAppMessageCategory category, bool live, CancellationToken ct = default);

    /// <summary>Gönderim ANINDA başarısız oldu (canlı çağrı hata döndü): rezervasyonu iade et. SaveChanges ÇAĞIRMAZ.</summary>
    Task RefundInlineAsync(Guid tenantId, WhatsAppMessage message, CancellationToken ct = default);

    /// <summary>Webhook "delivered": kredi rezervasyonunu kesinleştir. SaveChanges ÇAĞIRIR.</summary>
    Task CaptureAsync(WhatsAppMessage message, CancellationToken ct = default);

    /// <summary>Webhook "failed" (veya 48s teslim onayı gelmedi): kredi rezervasyonunu iade et. SaveChanges ÇAĞIRIR.</summary>
    Task RefundAsync(WhatsAppMessage message, CancellationToken ct = default);

    /// <summary>Teslim onayı gelmeyen eski rezervasyonları temizler (webhook kaçırıldıysa bakiye kilitli kalmasın).</summary>
    Task<int> SweepStaleReservationsAsync(TimeSpan olderThan, CancellationToken ct = default);

    // --- SMS gönderim akışı (NotificationService çağırır) ---
    // SMS'in teslim webhook'u yoktur: rezerve → gönder → sağlayıcı kabul ettiyse kesinleştir,
    // reddettiyse iade. Rezervasyon bildirim kaydına (NotificationLog) bağlanır.

    /// <summary>
    /// SMS için karar: önce plan SMS kotası, kota bittiyse (kurum izin verdiyse) mesaj kredisi.
    /// Karar <paramref name="log"/> satırına işlenir; kredi rezerve edildiyse cüzdan ve satır AYNI
    /// kayıtta yazılır (SaveChanges ÇAĞIRIR — rezervasyon dış etkiden ÖNCE kalıcı olmalı).
    /// Satıra daha önce bağlanmış bir rezervasyon varsa (devralınan bayat gönderim) YENİDEN
    /// rezerve edilmez, o kullanılır.
    /// </summary>
    Task<SmsBillingDecision> ReserveSmsAsync(Guid tenantId, NotificationLog log, int parts, bool live, CancellationToken ct = default);

    /// <summary>
    /// Sağlayıcı sonucu: kabul → kredi kesinleşir, red → iade. Satırın gönderim durumu ÇAĞIRAN
    /// tarafından önceden işaretlenir ve burada cüzdanla AYNI kayıtta yazılır. Krediden
    /// karşılanmayan (kota/simülasyon) satırda hiçbir şey yapmaz ve kaydetmez.
    /// </summary>
    Task SettleSmsAsync(NotificationLog log, bool accepted, CancellationToken ct = default);

    /// <summary>
    /// Askıda kalan SMS kredisini kapatır (rezervasyonla sonuç arasında süreç çöktüyse): gönderilmiş
    /// satırın kredisi kesinleşir, gönderilemeyen/sonucu bilinmeyenin kredisi iade edilir.
    /// </summary>
    Task<int> SweepStaleSmsReservationsAsync(TimeSpan olderThan, CancellationToken ct = default);

    /// <summary>
    /// ÖN KONTROL: bu kurum şu an HİÇ SMS gönderebilir mi? Gönderemezse kullanıcıya gösterilecek
    /// sebep, gönderebilirse null. Toplu gönderimde yüzlerce "başarısız" satır üretmeden önce sorulur.
    /// </summary>
    Task<string?> SmsAvailabilityBlockReasonAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Platform SMS hattı canlı mı (sağlayıcı açık ve yapılandırılmış)? Değilse gönderim simülasyondur.</summary>
    Task<bool> IsSmsLiveAsync(CancellationToken ct = default);

    /// <summary>
    /// Kurumun SMS'i şu an gerçekten gidebilir mi: kendi SMS hesabı etkin YA DA platform hattı canlı.
    /// Kurum SMS'i gönderen her yol bunu sorar (platform hattı kapalıyken kendi hesabı olan kurum simülasyona düşmesin).
    /// </summary>
    Task<bool> IsSmsLiveForTenantAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Kurumun KENDİ SMS hesabı (TenantSmsConnection) etkin mi (açık + doğrulanmış)? Etkinse SMS'ler
    /// o hesaptan gider; kota ve kredi düşmez. Kurum kapsamı olmayan çağrıda da doğru çalışır.
    /// </summary>
    Task<bool> IsOwnSmsAccountActiveAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>
    /// Toplu gönderim ÖNCESİ maliyet tahmini. <paramref name="unitsPerMessage"/>: SMS'te her mesajın
    /// parça sayısı, WhatsApp/e-postada her mesaj için 1. Hiçbir şey yazmaz, rezerve etmez.
    /// </summary>
    Task<MessagingCostEstimate> EstimateCostAsync(Guid tenantId, NotificationChannel channel, bool marketing,
        IReadOnlyList<int> unitsPerMessage, CancellationToken ct = default);

    // --- Kurum tarafı (cüzdan + kredi satın alma talebi) ---
    Task<Result<MessagingWalletDto>> GetWalletAsync(Guid tenantId, CancellationToken ct = default);
    Task<Result<IReadOnlyCollection<WalletTransactionDto>>> GetTransactionsAsync(Guid tenantId, int take, CancellationToken ct = default);

    /// <summary>Kurum ek kredi satın alma talebi oluşturur. Otomatik onay kapalıysa PENDING kalır (platform onaylar).</summary>
    Task<Result<CreditPurchaseDto>> RequestPurchaseAsync(Guid tenantId, TopUpRequest request, Guid? requestedByUserId, CancellationToken ct = default);
    Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetTenantPurchasesAsync(Guid tenantId, int take, CancellationToken ct = default);

    /// <summary>
    /// KARTLA KREDİ ALMA — iyzico Ortak Ödeme Sayfası açar (tek seferlik, taksitsiz, kart saklamasız).
    /// Talep PENDING açılır; kredi YALNIZ <see cref="CompleteCreditCheckoutAsync"/> sağlayıcıdan
    /// başarılı sonucu doğruladığında yüklenir — form başlatmak ödeme sayılmaz.
    /// </summary>
    Task<Result<CheckoutStartedDto>> StartCreditCheckoutAsync(Guid tenantId, TopUpRequest request, string callbackUrl, Guid? requestedByUserId, CancellationToken ct = default);

    /// <summary>Sağlayıcı dönüşünü doğrular ve başarılıysa cüzdana krediyi TEK KEZ yükler.</summary>
    Task<Result<CreditCheckoutCompletedDto>> CompleteCreditCheckoutAsync(string checkoutToken, CancellationToken ct = default);

    /// <summary>
    /// TAKILAN KARTLI TALEBİ SAĞLAYICIYA SORARAK ÇÖZER (platform yöneticisi).
    /// <para>
    /// Kartlı talep elle onaylanamaz — onaylanabilseydi tahsilat olmadan kredi yüklenirdi. Ama
    /// sonucu belirsiz kalan (3DS ortasında kopan, callback'i kaybolan) bir talebin de bir çıkışı
    /// olmalı. Buradaki çıkış KÖR ONAY DEĞİL: ödeme sağlayıcıya yeniden sorulur ve yalnız
    /// doğrulanmış başarı bakiyeyi artırır.
    /// </para>
    /// </summary>
    Task<Result<CreditCheckoutCompletedDto>> ReconcileCreditPurchaseAsync(Guid purchaseId, CancellationToken ct = default);

    // --- Platform tarafı: kredi satın alma onay kuyruğu ---
    Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetPurchasesAsync(bool onlyPending, CancellationToken ct = default);
    Task<Result<CreditPurchaseDto>> ApprovePurchaseAsync(Guid purchaseId, Guid? processedByUserId, CancellationToken ct = default);
    Task<Result<CreditPurchaseDto>> RejectPurchaseAsync(Guid purchaseId, Guid? processedByUserId, string? note, CancellationToken ct = default);

    // --- Platform tarafı: WhatsApp kategori kredi maliyetleri ---
    Task<Result<IReadOnlyCollection<WhatsAppPricingRuleDto>>> GetPricingRulesAsync(CancellationToken ct = default);
    Task<Result<WhatsAppPricingRuleDto>> SavePricingRuleAsync(Guid? id, SavePricingRuleRequest request, CancellationToken ct = default);
    Task<Result> DeletePricingRuleAsync(Guid id, CancellationToken ct = default);

    // --- Platform tarafı: kredi paketleri ---
    Task<Result<IReadOnlyCollection<CreditPackageDto>>> GetCreditPackagesAsync(bool includeInactive, CancellationToken ct = default);
    Task<Result<CreditPackageDto>> SaveCreditPackageAsync(Guid? id, SaveCreditPackageRequest request, CancellationToken ct = default);
    Task<Result> DeleteCreditPackageAsync(Guid id, CancellationToken ct = default);

    // --- Platform tarafı: genel ayarlar + kurum cüzdanı yönetimi ---
    Task<Result<WhatsAppBillingSettingsDto>> GetBillingSettingsAsync(CancellationToken ct = default);
    Task<Result<WhatsAppBillingSettingsDto>> SaveBillingSettingsAsync(SaveBillingSettingsRequest request, CancellationToken ct = default);
    Task<Result<MessagingWalletDto>> AdjustWalletAsync(Guid tenantId, AdjustWalletRequest request, Guid? performedByUserId, CancellationToken ct = default);
}

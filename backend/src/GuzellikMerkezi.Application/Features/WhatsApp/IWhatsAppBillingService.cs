using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>
/// WhatsApp kontör/faturalama beyni: kategori bazlı fiyat çözümü, gönderim öncesi rezervasyon (kota/kontör),
/// teslim onayında kesinleşme, başarısızlıkta iade; cüzdan yönetimi ve platform fiyat/paket/ayar CRUD'u.
/// Fiyatlar KOD İÇİNE SABİT YAZILMAZ — hepsi <see cref="WhatsAppPricingRule"/> üzerinden veritabanından gelir.
/// </summary>
public interface IWhatsAppBillingService
{
    // --- Gönderim akışı (WhatsAppService çağırır; aynı DbContext scope'unda tracked çalışır) ---

    /// <summary>
    /// Gönderim öncesi karar: kategori için kaynağı belirler ve gerekiyorsa kontör rezerve eder.
    /// SaveChanges ÇAĞIRMAZ — çağıran mesaj kaydıyla birlikte tek transaction'da kaydeder.
    /// </summary>
    Task<BillingDecision> ReserveAsync(Guid tenantId, WhatsAppMessageCategory category, bool live, CancellationToken ct = default);

    /// <summary>Gönderim ANINDA başarısız oldu (canlı çağrı hata döndü): rezervasyonu iade et. SaveChanges ÇAĞIRMAZ.</summary>
    Task RefundInlineAsync(Guid tenantId, WhatsAppMessage message, CancellationToken ct = default);

    /// <summary>Webhook "delivered": kontör rezervasyonunu kesinleştir. SaveChanges ÇAĞIRIR.</summary>
    Task CaptureAsync(WhatsAppMessage message, CancellationToken ct = default);

    /// <summary>Webhook "failed" (veya 48s teslim onayı gelmedi): kontör rezervasyonunu iade et. SaveChanges ÇAĞIRIR.</summary>
    Task RefundAsync(WhatsAppMessage message, CancellationToken ct = default);

    /// <summary>Teslim onayı gelmeyen eski rezervasyonları temizler (webhook kaçırıldıysa bakiye kilitli kalmasın).</summary>
    Task<int> SweepStaleReservationsAsync(TimeSpan olderThan, CancellationToken ct = default);

    // --- Kurum tarafı (cüzdan + kontör satın alma talebi) ---
    Task<Result<MessagingWalletDto>> GetWalletAsync(Guid tenantId, CancellationToken ct = default);
    Task<Result<IReadOnlyCollection<WalletTransactionDto>>> GetTransactionsAsync(Guid tenantId, int take, CancellationToken ct = default);

    /// <summary>Kurum ek kontör satın alma talebi oluşturur. Otomatik onay kapalıysa PENDING kalır (platform onaylar).</summary>
    Task<Result<CreditPurchaseDto>> RequestPurchaseAsync(Guid tenantId, TopUpRequest request, Guid? requestedByUserId, CancellationToken ct = default);
    Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetTenantPurchasesAsync(Guid tenantId, int take, CancellationToken ct = default);

    // --- Platform tarafı: kontör satın alma onay kuyruğu ---
    Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetPurchasesAsync(bool onlyPending, CancellationToken ct = default);
    Task<Result<CreditPurchaseDto>> ApprovePurchaseAsync(Guid purchaseId, Guid? processedByUserId, CancellationToken ct = default);
    Task<Result<CreditPurchaseDto>> RejectPurchaseAsync(Guid purchaseId, Guid? processedByUserId, string? note, CancellationToken ct = default);

    // --- Platform tarafı: fiyatlandırma ---
    Task<Result<IReadOnlyCollection<WhatsAppPricingRuleDto>>> GetPricingRulesAsync(CancellationToken ct = default);
    Task<Result<WhatsAppPricingRuleDto>> SavePricingRuleAsync(Guid? id, SavePricingRuleRequest request, CancellationToken ct = default);
    Task<Result> DeletePricingRuleAsync(Guid id, CancellationToken ct = default);

    // --- Platform tarafı: kontör paketleri ---
    Task<Result<IReadOnlyCollection<CreditPackageDto>>> GetCreditPackagesAsync(bool includeInactive, CancellationToken ct = default);
    Task<Result<CreditPackageDto>> SaveCreditPackageAsync(Guid? id, SaveCreditPackageRequest request, CancellationToken ct = default);
    Task<Result> DeleteCreditPackageAsync(Guid id, CancellationToken ct = default);

    // --- Platform tarafı: genel ayarlar + kurum cüzdanı yönetimi ---
    Task<Result<WhatsAppBillingSettingsDto>> GetBillingSettingsAsync(CancellationToken ct = default);
    Task<Result<WhatsAppBillingSettingsDto>> SaveBillingSettingsAsync(SaveBillingSettingsRequest request, CancellationToken ct = default);
    Task<Result<MessagingWalletDto>> AdjustWalletAsync(Guid tenantId, AdjustWalletRequest request, Guid? performedByUserId, CancellationToken ct = default);
}

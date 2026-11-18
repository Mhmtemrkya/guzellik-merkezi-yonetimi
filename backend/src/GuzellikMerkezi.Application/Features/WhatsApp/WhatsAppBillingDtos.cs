using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>WhatsApp gönderimi öncesi faturalama kararı: gönderilebilir mi, hangi kaynaktan, kaç kredi.</summary>
public sealed record BillingDecision(
    bool Allowed,
    WhatsAppMessageCategory Category,
    WhatsAppBillingSource Source,
    decimal Credits,
    string? BlockReason)
{
    public static BillingDecision Block(WhatsAppMessageCategory c, string reason) =>
        new(false, c, WhatsAppBillingSource.None, 0m, reason);
    public static BillingDecision Free(WhatsAppMessageCategory c, WhatsAppBillingSource source) =>
        new(true, c, source, 0m, null);
    public static BillingDecision Charged(WhatsAppMessageCategory c, decimal credits) =>
        new(true, c, WhatsAppBillingSource.Wallet, credits, null);
}

/// <summary>
/// SMS gönderimi öncesi faturalama kararı. SMS'in Meta kategorisi yoktur; maliyeti PARÇA sayısıdır
/// (parça × platformun belirlediği kredi).
/// </summary>
public sealed record SmsBillingDecision(
    bool Allowed,
    WhatsAppBillingSource Source,
    decimal Credits,
    int Parts,
    string? BlockReason)
{
    public static SmsBillingDecision Block(string reason, int parts) =>
        new(false, WhatsAppBillingSource.None, 0m, parts, reason);
    public static SmsBillingDecision Free(WhatsAppBillingSource source, int parts) =>
        new(true, source, 0m, parts, null);
    public static SmsBillingDecision Charged(decimal credits, int parts) =>
        new(true, WhatsAppBillingSource.Wallet, credits, parts, null);
}

/// <summary>
/// Toplu gönderim ÖNCESİ maliyet tahmini: hangi mesaj kotadan, hangisi krediden, kaçı gerçekten
/// gidebilir. Gönderimdeki karar kurallarının (kota → izin → kredi → tavan) aynısıyla hesaplanır;
/// eşzamanlı gönderimler araya girebileceği için TAHMİNDİR, kesin karar gönderimde verilir.
/// </summary>
/// <param name="QuotaRemaining">Plan kotasında kalan mesaj; -1 sınırsız.</param>
/// <param name="CostPerUnit">WhatsApp: mesaj başı kredi; SMS: parça başı kredi; e-posta: 0.</param>
/// <param name="Warnings">Kullanıcıya gösterilecek, gönderimi kısıtlayan durumlar (boşsa engel yok).</param>
public sealed record MessagingCostEstimate(
    int QuotaRemaining,
    int QuotaCovered,
    int CreditMessages,
    decimal CreditsNeeded,
    decimal AvailableCredits,
    decimal CostPerUnit,
    int ExpectedToSend,
    bool Live,
    IReadOnlyList<string> Warnings,
    /// <summary>SMS kurumun KENDİ hesabından gidecek (kota/kredi düşmez, ücreti sağlayıcısı keser).</summary>
    bool OwnAccount = false);

/// <summary>Kurum mesaj kredisi cüzdanı + aylık kullanım özeti (kurum yöneticisine gösterilir).</summary>
public sealed record MessagingWalletDto(
    Guid TenantId,
    decimal BalanceCredits,
    decimal ReservedCredits,
    decimal AvailableCredits,
    decimal LifetimeTopUpCredits,
    decimal LifetimeSpentCredits,
    decimal LowBalanceThresholdCredits,
    bool IsLowBalance,
    int UtilityUsed,
    int UtilityLimit,
    int MarketingUsed,
    int MarketingLimit,
    int SmsUsed,
    int SmsLimit,
    decimal MonthlySpentCredits,
    decimal? MonthlySpendCapCredits,
    bool MarketingEnabled,
    bool AllowWalletOverage,
    decimal UtilityCreditCost,
    decimal MarketingCreditCost,
    decimal SmsCreditsPerPart,
    int EstimatedUtilityMessages,
    int EstimatedSmsMessages,
    decimal CreditUnitPriceTry,
    bool BillingEnabled,
    IReadOnlyCollection<CreditPackageDto> CreditPackages,
    // Kredi ödemesi maydanozasist.com'da alınır (ödeme sağlayıcısı Maydanoz; kart ya da havale / EFT orada seçilir).
    bool PayOnMaydanoz = false,
    // ---- SMS KREDİSİ (18 Kas 2026: WhatsApp'tan AYRI bakiye; yukarıdaki bakiye/harcama/fiyat alanları WhatsApp'ındır) ----
    decimal SmsBalanceCredits = 0m,
    decimal SmsReservedCredits = 0m,
    decimal SmsAvailableCredits = 0m,
    decimal SmsLifetimeTopUpCredits = 0m,
    decimal SmsLifetimeSpentCredits = 0m,
    bool SmsIsLowBalance = false,
    decimal SmsMonthlySpentCredits = 0m,
    decimal SmsCreditUnitPriceTry = 0m);

public sealed record CreditPackageDto(
    Guid Id,
    string Name,
    string? Description,
    decimal PriceTry,
    decimal GrantsCredits,
    int DisplayOrder,
    bool IsActive,
    int EstimatedUtilityMessages,
    // Paketin yüklediği kanal (18 Kas 2026: SMS ve WhatsApp kredisi ayrı).
    CreditChannel Channel = CreditChannel.WhatsApp);

/// <param name="Unit">
/// Tutarların birimi. 12 Kas 2026 öncesi satırlar ₺ kontördür (<see cref="WalletUnit.Try"/>) ve
/// öyle gösterilmelidir; yeni satırlar kredidir.
/// </param>
public sealed record WalletTransactionDto(
    Guid Id,
    WalletTransactionType Type,
    WalletUnit Unit,
    decimal Amount,
    decimal BalanceAfter,
    string? Description,
    WhatsAppMessageCategory? Category,
    NotificationChannel? Channel,
    DateTime CreatedAtUtc);

/// <summary>
/// Kredi alım talebi: paket seçilir ya da paket dışı kredi miktarı girilir. Kanal paketten gelir; paket dışı
/// miktarda <paramref name="Channel"/> belirler (gönderilmezse WhatsApp — ayrımdan önceki istemciler).
/// </summary>
public sealed record TopUpRequest(Guid? CreditPackageId, decimal? Credits, CreditChannel? Channel = null);

/// <summary>Kredi satın alma talebi (kurum) / platform onay kuyruğu satırı.</summary>
public sealed record CreditPurchaseDto(
    Guid Id,
    Guid TenantId,
    string? TenantName,
    Guid? CreditPackageId,
    string PackageName,
    decimal PriceTry,
    decimal GrantsCredits,
    CreditPurchaseStatus Status,
    string? Note,
    DateTime CreatedAtUtc,
    DateTime? ProcessedAtUtc,
    /// <summary>Kartla ödendiyse sağlayıcı adı; havale talebinde null (platform kuyruğunda ayırt etmek için).</summary>
    string? Provider = null,
    CreditChannel Channel = CreditChannel.WhatsApp);

/// <param name="Succeeded">Tahsilat doğrulandı ve kredi yüklendi mi.</param>
/// <param name="NewBalanceCredits">Yükleme sonrası cüzdan kredisi (başarısızsa null).</param>
public sealed record CreditCheckoutCompletedDto(
    bool Succeeded, string? Message, decimal? GrantedCredits, decimal? NewBalanceCredits);

// --- Platform tarafı DTO'lar ---

public sealed record WhatsAppPricingRuleDto(
    Guid Id,
    WhatsAppMessageCategory Category,
    decimal MetaUsdPrice,
    decimal CreditCost,
    DateTime EffectiveFromUtc,
    string? Note,
    bool IsActive,
    decimal EstimatedMetaTry);

public sealed record SavePricingRuleRequest(
    WhatsAppMessageCategory Category,
    decimal MetaUsdPrice,
    decimal CreditCost,
    DateTime EffectiveFromUtc,
    string? Note);

public sealed record SaveCreditPackageRequest(
    string Name,
    string? Description,
    decimal PriceTry,
    decimal GrantsCredits,
    int DisplayOrder,
    bool IsActive,
    // null = korunur (alanı göndermeyen eski istemci); yeni pakette null = WhatsApp.
    CreditChannel? Channel = null);

public sealed record WhatsAppBillingSettingsDto(
    bool BillingEnabled,
    bool ChargeSimulated,
    decimal UsdTryRate,
    decimal LowBalanceThresholdCredits,
    decimal? DefaultMonthlySpendCapCredits,
    bool AutoApproveTopUps,
    decimal SmsCreditsPerPart,
    decimal CreditUnitPriceTry,
    decimal SmsCreditUnitPriceTry = 0m);

public sealed record SaveBillingSettingsRequest(
    bool BillingEnabled,
    bool ChargeSimulated,
    decimal UsdTryRate,
    decimal LowBalanceThresholdCredits,
    decimal? DefaultMonthlySpendCapCredits,
    bool AutoApproveTopUps,
    decimal SmsCreditsPerPart,
    decimal CreditUnitPriceTry,
    // SMS kredisinin birim fiyatı; null = korunur (tam gövde PUT'ta alanı göndermeyen eski istemci sıfırlamasın).
    decimal? SmsCreditUnitPriceTry = null);

public sealed record RejectPurchaseRequest(string? Note);

/// <summary>Platform düzeltmesi; kanal gönderilmezse WhatsApp (ayrımdan önceki istemciler).</summary>
public sealed record AdjustWalletRequest(decimal DeltaCredits, string? Description, CreditChannel? Channel = null);

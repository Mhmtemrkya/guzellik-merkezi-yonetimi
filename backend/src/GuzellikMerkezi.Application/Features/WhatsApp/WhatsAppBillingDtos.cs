using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>Gönderim öncesi faturalama kararı: gönderilebilir mi, hangi kaynaktan, ne kadar.</summary>
public sealed record BillingDecision(
    bool Allowed,
    WhatsAppMessageCategory Category,
    WhatsAppBillingSource Source,
    decimal AmountTry,
    string? BlockReason)
{
    public static BillingDecision Block(WhatsAppMessageCategory c, string reason) =>
        new(false, c, WhatsAppBillingSource.None, 0m, reason);
    public static BillingDecision Free(WhatsAppMessageCategory c, WhatsAppBillingSource source) =>
        new(true, c, source, 0m, null);
    public static BillingDecision Charged(WhatsAppMessageCategory c, decimal amount) =>
        new(true, c, WhatsAppBillingSource.Wallet, amount, null);
}

/// <summary>Kurum kontör cüzdanı + aylık kullanım özeti (kurum yöneticisine gösterilir).</summary>
public sealed record MessagingWalletDto(
    Guid TenantId,
    decimal BalanceTry,
    decimal ReservedTry,
    decimal AvailableTry,
    decimal LifetimeTopUpTry,
    decimal LifetimeSpentTry,
    decimal LowBalanceThresholdTry,
    bool IsLowBalance,
    int UtilityUsed,
    int UtilityLimit,
    int MarketingUsed,
    int MarketingLimit,
    decimal MonthlyWalletSpentTry,
    decimal? MonthlySpendCapTry,
    bool MarketingEnabled,
    bool AllowWalletOverage,
    decimal UtilityPriceTry,
    decimal MarketingPriceTry,
    int EstimatedUtilityMessages,
    bool BillingEnabled,
    IReadOnlyCollection<CreditPackageDto> CreditPackages);

public sealed record CreditPackageDto(
    Guid Id,
    string Name,
    string? Description,
    decimal PriceTry,
    decimal GrantsTry,
    int DisplayOrder,
    bool IsActive,
    int EstimatedUtilityMessages);

public sealed record WalletTransactionDto(
    Guid Id,
    WalletTransactionType Type,
    decimal AmountTry,
    decimal BalanceAfterTry,
    string? Description,
    WhatsAppMessageCategory? Category,
    DateTime CreatedAtUtc);

public sealed record TopUpRequest(Guid? CreditPackageId, decimal? AmountTry);

/// <summary>Kontör satın alma talebi (kurum) / platform onay kuyruğu satırı.</summary>
public sealed record CreditPurchaseDto(
    Guid Id,
    Guid TenantId,
    string? TenantName,
    Guid? CreditPackageId,
    string PackageName,
    decimal PriceTry,
    decimal GrantsTry,
    CreditPurchaseStatus Status,
    string? Note,
    DateTime CreatedAtUtc,
    DateTime? ProcessedAtUtc);

// --- Platform tarafı DTO'lar ---

public sealed record WhatsAppPricingRuleDto(
    Guid Id,
    WhatsAppMessageCategory Category,
    decimal MetaUsdPrice,
    decimal SellPriceTry,
    DateTime EffectiveFromUtc,
    string? Note,
    bool IsActive,
    decimal EstimatedMetaTry);

public sealed record SavePricingRuleRequest(
    WhatsAppMessageCategory Category,
    decimal MetaUsdPrice,
    decimal SellPriceTry,
    DateTime EffectiveFromUtc,
    string? Note);

public sealed record SaveCreditPackageRequest(
    string Name,
    string? Description,
    decimal PriceTry,
    decimal GrantsTry,
    int DisplayOrder,
    bool IsActive);

public sealed record WhatsAppBillingSettingsDto(
    bool BillingEnabled,
    bool ChargeSimulated,
    decimal UsdTryRate,
    decimal LowBalanceThresholdTry,
    decimal? DefaultMonthlySpendCapTry,
    bool AutoApproveTopUps);

public sealed record SaveBillingSettingsRequest(
    bool BillingEnabled,
    bool ChargeSimulated,
    decimal UsdTryRate,
    decimal LowBalanceThresholdTry,
    decimal? DefaultMonthlySpendCapTry,
    bool AutoApproveTopUps = false);

public sealed record RejectPurchaseRequest(string? Note);

public sealed record AdjustWalletRequest(decimal DeltaTry, string? Description);

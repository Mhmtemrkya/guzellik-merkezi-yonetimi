using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kontör cüzdanı defter kaydı (audit). Bakiyenin kaynağı cüzdanın kendi alanlarıdır; bu tablo her hareketi
/// (yükleme/rezervasyon/kesinleşme/iade/düzeltme) izlenebilir kılar. AmountTry işaretli: + bakiyeyi artırır
/// yönde, - azaltır yönde etkiyi temsil eder (raporlamada okunur).
/// </summary>
public sealed class WalletTransaction : Entity
{
    private WalletTransaction() { }

    public WalletTransaction(
        Guid tenantId,
        WalletTransactionType type,
        decimal amountTry,
        decimal balanceAfterTry,
        decimal reservedAfterTry,
        string? description = null,
        WhatsAppMessageCategory? category = null,
        Guid? whatsAppMessageId = null,
        Guid? creditPackageId = null,
        Guid? performedByUserId = null)
    {
        TenantId = tenantId;
        Type = type;
        AmountTry = decimal.Round(amountTry, 4);
        BalanceAfterTry = decimal.Round(balanceAfterTry, 4);
        ReservedAfterTry = decimal.Round(reservedAfterTry, 4);
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Category = category;
        WhatsAppMessageId = whatsAppMessageId;
        CreditPackageId = creditPackageId;
        PerformedByUserId = performedByUserId;
    }

    public Guid TenantId { get; private set; }
    public WalletTransactionType Type { get; private set; }
    public decimal AmountTry { get; private set; }
    public decimal BalanceAfterTry { get; private set; }
    public decimal ReservedAfterTry { get; private set; }
    public string? Description { get; private set; }
    public WhatsAppMessageCategory? Category { get; private set; }
    public Guid? WhatsAppMessageId { get; private set; }
    public Guid? CreditPackageId { get; private set; }
    /// <summary>İşlemi yapan (platform admin manuel işlem/yükleme onayı); sistem otomatiği için null.</summary>
    public Guid? PerformedByUserId { get; private set; }
}

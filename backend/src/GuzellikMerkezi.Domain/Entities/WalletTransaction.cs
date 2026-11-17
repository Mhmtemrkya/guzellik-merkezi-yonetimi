using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Mesaj kredisi cüzdanı defter kaydı (audit). Bakiyenin kaynağı cüzdanın kendi alanlarıdır; bu tablo
/// her hareketi (yükleme/rezervasyon/kesinleşme/iade/düzeltme/dönüşüm) izlenebilir kılar. Amount
/// işaretli: + bakiyeyi artıran, - azaltan yöndeki etkiyi temsil eder (raporlamada okunur).
///
/// <para>
/// BİRİM SATIRIN KENDİSİNDEDİR (<see cref="Unit"/>): 12 Kas 2026 öncesi satırlar ₺ kontör, sonrası
/// mesaj kredisidir. Eski satırların değerleri dönüştürülmez — geçmiş muhasebe yeniden yazılmaz.
/// </para>
/// </summary>
public sealed class WalletTransaction : Entity
{
    private WalletTransaction() { }

    public WalletTransaction(
        Guid tenantId,
        WalletTransactionType type,
        decimal amount,
        decimal balanceAfter,
        decimal reservedAfter,
        string? description = null,
        WhatsAppMessageCategory? category = null,
        Guid? whatsAppMessageId = null,
        Guid? creditPackageId = null,
        Guid? performedByUserId = null,
        NotificationChannel? channel = null,
        Guid? notificationLogId = null)
    {
        TenantId = tenantId;
        Type = type;
        Unit = WalletUnit.Credit; // yeni satırlar daima kredi
        Amount = decimal.Round(amount, 4);
        BalanceAfter = decimal.Round(balanceAfter, 4);
        ReservedAfter = decimal.Round(reservedAfter, 4);
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Category = category;
        WhatsAppMessageId = whatsAppMessageId;
        CreditPackageId = creditPackageId;
        PerformedByUserId = performedByUserId;
        Channel = channel;
        NotificationLogId = notificationLogId;
    }

    public Guid TenantId { get; private set; }
    public WalletTransactionType Type { get; private set; }

    /// <summary>Tutarların birimi: eski satırlar <see cref="WalletUnit.Try"/>, yeniler <see cref="WalletUnit.Credit"/>.</summary>
    public WalletUnit Unit { get; private set; }

    public decimal Amount { get; private set; }
    public decimal BalanceAfter { get; private set; }
    public decimal ReservedAfter { get; private set; }
    public string? Description { get; private set; }
    public WhatsAppMessageCategory? Category { get; private set; }
    public Guid? WhatsAppMessageId { get; private set; }
    public Guid? CreditPackageId { get; private set; }
    /// <summary>İşlemi yapan (platform admin manuel işlem/yükleme onayı); sistem otomatiği için null.</summary>
    public Guid? PerformedByUserId { get; private set; }

    /// <summary>Harcamanın kanalı (WhatsApp / SMS). Yükleme ve düzeltme satırlarında null.</summary>
    public NotificationChannel? Channel { get; private set; }

    /// <summary>SMS harcamasında ilgili bildirim kaydı (<see cref="NotificationLog"/>).</summary>
    public Guid? NotificationLogId { get; private set; }
}

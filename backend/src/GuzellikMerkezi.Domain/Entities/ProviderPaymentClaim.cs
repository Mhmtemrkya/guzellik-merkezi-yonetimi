using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// BİR DIŞ ÖDEME YALNIZCA BİR DEFTERE YAZILABİLİR — veritabanı kısıtıyla.
///
/// <para>
/// Para iki ayrı deftere giriyor: abonelik tahsilatı (<c>subscription_payments</c>) ve WhatsApp
/// kontörü (<c>whatsapp_credit_purchases</c>). İkisi de aynı sağlayıcı hesabından besleniyor.
/// Her iki akış da "bu ödeme kimliği başka yerde kullanılmış mı?" diye SORUP sonra yazıyordu;
/// bu <b>kontrol-sonra-yaz</b>dır ve eşzamanlı iki callback'te ikisi de "yok" cevabını alıp aynı
/// dış ödemeyi iki deftere birden işleyebilir. Sorgu bir garanti değil, yalnızca hızlı yoldur.
/// </para>
/// <para>
/// Garanti burada: <c>(Provider, ProviderPaymentId)</c> üzerinde BENZERSİZ indeks. Sahiplik,
/// para hareketinden ÖNCE bu tabloya yazılır; ikinci yazan duplicate-key ile reddedilir. Kilit
/// gerekmez — benzersiz ekleme kendi serileştirme noktasıdır.
/// </para>
/// </summary>
public sealed class ProviderPaymentClaim : Entity
{
    private ProviderPaymentClaim() { }

    public ProviderPaymentClaim(string provider, string providerPaymentId, string ledger, Guid ownerId, Guid tenantId)
    {
        if (string.IsNullOrWhiteSpace(provider)) throw new DomainException("Sağlayıcı adı zorunlu.");
        if (string.IsNullOrWhiteSpace(providerPaymentId)) throw new DomainException("Sağlayıcı ödeme kimliği zorunlu.");
        if (string.IsNullOrWhiteSpace(ledger)) throw new DomainException("Defter adı zorunlu.");

        Provider = provider.Trim();
        ProviderPaymentId = providerPaymentId.Trim();
        Ledger = ledger.Trim();
        OwnerId = ownerId;
        TenantId = tenantId;
        ClaimedAtUtc = DateTime.UtcNow;
    }

    /// <summary>Abonelik defteri.</summary>
    public const string SubscriptionLedger = "Subscription";

    /// <summary>WhatsApp kontör defteri.</summary>
    public const string WhatsAppCreditLedger = "WhatsAppCredit";

    public string Provider { get; private set; } = string.Empty;
    public string ProviderPaymentId { get; private set; } = string.Empty;

    /// <summary>Ödemeyi hangi defterin sahiplendiği — çakışmada hata mesajı bunu söyler.</summary>
    public string Ledger { get; private set; } = string.Empty;

    /// <summary>Sahiplenen satırın kimliği (SubscriptionPayment.Id ya da WhatsAppCreditPurchase.Id).</summary>
    public Guid OwnerId { get; private set; }

    public Guid TenantId { get; private set; }
    public DateTime ClaimedAtUtc { get; private set; }
}

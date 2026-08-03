using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Abonelik tahsilat DENEMESİ — başarılı da başarısız da olsa kalıcı kayıt.
///
/// <para>
/// Neden her deneme yazılır: para hareketinde "ne oldu" sorusunun cevabı sağlayıcının panelinde
/// değil bizde durmalı. Başarısız denemeler dunning (tekrar deneme) kararının ve kuruma
/// gösterilecek "kartınızdan çekim yapılamadı" bildiriminin dayanağıdır.
/// </para>
/// <para>
/// ÇİFT ÇEKİM KORUMASI: <see cref="ConversationId"/> bizim ürettiğimiz benzersiz işlem
/// anahtarıdır ve iyzico'ya aynen gönderilir. Aynı fatura dönemi için tekrar denenirken AYNI
/// değer kullanılır; sağlayıcı tarafında da bizde de tek işlem olarak eşleşir. Yanıtı alamadığımız
/// (ağ koptu) bir çekimin gerçekten geçip geçmediği bu anahtarla sorgulanır.
/// </para>
/// </summary>
public sealed class SubscriptionPayment : Entity
{
    private SubscriptionPayment() { }

    public SubscriptionPayment(
        Guid tenantId,
        Guid? subscriptionPlanId,
        BillingPeriod period,
        decimal amountTry,
        string provider,
        string conversationId,
        int attemptNumber,
        Guid? tenantInvoiceId = null,
        Guid? tenantPaymentMethodId = null)
    {
        if (tenantId == Guid.Empty) throw new DomainException("Tahsilat için kurum zorunlu.");
        if (amountTry <= 0) throw new DomainException("Tahsilat tutarı pozitif olmalı.");
        if (string.IsNullOrWhiteSpace(conversationId)) throw new DomainException("İşlem anahtarı zorunlu.");

        TenantId = tenantId;
        SubscriptionPlanId = subscriptionPlanId;
        Period = period;
        AmountTRY = amountTry;
        Provider = string.IsNullOrWhiteSpace(provider) ? "Iyzico" : provider.Trim();
        ConversationId = conversationId.Trim();
        AttemptNumber = attemptNumber < 1 ? 1 : attemptNumber;
        TenantInvoiceId = tenantInvoiceId;
        TenantPaymentMethodId = tenantPaymentMethodId;
        Status = Pending;
    }

    public const string Pending = "Pending";
    public const string Succeeded = "Succeeded";
    public const string Failed = "Failed";
    public const string Refunded = "Refunded";

    public Guid TenantId { get; private set; }
    public Tenant? Tenant { get; private set; }

    public Guid? TenantInvoiceId { get; private set; }
    public Guid? TenantPaymentMethodId { get; private set; }
    public Guid? SubscriptionPlanId { get; private set; }

    public BillingPeriod Period { get; private set; }
    public decimal AmountTRY { get; private set; }

    /// <summary>Iyzico | Simulation</summary>
    public string Provider { get; private set; } = "Iyzico";

    /// <summary>Bizim ürettiğimiz benzersiz işlem anahtarı (iyzico conversationId). Tekrar denemede AYNI kalır.</summary>
    public string ConversationId { get; private set; } = string.Empty;

    /// <summary>Sağlayıcının işlem kimliği — iade ve mutabakat bununla yapılır.</summary>
    public string? ProviderPaymentId { get; private set; }

    /// <summary>Pending | Succeeded | Failed | Refunded</summary>
    public string Status { get; private set; } = Pending;

    /// <summary>Bu fatura dönemi için kaçıncı deneme (dunning sayacı).</summary>
    public int AttemptNumber { get; private set; }

    public string? ErrorCode { get; private set; }
    public string? ErrorMessage { get; private set; }
    public DateTime? CompletedAtUtc { get; private set; }

    public void MarkSucceeded(string? providerPaymentId, DateTime utcNow)
    {
        if (Status == Succeeded) return; // idempotent: webhook + senkron yanıt aynı anda gelebilir
        Status = Succeeded;
        ProviderPaymentId = string.IsNullOrWhiteSpace(providerPaymentId) ? ProviderPaymentId : providerPaymentId.Trim();
        ErrorCode = null;
        ErrorMessage = null;
        CompletedAtUtc = utcNow;
        Touch(utcNow);
    }

    public void MarkFailed(string? errorCode, string? errorMessage, DateTime utcNow)
    {
        // BAŞARILI BİR TAHSİLAT SONRADAN "BAŞARISIZ"A ÇEVRİLEMEZ: geciken bir hata webhook'u,
        // parası çekilmiş bir dönemi ödenmemiş gösterip kurumu haksız yere askıya aldırırdı.
        if (Status == Succeeded) return;
        Status = Failed;
        ErrorCode = Trim(errorCode, 64);
        ErrorMessage = Trim(errorMessage, 512);
        CompletedAtUtc = utcNow;
        Touch(utcNow);
    }

    public void MarkRefunded(DateTime utcNow)
    {
        if (Status != Succeeded) throw new DomainException("Yalnızca başarılı tahsilat iade edilebilir.");
        Status = Refunded;
        Touch(utcNow);
    }

    public void AttachInvoice(Guid invoiceId)
    {
        TenantInvoiceId = invoiceId;
        Touch();
    }

    private static string? Trim(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? null : (s.Length > max ? s[..max] : s.Trim());
}

using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Gönderilen/alınan her WhatsApp mesajının kaydı. Gelen yanıtı doğru randevuya bağlamak için telefon
/// (normalize, eşleştirme amaçlı) ve AppointmentId tutulur.
/// </summary>
public sealed class WhatsAppMessage : Entity
{
    private WhatsAppMessage() { }

    public WhatsAppMessage(
        Guid tenantId, Guid? branchId, Guid? appointmentId, Guid? customerId,
        WhatsAppMessageDirection direction, string phone, string body, WhatsAppMessageStatus status,
        string? templateName = null, string? providerMessageId = null,
        WhatsAppReplyIntent intent = WhatsAppReplyIntent.Unknown, string? error = null,
        Guid? waitlistEntryId = null,
        WhatsAppMessageCategory category = WhatsAppMessageCategory.Utility,
        WhatsAppBillingSource billingSource = WhatsAppBillingSource.None,
        decimal chargedAmountTry = 0m)
    {
        TenantId = tenantId;
        BranchId = branchId;
        AppointmentId = appointmentId;
        CustomerId = customerId;
        Direction = direction;
        Phone = phone ?? string.Empty;
        Body = body ?? string.Empty;
        Status = status;
        TemplateName = templateName;
        ProviderMessageId = providerMessageId;
        Intent = intent;
        ErrorMessage = error;
        WaitlistEntryId = waitlistEntryId;
        Category = category;
        BillingSource = billingSource;
        ChargedAmountTry = decimal.Round(chargedAmountTry, 4);
        if (status is WhatsAppMessageStatus.Delivered or WhatsAppMessageStatus.Read or WhatsAppMessageStatus.Simulated)
            DeliveredAtUtc = DateTime.UtcNow;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid? AppointmentId { get; private set; }
    /// <summary>Bekleme listesi teklifi / teklife gelen yanıt bu kayda bağlanır (Evet→randevu, Hayır→sıradaki).</summary>
    public Guid? WaitlistEntryId { get; private set; }
    public Guid? CustomerId { get; private set; }
    public WhatsAppMessageDirection Direction { get; private set; }
    public string Phone { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;
    public WhatsAppMessageStatus Status { get; private set; }
    public WhatsAppReplyIntent Intent { get; private set; }
    public string? TemplateName { get; private set; }
    public string? ProviderMessageId { get; private set; }
    public string? ErrorMessage { get; private set; }

    /// <summary>Meta faturalama kategorisi (fiyat bundan çözülür).</summary>
    public WhatsAppMessageCategory Category { get; private set; } = WhatsAppMessageCategory.Utility;

    /// <summary>Ücretin kaynağı: kota / kontör / simülasyon.</summary>
    public WhatsAppBillingSource BillingSource { get; private set; } = WhatsAppBillingSource.None;

    /// <summary>Kontörden rezerve/kesilen tutar (₺). Kota veya simülasyon ise 0.</summary>
    public decimal ChargedAmountTry { get; private set; }

    /// <summary>Meta webhook "delivered" (veya simülasyon) zamanı — kotayı ve kesinleşmeyi bu tetikler.</summary>
    public DateTime? DeliveredAtUtc { get; private set; }

    /// <summary>Webhook teslim onayı: kesinleşmiş say. Zaten işlendiyse false döner (idempotent).</summary>
    public bool MarkDelivered()
    {
        if (DeliveredAtUtc.HasValue || Status == WhatsAppMessageStatus.Failed) return false;
        Status = WhatsAppMessageStatus.Delivered;
        DeliveredAtUtc = DateTime.UtcNow;
        return true;
    }

    public void MarkRead()
    {
        if (Status is WhatsAppMessageStatus.Delivered or WhatsAppMessageStatus.Sent)
            Status = WhatsAppMessageStatus.Read;
    }

    /// <summary>Webhook başarısızlık: iade edilecek. Daha önce teslim/başarısız işlendiyse false (idempotent).</summary>
    public bool MarkFailed(string? error)
    {
        if (DeliveredAtUtc.HasValue || Status == WhatsAppMessageStatus.Failed) return false;
        Status = WhatsAppMessageStatus.Failed;
        ErrorMessage = string.IsNullOrWhiteSpace(error) ? ErrorMessage : (error!.Length > 500 ? error[..500] : error);
        return true;
    }

    /// <summary>Kontör iade edildikten sonra çağrılır (tekrar iade edilmesin diye kaynak sıfırlanır).</summary>
    public void ClearCharge()
    {
        ChargedAmountTry = 0m;
        BillingSource = WhatsAppBillingSource.None;
    }
}

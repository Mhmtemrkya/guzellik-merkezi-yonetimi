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
        WhatsAppReplyIntent intent = WhatsAppReplyIntent.Unknown, string? error = null)
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
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid? AppointmentId { get; private set; }
    public Guid? CustomerId { get; private set; }
    public WhatsAppMessageDirection Direction { get; private set; }
    public string Phone { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;
    public WhatsAppMessageStatus Status { get; private set; }
    public WhatsAppReplyIntent Intent { get; private set; }
    public string? TemplateName { get; private set; }
    public string? ProviderMessageId { get; private set; }
    public string? ErrorMessage { get; private set; }
}

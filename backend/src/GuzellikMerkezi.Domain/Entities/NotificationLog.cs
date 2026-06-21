using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bildirim gönderim kaydı. Her tek alıcı için bir satır. Gerçek SMS/WhatsApp provider'a
/// gönderim tetiklenmediği için MVP'de Status=Sent doğrudan yazılır; provider entegrasyonu
/// eklendiğinde Queued → Sent / Failed akışı bu kayıt üzerinde işler.
/// </summary>
public sealed class NotificationLog : Entity
{
    private NotificationLog() { }

    public NotificationLog(
        Guid tenantId,
        Guid? branchId,
        Guid? templateId,
        Guid? customerId,
        NotificationChannel channel,
        string recipient,
        string body,
        NotificationLogStatus status,
        string? errorMessage = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        TemplateId = templateId;
        CustomerId = customerId;
        Channel = channel;
        Recipient = (recipient ?? string.Empty).Trim();
        Body = (body ?? string.Empty).Trim();
        Status = status;
        ErrorMessage = string.IsNullOrWhiteSpace(errorMessage) ? null : errorMessage.Trim();
        SentAtUtc = status == NotificationLogStatus.Sent ? DateTime.UtcNow : null;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public Guid? TemplateId { get; private set; }
    public NotificationTemplate? Template { get; private set; }

    public Guid? CustomerId { get; private set; }
    public Customer? Customer { get; private set; }

    public NotificationChannel Channel { get; private set; }
    /// <summary>Telefon numarası / e-posta adresi.</summary>
    public string Recipient { get; private set; } = string.Empty;
    /// <summary>Token'ları doldurulmuş gerçek mesaj.</summary>
    public string Body { get; private set; } = string.Empty;
    public NotificationLogStatus Status { get; private set; }
    public string? ErrorMessage { get; private set; }
    public DateTime? SentAtUtc { get; private set; }

    public void MarkSent()
    {
        Status = NotificationLogStatus.Sent;
        SentAtUtc = DateTime.UtcNow;
        ErrorMessage = null;
        Touch();
    }

    public void MarkFailed(string error)
    {
        Status = NotificationLogStatus.Failed;
        ErrorMessage = string.IsNullOrWhiteSpace(error) ? "Bilinmeyen hata" : error.Trim();
        Touch();
    }
}

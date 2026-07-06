using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Belirli bir kullanıcıya (TenantUser) hedeflenmiş uygulama-içi bildirim.
/// Rol bazlı olaylar üretilirken hedef kullanıcılar oluşturma anında çözülür ve
/// her alıcı için bir satır yazılır → okundu durumu kullanıcı başına doğal olarak izlenir.
/// Mobil hem feed (yoklama) hem FCM push ile bu kaydı görür.
/// </summary>
public sealed class AppNotification : Entity
{
    private AppNotification() { }

    public AppNotification(
        Guid tenantId,
        Guid? branchId,
        Guid recipientUserId,
        AppNotificationType type,
        AppNotificationSeverity severity,
        string title,
        string body,
        string? dataJson,
        string? dedupeKey)
    {
        if (recipientUserId == Guid.Empty) throw new DomainException("Bildirim alıcısı boş olamaz.");
        TenantId = tenantId;
        BranchId = branchId;
        RecipientUserId = recipientUserId;
        Type = type;
        Severity = severity;
        Title = string.IsNullOrWhiteSpace(title) ? "Bildirim" : title.Trim();
        Body = body?.Trim() ?? string.Empty;
        DataJson = string.IsNullOrWhiteSpace(dataJson) ? null : dataJson;
        DedupeKey = string.IsNullOrWhiteSpace(dedupeKey) ? null : dedupeKey.Trim();
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    /// <summary>Alıcı kullanıcı (TenantUser.Id). Feed bu kolona göre süzülür.</summary>
    public Guid RecipientUserId { get; private set; }
    public TenantUser? Recipient { get; private set; }

    public AppNotificationType Type { get; private set; }
    public AppNotificationSeverity Severity { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;

    /// <summary>Deep-link + varlık kimlikleri (ör. {"route":"/approvals","id":"..."}). Mobil tıklamada kullanır.</summary>
    public string? DataJson { get; private set; }

    /// <summary>Aynı olayın tekrar bildirimini engellemek için idempotent anahtar (alıcı + kaynak).</summary>
    public string? DedupeKey { get; private set; }

    public bool IsRead { get; private set; }
    public DateTime? ReadAtUtc { get; private set; }

    public void MarkRead(DateTime utcNow)
    {
        if (IsRead) return;
        IsRead = true;
        ReadAtUtc = utcNow;
        Touch(utcNow);
    }
}

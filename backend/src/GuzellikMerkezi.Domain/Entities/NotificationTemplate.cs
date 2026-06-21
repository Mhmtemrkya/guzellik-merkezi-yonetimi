using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bildirim şablonu — SMS / WhatsApp / E-posta kanallarına gönderilebilecek mesaj.
/// Gövde değişken token'ları içerebilir: {{ad}}, {{tarih}}, {{saat}}, {{hizmet}}, {{personel}}.
/// </summary>
public sealed class NotificationTemplate : Entity
{
    private NotificationTemplate() { }

    public NotificationTemplate(
        Guid tenantId,
        Guid? branchId,
        string name,
        NotificationChannel channel,
        NotificationTrigger trigger,
        string body,
        NotificationTemplateStatus status = NotificationTemplateStatus.Draft)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Rename(name);
        Channel = channel;
        Trigger = trigger;
        UpdateBody(body);
        Status = status;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public string Name { get; private set; } = string.Empty;
    public NotificationChannel Channel { get; private set; }
    public NotificationTrigger Trigger { get; private set; }
    public string Body { get; private set; } = string.Empty;
    public NotificationTemplateStatus Status { get; private set; }

    /// <summary>Toplam başarılı gönderim sayısı (denormalized).</summary>
    public int TotalSentCount { get; private set; }
    public DateTime? LastSentAtUtc { get; private set; }

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Şablon adı boş olamaz.");
        if (name.Length > 160) throw new DomainException("Şablon adı 160 karakteri aşamaz.");
        Name = name.Trim();
        Touch();
    }

    public void UpdateBody(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) throw new DomainException("Mesaj gövdesi boş olamaz.");
        if (body.Length > 2000) throw new DomainException("Mesaj gövdesi 2000 karakteri aşamaz.");
        Body = body.Trim();
        Touch();
    }

    public void ChangeChannel(NotificationChannel channel) { Channel = channel; Touch(); }
    public void ChangeTrigger(NotificationTrigger trigger) { Trigger = trigger; Touch(); }
    public void Activate() { Status = NotificationTemplateStatus.Active; Touch(); }
    public void Draft() { Status = NotificationTemplateStatus.Draft; Touch(); }
    public void MarkPendingApproval() { Status = NotificationTemplateStatus.PendingApproval; Touch(); }

    public void RecordSent(DateTime sentAtUtc)
    {
        TotalSentCount++;
        LastSentAtUtc = sentAtUtc;
        Touch(sentAtUtc);
    }
}

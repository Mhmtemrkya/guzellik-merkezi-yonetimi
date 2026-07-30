using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Müşterinin onam formu KAYDI — şablonun o müşteri/işlem için alınmış kopyası.
///
/// Akış: personel formu açar (Draft) → "Tablete Aktar" ile tek kullanımlık imza oturumu üretilir
/// (AwaitingSignature + token) → tablet formu gösterir, müşteri onay kutularını işaretleyip imzalar
/// (Signed). İmzalı kayıt kilitlidir; metin, işaretlenen maddeler, imza görseli, tarih/saat ve
/// cihaz bilgisi kaydın içinde saklanır — şablon sonradan değişse bile belge değişmez.
/// </summary>
public sealed class CustomerConsentForm : Entity
{
    /// <summary>İmza oturumunun varsayılan ömrü (dakika). Tablet başında imzalanacak kadar uzun, açık kalmayacak kadar kısa.</summary>
    public const int SessionLifetimeMinutes = 30;

    private CustomerConsentForm() { }

    public CustomerConsentForm(
        Guid tenantId,
        Guid? branchId,
        Guid customerId,
        Guid? appointmentId,
        Guid? templateId,
        string title,
        string body,
        string? checkItemsJson,
        bool requiresSignature,
        string? questionsJson,
        string? customerName,
        Guid? serviceDefinitionId,
        string? serviceName,
        Guid? staffMemberId,
        string? staffName,
        string? staffNotes)
    {
        if (string.IsNullOrWhiteSpace(title)) throw new DomainException("Form başlığı boş olamaz.");
        if (string.IsNullOrWhiteSpace(body)) throw new DomainException("Form metni boş olamaz.");
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        AppointmentId = appointmentId;
        ConsentFormTemplateId = templateId;
        Title = title.Trim();
        Body = body.Trim();
        CheckItemsJson = string.IsNullOrWhiteSpace(checkItemsJson) ? null : checkItemsJson.Trim();
        RequiresSignature = requiresSignature;
        QuestionsJson = string.IsNullOrWhiteSpace(questionsJson) ? null : questionsJson.Trim();
        CustomerName = Clip(customerName, 200);
        ServiceDefinitionId = serviceDefinitionId;
        ServiceName = Clip(serviceName, 200);
        StaffMemberId = staffMemberId;
        StaffName = Clip(staffName, 200);
        StaffNotes = Clip(staffNotes, 2000);
        Status = ConsentFormStatus.Draft;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Guid? AppointmentId { get; private set; }
    public Guid? ConsentFormTemplateId { get; private set; }

    // --- şablondan kopyalanan belge içeriği (imzalandıktan sonra değişmez) ---
    public string Title { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;
    public string? CheckItemsJson { get; private set; }
    /// <summary>Şablondan kopyalanan EVET/HAYIR soruları (bkz. <see cref="ConsentFormTemplate.QuestionsJson"/>).</summary>
    public string? QuestionsJson { get; private set; }
    public bool RequiresSignature { get; private set; } = true;

    // --- bağlam ---
    /// <summary>Belge üzerine basılacak müşteri adı (PII — şifreli saklanır).</summary>
    public string? CustomerName { get; private set; }
    public Guid? ServiceDefinitionId { get; private set; }
    public string? ServiceName { get; private set; }
    public Guid? StaffMemberId { get; private set; }
    public string? StaffName { get; private set; }
    /// <summary>Personelin forma eklediği serbest notlar (doz, bölge, uyarı vb.).</summary>
    public string? StaffNotes { get; private set; }

    // --- imza oturumu ---
    public ConsentFormStatus Status { get; private set; }
    /// <summary>Tek kullanımlık imza oturumu anahtarı; tablet bu token ile formu açar.</summary>
    public Guid? SessionToken { get; private set; }
    /// <summary>Formun açılacağı tablet (istasyon) adı — tablet kendi adıyla bekleyen formu yoklar.</summary>
    public string? StationName { get; private set; }
    public DateTime? SessionExpiresAtUtc { get; private set; }

    // --- imza sonucu ---
    /// <summary>Müşterinin işaretlediği onay maddeleri — JSON string dizisi.</summary>
    public string? CheckedItemsJson { get; private set; }
    /// <summary>
    /// Müşterinin sorulara verdiği yanıtlar — JSON dizisi:
    /// <c>[{ "id": "...", "text": "…", "answer": true, "note": "…" }]</c>. Soru metni de kopyalanır ki
    /// şablon sonradan değişse bile imzalı belgede hangi soruya ne yanıt verildiği okunabilsin.
    /// </summary>
    public string? AnswersJson { get; private set; }
    /// <summary>İmza görseli (base64 PNG data-URL).</summary>
    public string? SignatureImage { get; private set; }
    public DateTime? SignedAtUtc { get; private set; }
    /// <summary>İmzayı atan kişinin beyan ettiği ad (müşteri ya da yasal temsilcisi) — PII.</summary>
    public string? SignerName { get; private set; }
    public string? SignerDevice { get; private set; }
    public string? SignerIp { get; private set; }

    public bool IsSigned => Status == ConsentFormStatus.Signed;

    public void UpdateDraft(string? staffNotes, Guid? staffMemberId, string? staffName)
    {
        EnsureEditable();
        StaffNotes = Clip(staffNotes, 2000);
        if (staffMemberId.HasValue) StaffMemberId = staffMemberId;
        if (!string.IsNullOrWhiteSpace(staffName)) StaffName = Clip(staffName, 200);
        Touch();
    }

    /// <summary>Tek kullanımlık imza oturumu açar ve formu seçilen tablete yönlendirir.</summary>
    public Guid StartSession(string? stationName, DateTime nowUtc, int lifetimeMinutes = SessionLifetimeMinutes)
    {
        EnsureEditable();
        if (nowUtc.Kind != DateTimeKind.Utc) throw new DomainException("Zaman UTC olmalı.");
        if (lifetimeMinutes < 1) throw new DomainException("Oturum süresi geçersiz.");
        SessionToken = Guid.NewGuid();
        StationName = Clip(stationName, 120);
        SessionExpiresAtUtc = nowUtc.AddMinutes(lifetimeMinutes);
        Status = ConsentFormStatus.AwaitingSignature;
        Touch();
        return SessionToken.Value;
    }

    /// <summary>Bekleyen imza oturumunu kapatır (personel vazgeçti / tablet değişti).</summary>
    public void CancelSession()
    {
        if (Status != ConsentFormStatus.AwaitingSignature) return;
        SessionToken = null;
        SessionExpiresAtUtc = null;
        StationName = null;
        Status = ConsentFormStatus.Draft;
        Touch();
    }

    public bool IsSessionValid(DateTime nowUtc) =>
        Status == ConsentFormStatus.AwaitingSignature
        && SessionToken.HasValue
        && SessionExpiresAtUtc.HasValue
        && nowUtc <= SessionExpiresAtUtc.Value;

    /// <summary>Müşteri onay kutularını işaretleyip imzaladı — kayıt kilitlenir.</summary>
    public void Sign(string? checkedItemsJson, string? answersJson, string? signatureImage, string? signerName, string? device, string? ip, DateTime nowUtc)
    {
        if (Status == ConsentFormStatus.Signed) throw new BusinessRuleException("Bu form zaten imzalanmış.");
        if (Status == ConsentFormStatus.Cancelled) throw new BusinessRuleException("İptal edilmiş form imzalanamaz.");
        if (SessionExpiresAtUtc.HasValue && nowUtc > SessionExpiresAtUtc.Value)
            throw new BusinessRuleException("İmza oturumunun süresi doldu. Formu tablete yeniden gönderin.");
        if (RequiresSignature && string.IsNullOrWhiteSpace(signatureImage))
            throw new BusinessRuleException("İmza alınmadan form tamamlanamaz.");

        CheckedItemsJson = string.IsNullOrWhiteSpace(checkedItemsJson) ? null : checkedItemsJson.Trim();
        AnswersJson = string.IsNullOrWhiteSpace(answersJson) ? null : answersJson.Trim();
        SignatureImage = string.IsNullOrWhiteSpace(signatureImage) ? null : signatureImage.Trim();
        SignerName = Clip(signerName, 200) ?? CustomerName;
        SignerDevice = Clip(device, 300);
        SignerIp = Clip(ip, 64);
        SignedAtUtc = nowUtc;
        Status = ConsentFormStatus.Signed;
        // Oturum tek kullanımlıktır: imzadan sonra token geçersizleşir.
        SessionToken = null;
        SessionExpiresAtUtc = null;
        Touch();
    }

    public void Cancel()
    {
        if (Status == ConsentFormStatus.Signed) throw new BusinessRuleException("İmzalanmış form iptal edilemez.");
        Status = ConsentFormStatus.Cancelled;
        SessionToken = null;
        SessionExpiresAtUtc = null;
        Touch();
    }

    private void EnsureEditable()
    {
        if (Status == ConsentFormStatus.Signed) throw new BusinessRuleException("İmzalanmış form değiştirilemez.");
        if (Status == ConsentFormStatus.Cancelled) throw new BusinessRuleException("İptal edilmiş form değiştirilemez.");
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}

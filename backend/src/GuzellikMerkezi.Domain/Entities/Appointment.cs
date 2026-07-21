using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class Appointment : Entity
{
    private Appointment() { }

    public Appointment(Guid tenantId, Guid branchId, Guid customerId, Guid staffMemberId, Guid serviceDefinitionId, DateTime startUtc, DateTime endUtc, decimal price, string? notes = null, bool isOnline = false)
    {
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        StaffMemberId = staffMemberId;
        ServiceDefinitionId = serviceDefinitionId;
        Price = price < 0 ? throw new DomainException("Randevu fiyatı negatif olamaz.") : price;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        IsOnline = isOnline;
        Reschedule(startUtc, endUtc);
    }

    public Guid TenantId { get; private set; }
    public Guid BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }
    public Guid ServiceDefinitionId { get; private set; }
    public ServiceDefinition? ServiceDefinition { get; private set; }
    public DateTime StartUtc { get; private set; }
    public DateTime EndUtc { get; private set; }
    public AppointmentStatus Status { get; private set; } = AppointmentStatus.Scheduled;
    public decimal Price { get; private set; }
    public string? Notes { get; private set; }
    public string? CancellationReason { get; private set; }
    /// <summary>Müşteri tarafından mobil/online portaldan alınan randevu mu? (Takvimde "Online" rozeti.)</summary>
    public bool IsOnline { get; private set; }

    /// <summary>Kurum içi sıralı randevu numarası (#RNDV-…). Yeni randevularda atanır; eski kayıtlar null.</summary>
    public int? Number { get; private set; }

    /// <summary>Sıralı randevu numarasını atar (yalnızca bir kez, oluşturma anında).</summary>
    public void AssignNumber(int number)
    {
        if (Number.HasValue) return;
        Number = number;
    }

    /// <summary>Randevuyu başka bir personele aktarır (sürükle-bırak farklı sütun). Tamamlanan aktarılamaz.</summary>
    public void ReassignStaff(Guid staffMemberId)
    {
        if (Status == AppointmentStatus.Completed) throw new BusinessRuleException("Tamamlanan randevu başka personele aktarılamaz.");
        if (staffMemberId == Guid.Empty) throw new DomainException("Geçersiz personel.");
        StaffMemberId = staffMemberId;
        Touch();
    }

    // WhatsApp hatırlatma / müşteri onayı (iş akışı Status'tan bağımsız bilgi alanları)
    public WhatsAppConfirmationStatus CustomerConfirmation { get; private set; } = WhatsAppConfirmationStatus.None;
    public DateTime? LastReminderAtUtc { get; private set; }

    /// <summary>WhatsApp hatırlatması gönderildi — zamanı işaretle, onay durumunu Beklemede yap.</summary>
    public void MarkReminderSent()
    {
        LastReminderAtUtc = DateTime.UtcNow;
        if (CustomerConfirmation == WhatsAppConfirmationStatus.None) CustomerConfirmation = WhatsAppConfirmationStatus.Pending;
        Touch();
    }

    /// <summary>Müşterinin WhatsApp yanıtına göre onay durumunu günceller (Status'a dokunmaz).</summary>
    public void SetCustomerConfirmation(WhatsAppConfirmationStatus status)
    {
        CustomerConfirmation = status;
        Touch();
    }

    // Taslak (onay bekleyen) randevu slotu bloke etmez — yalnızca aktif randevular çakışır.
    public bool Overlaps(DateTime startUtc, DateTime endUtc) =>
        Status is not (AppointmentStatus.Cancelled or AppointmentStatus.NoShow or AppointmentStatus.Draft) && StartUtc < endUtc && startUtc < EndUtc;

    /// <summary>Randevuyu kurum yöneticisi onayına gönderir (personel önerisi → taslak).</summary>
    public void SubmitForApproval()
    {
        if (Status != AppointmentStatus.Scheduled) throw new BusinessRuleException("Yalnızca yeni oluşturulan randevu onaya gönderilebilir.");
        Status = AppointmentStatus.Draft;
        Touch();
    }

    /// <summary>Kurum yöneticisi taslak randevuyu onaylar → aktif (Scheduled) randevuya döner.</summary>
    public void ApproveDraft()
    {
        if (Status != AppointmentStatus.Draft) throw new BusinessRuleException("Yalnızca taslak randevu onaylanabilir.");
        Status = AppointmentStatus.Scheduled;
        Touch();
    }

    public void Reschedule(DateTime startUtc, DateTime endUtc)
    {
        if (startUtc.Kind != DateTimeKind.Utc || endUtc.Kind != DateTimeKind.Utc)
        {
            throw new DomainException("Randevu zamanı UTC olmalı.");
        }
        if (endUtc <= startUtc) throw new DomainException("Randevu bitiş zamanı başlangıçtan sonra olmalı.");
        if (Status == AppointmentStatus.Completed) throw new BusinessRuleException("Tamamlanan randevu taşınamaz.");
        StartUtc = startUtc;
        EndUtc = endUtc;
        Touch();
    }

    public void Confirm()
    {
        if (Status != AppointmentStatus.Scheduled) throw new BusinessRuleException("Sadece planlanan randevu onaylanabilir.");
        Status = AppointmentStatus.Confirmed;
        Touch();
    }

    public void Complete()
    {
        if (Status is not (AppointmentStatus.Scheduled or AppointmentStatus.Confirmed)) throw new BusinessRuleException("Bu randevu tamamlanamaz.");
        Status = AppointmentStatus.Completed;
        Touch();
    }

    public void Cancel(string reason)
    {
        if (Status == AppointmentStatus.Completed) throw new BusinessRuleException("Tamamlanan randevu iptal edilemez.");
        Status = AppointmentStatus.Cancelled;
        CancellationReason = string.IsNullOrWhiteSpace(reason) ? "Belirtilmedi" : reason.Trim();
        Touch();
    }

    public void MarkNoShow()
    {
        if (Status == AppointmentStatus.Completed) throw new BusinessRuleException("Tamamlanan randevu gelmedi yapılamaz.");
        Status = AppointmentStatus.NoShow;
        Touch();
    }

    public void ChangeNotes(string? notes)
    {
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }
}

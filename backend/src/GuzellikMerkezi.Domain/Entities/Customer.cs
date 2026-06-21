using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class Customer : Entity
{
    private Customer() { }

    public Customer(Guid tenantId, Guid branchId, string fullName, string phone, string? email = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        UpdateContact(fullName, phone, email);
    }

    public Guid TenantId { get; private set; }
    public Guid BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string Phone { get; private set; } = string.Empty;
    public string? Email { get; private set; }
    public DateOnly? BirthDate { get; private set; }
    public Gender Gender { get; private set; }
    public bool KvkkConsent { get; private set; }
    public string? Notes { get; private set; }
    /// <summary>Müşteri fotoğrafı (data-URL/base64) — liste ve kartlarda görünür.</summary>
    public string? PhotoUrl { get; private set; }

    /// <summary>Kara liste — true ise bu müşteriye randevu oluşturulamaz.</summary>
    public bool IsBlacklisted { get; private set; }
    public string? BlacklistReason { get; private set; }
    public DateTime? BlacklistedAtUtc { get; private set; }

    public void Blacklist(string? reason)
    {
        IsBlacklisted = true;
        BlacklistReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        BlacklistedAtUtc = DateTime.UtcNow;
        Touch();
    }

    public void RemoveFromBlacklist()
    {
        IsBlacklisted = false;
        BlacklistReason = null;
        BlacklistedAtUtc = null;
        Touch();
    }

    public void UpdateContact(string fullName, string phone, string? email)
    {
        if (string.IsNullOrWhiteSpace(fullName)) throw new DomainException("Müşteri adı boş olamaz.");
        if (string.IsNullOrWhiteSpace(phone)) throw new DomainException("Telefon boş olamaz.");
        FullName = fullName.Trim();
        Phone = phone.Trim();
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
        Touch();
    }

    public void UpdateProfile(DateOnly? birthDate, Gender gender, bool kvkkConsent, string? notes)
    {
        BirthDate = birthDate;
        Gender = gender;
        KvkkConsent = kvkkConsent;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }

    public void SetPhoto(string? photoUrl)
    {
        PhotoUrl = string.IsNullOrWhiteSpace(photoUrl) ? null : photoUrl.Trim();
        Touch();
    }

    public void AssignBranch(Guid branchId)
    {
        if (branchId == Guid.Empty) throw new DomainException("Şube seçimi zorunlu.");
        BranchId = branchId;
        Touch();
    }
}

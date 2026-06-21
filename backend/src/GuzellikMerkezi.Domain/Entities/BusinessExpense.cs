using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// İşletme gideri. Personel maaşı, kira, sarf, fatura vb. tüm para çıkışları burada toplanır.
/// Gelir-gider raporlarının "gider" ayağını oluşturur.
/// </summary>
public sealed class BusinessExpense : Entity
{
    private BusinessExpense() { }

    public BusinessExpense(
        Guid tenantId,
        Guid? branchId,
        ExpenseCategory category,
        decimal amount,
        DateTime occurredAtUtc,
        ExpensePaymentMethod paymentMethod = ExpensePaymentMethod.Cash,
        string? description = null,
        Guid? staffMemberId = null,
        string? periodLabel = null,
        string? reference = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Category = category;
        SetAmount(amount);
        SetOccurredAt(occurredAtUtc);
        PaymentMethod = paymentMethod;
        StaffMemberId = staffMemberId;
        PeriodLabel = string.IsNullOrWhiteSpace(periodLabel) ? null : periodLabel.Trim();
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public ExpenseCategory Category { get; private set; }
    public decimal Amount { get; private set; }
    public ExpensePaymentMethod PaymentMethod { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>Personel maaşı/avans/prim kayıtlarında ilgili personel</summary>
    public Guid? StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }

    /// <summary>Hangi dönemi kapsadığı (örn. "2026-05" veya "Mayıs 2026")</summary>
    public string? PeriodLabel { get; private set; }

    /// <summary>Açıklama (Cilt bakım ürünleri, Elektrik faturası gibi)</summary>
    public string? Description { get; private set; }

    /// <summary>Fiş, fatura veya dekont numarası</summary>
    public string? Reference { get; private set; }

    public bool IsApproved { get; private set; }
    public DateTime? ApprovedAtUtc { get; private set; }

    public void Update(
        ExpenseCategory category,
        decimal amount,
        DateTime occurredAtUtc,
        ExpensePaymentMethod paymentMethod,
        string? description,
        Guid? staffMemberId,
        string? periodLabel,
        string? reference)
    {
        Category = category;
        SetAmount(amount);
        SetOccurredAt(occurredAtUtc);
        PaymentMethod = paymentMethod;
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        StaffMemberId = staffMemberId;
        PeriodLabel = string.IsNullOrWhiteSpace(periodLabel) ? null : periodLabel.Trim();
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        Touch();
    }

    public void Approve()
    {
        if (IsApproved) return;
        IsApproved = true;
        ApprovedAtUtc = DateTime.UtcNow;
        Touch();
    }

    public void Revoke()
    {
        if (!IsApproved) return;
        IsApproved = false;
        ApprovedAtUtc = null;
        Touch();
    }

    private void SetAmount(decimal amount)
    {
        if (amount <= 0) throw new DomainException("Gider tutarı pozitif olmalı.");
        Amount = amount;
    }

    private void SetOccurredAt(DateTime occurredAtUtc)
    {
        if (occurredAtUtc.Kind != DateTimeKind.Utc) occurredAtUtc = DateTime.SpecifyKind(occurredAtUtc, DateTimeKind.Utc);
        OccurredAtUtc = occurredAtUtc;
    }
}

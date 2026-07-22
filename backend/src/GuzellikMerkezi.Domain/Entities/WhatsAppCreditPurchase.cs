using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kurumun ek kontör satın alma talebi. Kurum yöneticisi ana aboneliğinin dışında kontör almak istediğinde
/// PENDING talep oluşur; platform admin onaylayınca cüzdana bakiye eklenir. Bu onay adımı platformun her
/// yüklemeyi denetlemesini (fatura kontrolü) sağlar — bakiye asla onaysız artmaz.
/// </summary>
public sealed class WhatsAppCreditPurchase : Entity
{
    private WhatsAppCreditPurchase() { }

    public WhatsAppCreditPurchase(Guid tenantId, Guid? creditPackageId, string packageName, decimal priceTry, decimal grantsTry, Guid? requestedByUserId)
    {
        TenantId = tenantId;
        CreditPackageId = creditPackageId;
        PackageName = string.IsNullOrWhiteSpace(packageName) ? "Kontör" : packageName.Trim();
        if (priceTry < 0) throw new DomainException("Fiyat negatif olamaz.");
        if (grantsTry <= 0) throw new DomainException("Kontör tutarı pozitif olmalı.");
        PriceTry = decimal.Round(priceTry, 2);
        GrantsTry = decimal.Round(grantsTry, 2);
        RequestedByUserId = requestedByUserId;
        Status = CreditPurchaseStatus.Pending;
    }

    public Guid TenantId { get; private set; }
    public Guid? CreditPackageId { get; private set; }
    public string PackageName { get; private set; } = string.Empty;
    public decimal PriceTry { get; private set; }
    public decimal GrantsTry { get; private set; }
    public CreditPurchaseStatus Status { get; private set; }
    public Guid? RequestedByUserId { get; private set; }
    public Guid? ProcessedByUserId { get; private set; }
    public DateTime? ProcessedAtUtc { get; private set; }
    public string? Note { get; private set; }

    public void Approve(Guid? processedByUserId)
    {
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep onaylanabilir.");
        Status = CreditPurchaseStatus.Approved;
        ProcessedByUserId = processedByUserId;
        ProcessedAtUtc = DateTime.UtcNow;
        Touch();
    }

    public void Reject(Guid? processedByUserId, string? note)
    {
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep reddedilebilir.");
        Status = CreditPurchaseStatus.Rejected;
        ProcessedByUserId = processedByUserId;
        ProcessedAtUtc = DateTime.UtcNow;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Touch();
    }

    public void Cancel()
    {
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep iptal edilebilir.");
        Status = CreditPurchaseStatus.Cancelled;
        Touch();
    }
}

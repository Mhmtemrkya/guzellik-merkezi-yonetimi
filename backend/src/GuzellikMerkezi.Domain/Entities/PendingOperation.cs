using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Personel tarafından yapılan ve kurum yöneticisi onayı bekleyen işlem.
/// Payload JSON formatında saklanır — onaylandığında ApprovalDispatcher tip'e göre yürütür.
/// </summary>
public sealed class PendingOperation : Entity
{
    private PendingOperation() { }

    public PendingOperation(
        Guid tenantId,
        Guid? branchId,
        Guid requestedByUserId,
        string requestedByName,
        PendingOperationType operationType,
        string title,
        string summary,
        string payloadJson)
    {
        TenantId = tenantId;
        BranchId = branchId;
        RequestedByUserId = requestedByUserId;
        RequestedByName = string.IsNullOrWhiteSpace(requestedByName) ? "Personel" : requestedByName.Trim();
        OperationType = operationType;
        Title = string.IsNullOrWhiteSpace(title) ? operationType.ToString() : title.Trim();
        Summary = string.IsNullOrWhiteSpace(summary) ? null : summary.Trim();
        if (string.IsNullOrWhiteSpace(payloadJson)) throw new DomainException("Payload boş olamaz.");
        PayloadJson = payloadJson;
        Status = PendingOperationStatus.Pending;
        RequestedAtUtc = DateTime.UtcNow;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public Guid RequestedByUserId { get; private set; }
    public TenantUser? RequestedBy { get; private set; }
    public string RequestedByName { get; private set; } = string.Empty;

    public PendingOperationType OperationType { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string? Summary { get; private set; }
    public string PayloadJson { get; private set; } = string.Empty;

    public PendingOperationStatus Status { get; private set; }
    public DateTime RequestedAtUtc { get; private set; }
    public DateTime? DecidedAtUtc { get; private set; }
    public Guid? DecidedByUserId { get; private set; }
    public TenantUser? DecidedBy { get; private set; }
    public string? RejectionReason { get; private set; }

    /// <summary>Onaylandıktan sonra üretilen kaydın ID'si (audit için)</summary>
    public Guid? ResultEntityId { get; private set; }

    /// <summary>
    /// İşlemi SAHİPLENİR (Pending → Processing). Kilit altında çağrılıp hemen commit edilmelidir:
    /// asıl operasyon ayrı bir bağlantıda (HTTP replay) çalıştığı için tek koruma budur.
    /// </summary>
    public void BeginProcessing(Guid decidedByUserId)
    {
        if (Status != PendingOperationStatus.Pending) throw new BusinessRuleException("Sadece bekleyen işlemler onaylanabilir.");
        Status = PendingOperationStatus.Processing;
        DecidedByUserId = decidedByUserId;
        Touch();
    }

    /// <summary>Operasyon başarısız oldu → yeniden denenebilmesi için Pending'e döner.</summary>
    public void ReleaseProcessing()
    {
        if (Status != PendingOperationStatus.Processing) return;
        Status = PendingOperationStatus.Pending;
        DecidedByUserId = null;
        Touch();
    }

    public void Approve(Guid decidedByUserId, Guid? resultEntityId)
    {
        // Processing: bu çağrı işlemi sahiplenmiş ve operasyonu başarıyla yürütmüştür.
        if (Status is not (PendingOperationStatus.Pending or PendingOperationStatus.Processing))
            throw new BusinessRuleException("Sadece bekleyen işlemler onaylanabilir.");
        Status = PendingOperationStatus.Approved;
        DecidedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        ResultEntityId = resultEntityId;
        Touch();
    }

    public void Reject(Guid decidedByUserId, string? reason)
    {
        if (Status != PendingOperationStatus.Pending) throw new BusinessRuleException("Sadece bekleyen işlemler reddedilebilir.");
        Status = PendingOperationStatus.Rejected;
        DecidedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        RejectionReason = string.IsNullOrWhiteSpace(reason) ? "Belirtilmedi" : reason.Trim();
        Touch();
    }

    public void Cancel(Guid decidedByUserId)
    {
        if (Status != PendingOperationStatus.Pending) throw new BusinessRuleException("Sadece bekleyen işlemler iptal edilebilir.");
        Status = PendingOperationStatus.Cancelled;
        DecidedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        Touch();
    }
}

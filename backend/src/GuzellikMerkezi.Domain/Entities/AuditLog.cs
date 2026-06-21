namespace GuzellikMerkezi.Domain.Entities;

public sealed class AuditLog : Entity
{
    private AuditLog() { }

    public AuditLog(
        Guid? tenantId,
        Guid? branchId,
        Guid? actorUserId,
        string? actorName,
        string? actorRole,
        string action,
        string entityName,
        Guid? entityId,
        string? summary,
        string? dataJson,
        string? ipAddress)
    {
        TenantId = tenantId;
        BranchId = branchId;
        ActorUserId = actorUserId;
        ActorName = string.IsNullOrWhiteSpace(actorName) ? null : actorName.Trim();
        ActorRole = string.IsNullOrWhiteSpace(actorRole) ? null : actorRole.Trim();
        Action = (action ?? string.Empty).Trim();
        EntityName = (entityName ?? string.Empty).Trim();
        EntityId = entityId;
        Summary = string.IsNullOrWhiteSpace(summary) ? null : summary.Trim();
        DataJson = string.IsNullOrWhiteSpace(dataJson) ? null : dataJson;
        IpAddress = string.IsNullOrWhiteSpace(ipAddress) ? null : ipAddress.Trim();
    }

    public Guid? TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid? ActorUserId { get; private set; }
    /// <summary>Kullanıcı silinse de log'da kim olduğu gözüksün diye anlık snapshot.</summary>
    public string? ActorName { get; private set; }
    public string? ActorRole { get; private set; }
    /// <summary>Domain action: Create.Customer / Update.Appointment / Delete.Expense / Approve.PendingOperation vb.</summary>
    public string Action { get; private set; } = string.Empty;
    public string EntityName { get; private set; } = string.Empty;
    public Guid? EntityId { get; private set; }
    /// <summary>Kısa, insana yönelik özet (örn. "Ahmet Yılmaz adlı müşteri oluşturuldu").</summary>
    public string? Summary { get; private set; }
    public string? DataJson { get; private set; }
    public string? IpAddress { get; private set; }
}

namespace GuzellikMerkezi.Application.Abstractions;

public interface ITenantContext
{
    Guid? TenantId { get; }
    Guid? BranchId { get; }
    bool IsPlatformAdmin { get; }
    void Set(Guid? tenantId, Guid? branchId, bool isPlatformAdmin);
}

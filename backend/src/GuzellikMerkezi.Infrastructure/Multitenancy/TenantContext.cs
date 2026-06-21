using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Infrastructure.Multitenancy;

public sealed class TenantContext : ITenantContext
{
    public Guid? TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public bool IsPlatformAdmin { get; private set; }

    public void Set(Guid? tenantId, Guid? branchId, bool isPlatformAdmin)
    {
        TenantId = tenantId;
        BranchId = branchId;
        IsPlatformAdmin = isPlatformAdmin;
    }
}

using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Abstractions;

public interface ICurrentUser
{
    Guid? UserId { get; }
    string? Email { get; }
    UserRole? Role { get; }
    Guid? TenantId { get; }
    Guid? BranchId { get; }
    bool IsAuthenticated { get; }
    bool IsPlatformAdmin { get; }
    /// <summary>İsteğin geldiği IP adresi (audit log için).</summary>
    string? IpAddress { get; }
}

using System.Security.Claims;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Security;

public sealed class HttpCurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public HttpCurrentUser(IHttpContextAccessor httpContextAccessor) => _httpContextAccessor = httpContextAccessor;

    private ClaimsPrincipal? User => _httpContextAccessor.HttpContext?.User;

    public Guid? UserId => TryReadGuid(ClaimTypes.NameIdentifier) ?? TryReadGuid("sub");
    public string? Email => User?.FindFirstValue(ClaimTypes.Email) ?? User?.FindFirstValue("email");
    public UserRole? Role => Enum.TryParse<UserRole>(User?.FindFirstValue(ClaimTypes.Role) ?? User?.FindFirstValue("role"), out var role) ? role : null;
    public Guid? TenantId => TryReadGuid("tenant_id");
    public Guid? BranchId => TryReadGuid("branch_id");
    public bool IsAuthenticated => User?.Identity?.IsAuthenticated == true;
    public bool IsPlatformAdmin => Role == UserRole.PlatformAdmin;
    public string? IpAddress => _httpContextAccessor.HttpContext?.Connection?.RemoteIpAddress?.ToString();
    public IReadOnlyCollection<string> Permissions =>
        User?.FindAll("permission").Select(c => c.Value).Where(v => !string.IsNullOrWhiteSpace(v)).ToArray()
        ?? Array.Empty<string>();

    private Guid? TryReadGuid(string claimType)
    {
        var value = User?.FindFirstValue(claimType);
        return Guid.TryParse(value, out var id) ? id : null;
    }
}

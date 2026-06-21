using GuzellikMerkezi.Domain.Authorization;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Tests.Domain;

public sealed class RolePermissionsTests
{
    [Fact]
    public void PlatformAdmin_HasPlatformAdministrationPermission()
    {
        var permissions = RolePermissions.For(UserRole.PlatformAdmin);

        Assert.True(permissions.HasFlag(Permission.PlatformAdministration));
        Assert.True(permissions.HasFlag(Permission.TenantWrite));
    }

    [Fact]
    public void Staff_DoesNotHaveTenantWritePermission()
    {
        var permissions = RolePermissions.For(UserRole.Staff);

        Assert.False(permissions.HasFlag(Permission.TenantWrite));
        Assert.True(permissions.HasFlag(Permission.AppointmentRead));
    }
}

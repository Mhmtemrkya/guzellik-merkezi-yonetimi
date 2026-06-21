using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Authorization;

public static class RolePermissions
{
    public static Permission For(UserRole role) => role switch
    {
        UserRole.PlatformAdmin => Permission.PlatformAdministration | Permission.TenantRead | Permission.TenantWrite | Permission.AuditRead,
        UserRole.InstitutionOwner => Permission.BranchRead | Permission.BranchWrite | Permission.CustomerRead | Permission.CustomerWrite |
                                     Permission.StaffRead | Permission.StaffWrite | Permission.ServiceRead | Permission.ServiceWrite |
                                     Permission.AppointmentRead | Permission.AppointmentWrite | Permission.CashRead | Permission.CashWrite |
                                     Permission.InventoryRead | Permission.InventoryWrite | Permission.AuditRead,
        UserRole.BranchManager => Permission.BranchRead | Permission.CustomerRead | Permission.CustomerWrite | Permission.StaffRead |
                                  Permission.ServiceRead | Permission.AppointmentRead | Permission.AppointmentWrite |
                                  Permission.CashRead | Permission.CashWrite | Permission.InventoryRead | Permission.InventoryWrite,
        UserRole.Staff => Permission.CustomerRead | Permission.ServiceRead | Permission.AppointmentRead | Permission.AppointmentWrite,
        _ => Permission.None
    };

    public static IReadOnlyCollection<string> NamesFor(UserRole role) => Enum.GetValues<Permission>()
        .Where(permission => permission != Permission.None && For(role).HasFlag(permission))
        .Select(permission => permission.ToString())
        .ToArray();
}

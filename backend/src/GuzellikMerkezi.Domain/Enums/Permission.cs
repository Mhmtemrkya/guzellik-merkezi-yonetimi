namespace GuzellikMerkezi.Domain.Enums;

[Flags]
public enum Permission
{
    None = 0,
    TenantRead = 1 << 0,
    TenantWrite = 1 << 1,
    BranchRead = 1 << 2,
    BranchWrite = 1 << 3,
    CustomerRead = 1 << 4,
    CustomerWrite = 1 << 5,
    StaffRead = 1 << 6,
    StaffWrite = 1 << 7,
    ServiceRead = 1 << 8,
    ServiceWrite = 1 << 9,
    AppointmentRead = 1 << 10,
    AppointmentWrite = 1 << 11,
    CashRead = 1 << 12,
    CashWrite = 1 << 13,
    InventoryRead = 1 << 14,
    InventoryWrite = 1 << 15,
    AuditRead = 1 << 16,
    PlatformAdministration = 1 << 17
}

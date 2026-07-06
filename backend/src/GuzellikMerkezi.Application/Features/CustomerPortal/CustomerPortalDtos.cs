using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.CustomerPortal;

/// <summary>Online portal müşterisinin profili + bağlı olduğu kurum.</summary>
public sealed record PortalProfileDto(
    Guid CustomerId,
    string FullName,
    string Phone,
    Guid TenantId,
    string TenantName,
    Guid BranchId,
    bool MustChangePassword,
    bool IsMarketplace);

/// <summary>Kurumun şubesi (ana sayfada seçim için). Pazaryerinde kurum adı da gösterilir.</summary>
public sealed record PortalBranchDto(Guid Id, string Name, string City, bool IsDefault, Guid TenantId, string TenantName);

/// <summary>Şubede sunulan hizmet.</summary>
public sealed record PortalServiceDto(Guid Id, string Name, string? Category, int DurationMinutes, decimal Price, string? IconKey);

/// <summary>Hizmeti verebilecek uzman.</summary>
public sealed record PortalStaffDto(Guid Id, string FullName, string Title, string? Specialties, string? PhotoUrl);

/// <summary>Belirli bir tarih için üretilen slot (yerel saat "HH:mm").</summary>
public sealed record PortalSlotDto(string Start, string End, bool Available);

/// <summary>Bir gün için müsaitlik (yerel Türkiye saatiyle slotlar).</summary>
public sealed record PortalAvailabilityDto(DateOnly Date, IReadOnlyCollection<PortalSlotDto> Slots);

public sealed record CreatePortalAppointmentRequest(
    Guid BranchId,
    Guid StaffMemberId,
    Guid ServiceDefinitionId,
    DateTime StartUtc,
    string? Notes);

public sealed record PortalAppointmentDto(
    Guid Id,
    Guid BranchId,
    string? BranchName,
    Guid StaffMemberId,
    string? StaffName,
    Guid ServiceDefinitionId,
    string? ServiceName,
    DateTime StartUtc,
    DateTime EndUtc,
    AppointmentStatus Status,
    decimal Price,
    bool IsOnline);

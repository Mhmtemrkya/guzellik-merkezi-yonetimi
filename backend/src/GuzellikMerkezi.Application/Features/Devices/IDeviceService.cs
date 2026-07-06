using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Devices;

public sealed record StaffDeviceDto(
    Guid Id,
    Guid TenantUserId,
    string DeviceId,
    string Name,
    string? DeviceType,
    string? UserAgent,
    string? NetworkInfoJson,
    string? LastIpAddress,
    DateTime LastSeenUtc,
    DateTime CreatedAtUtc);

public sealed record DeviceControlSettingsDto(bool Enabled, bool FeatureAllowed);
public sealed record UpdateDeviceControlSettingsRequest(bool Enabled);
public sealed record UpdateDeviceRequest(string Name, string? DeviceType);
public sealed record UpdateDeviceLimitRequest(int? MaxDeviceCount);
public sealed record DeviceLimitDto(Guid TenantUserId, int? MaxDeviceCount, int DeviceCount);

/// <summary>Cihaz güvenliği: tanımlı personel cihazlarının yönetimi + kurum ayarı.</summary>
public interface IDeviceService
{
    Task<Result<DeviceControlSettingsDto>> GetSettingsAsync(Guid tenantId, CancellationToken ct = default);
    Task<Result<DeviceControlSettingsDto>> UpdateSettingsAsync(Guid tenantId, UpdateDeviceControlSettingsRequest request, CancellationToken ct = default);
    Task<Result<IReadOnlyCollection<StaffDeviceDto>>> ListForUserAsync(Guid tenantId, Guid tenantUserId, CancellationToken ct = default);
    Task<Result<StaffDeviceDto>> UpdateAsync(Guid tenantId, Guid deviceRecordId, UpdateDeviceRequest request, CancellationToken ct = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid deviceRecordId, CancellationToken ct = default);
    Task<Result<DeviceLimitDto>> GetLimitAsync(Guid tenantId, Guid tenantUserId, CancellationToken ct = default);
    Task<Result<DeviceLimitDto>> UpdateLimitAsync(Guid tenantId, Guid tenantUserId, UpdateDeviceLimitRequest request, CancellationToken ct = default);
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Devices;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class DeviceService : IDeviceService
{
    private readonly GuzellikDbContext _db;
    private readonly IFeatureService _features;
    private readonly IAuditLogger _audit;

    public DeviceService(GuzellikDbContext db, IFeatureService features, IAuditLogger audit)
    {
        _db = db;
        _features = features;
        _audit = audit;
    }

    public async Task<Result<DeviceControlSettingsDto>> GetSettingsAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<DeviceControlSettingsDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        var allowed = await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.SecurityDeviceControl, ct);
        return Result<DeviceControlSettingsDto>.Success(new DeviceControlSettingsDto(tenant.DeviceControlEnabled, allowed));
    }

    public async Task<Result<DeviceControlSettingsDto>> UpdateSettingsAsync(Guid tenantId, UpdateDeviceControlSettingsRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<DeviceControlSettingsDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var allowed = await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.SecurityDeviceControl, ct);
        if (request.Enabled && !allowed)
            return Result<DeviceControlSettingsDto>.Failure(Error.Conflict("Cihaz güvenliği özelliği paketinize dahil değil. Paketinizi yükseltin."));

        tenant.SetDeviceControl(request.Enabled);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(tenantId, null, request.Enabled ? "Security.DeviceControlEnabled" : "Security.DeviceControlDisabled",
            "Security", tenantId, request.Enabled ? "Cihaz güvenliği açıldı." : "Cihaz güvenliği kapatıldı.", null, ct);
        return Result<DeviceControlSettingsDto>.Success(new DeviceControlSettingsDto(tenant.DeviceControlEnabled, allowed));
    }

    public async Task<Result<IReadOnlyCollection<StaffDeviceDto>>> ListForUserAsync(Guid tenantId, Guid tenantUserId, CancellationToken ct = default)
    {
        var rows = await _db.StaffDevices.AsNoTracking()
            .Where(d => d.TenantId == tenantId && d.TenantUserId == tenantUserId)
            .OrderBy(d => d.CreatedAtUtc)
            .ToListAsync(ct);
        return Result<IReadOnlyCollection<StaffDeviceDto>>.Success(rows.Select(ToDto).ToArray());
    }

    public async Task<Result<StaffDeviceDto>> UpdateAsync(Guid tenantId, Guid deviceRecordId, UpdateDeviceRequest request, CancellationToken ct = default)
    {
        var device = await _db.StaffDevices.FirstOrDefaultAsync(d => d.Id == deviceRecordId && d.TenantId == tenantId, ct);
        if (device is null) return Result<StaffDeviceDto>.Failure(Error.NotFound("Cihaz bulunamadı."));
        device.Rename(request.Name);
        await _db.SaveChangesAsync(ct);
        return Result<StaffDeviceDto>.Success(ToDto(device));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid deviceRecordId, CancellationToken ct = default)
    {
        var device = await _db.StaffDevices.FirstOrDefaultAsync(d => d.Id == deviceRecordId && d.TenantId == tenantId, ct);
        if (device is null) return Result.Failure(Error.NotFound("Cihaz bulunamadı."));
        device.SoftDelete();
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(tenantId, null, "Security.DeviceRemoved", "Security", device.TenantUserId,
            $"Tanımlı cihaz silindi: {device.Name}.", new { device.DeviceId, device.Name }, ct);
        return Result.Success();
    }

    public async Task<Result<DeviceLimitDto>> GetLimitAsync(Guid tenantId, Guid tenantUserId, CancellationToken ct = default)
    {
        var user = await _db.TenantUsers.AsNoTracking().FirstOrDefaultAsync(u => u.Id == tenantUserId && u.TenantId == tenantId, ct);
        if (user is null) return Result<DeviceLimitDto>.Failure(Error.NotFound("Kullanıcı bulunamadı."));
        var count = await _db.StaffDevices.CountAsync(d => d.TenantUserId == tenantUserId, ct);
        return Result<DeviceLimitDto>.Success(new DeviceLimitDto(tenantUserId, user.MaxDeviceCount, count));
    }

    public async Task<Result<DeviceLimitDto>> UpdateLimitAsync(Guid tenantId, Guid tenantUserId, UpdateDeviceLimitRequest request, CancellationToken ct = default)
    {
        var user = await _db.TenantUsers.FirstOrDefaultAsync(u => u.Id == tenantUserId && u.TenantId == tenantId, ct);
        if (user is null) return Result<DeviceLimitDto>.Failure(Error.NotFound("Kullanıcı bulunamadı."));

        try
        {
            user.SetMaxDeviceCount(request.MaxDeviceCount);
        }
        catch (DomainException ex)
        {
            return Result<DeviceLimitDto>.Failure(Error.Validation(ex.Message));
        }

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(tenantId, user.BranchId, "Security.DeviceLimitChanged", "Security", tenantUserId,
            $"{user.FullName ?? user.Email} için cihaz limiti {(request.MaxDeviceCount?.ToString() ?? "sınırsız")} olarak ayarlandı.", null, ct);

        var count = await _db.StaffDevices.CountAsync(d => d.TenantUserId == tenantUserId, ct);
        return Result<DeviceLimitDto>.Success(new DeviceLimitDto(tenantUserId, user.MaxDeviceCount, count));
    }

    private static StaffDeviceDto ToDto(StaffDevice d) => new(
        d.Id, d.TenantUserId, d.DeviceId, d.Name, d.DeviceType, d.UserAgent,
        d.NetworkInfoJson, d.LastIpAddress, d.LastSeenUtc, d.CreatedAtUtc);
}

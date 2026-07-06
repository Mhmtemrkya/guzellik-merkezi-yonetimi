using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Security;

/// <summary>Masaüstü uygulama güvenlik olayları + personel ekran görüntüsü izni.</summary>
public interface ISecurityService
{
    Task<Result> LogDesktopEventAsync(Guid tenantId, DesktopEventRequest request, CancellationToken ct = default);
    Task<Result<ScreenshotSettingsDto>> GetScreenshotSettingsAsync(Guid tenantId, CancellationToken ct = default);
    Task<Result<ScreenshotSettingsDto>> UpdateScreenshotSettingsAsync(Guid tenantId, UpdateScreenshotSettingsRequest request, CancellationToken ct = default);
    Task<Result<IReadOnlyCollection<StaffScreenshotDto>>> ListStaffScreenshotOverridesAsync(Guid tenantId, CancellationToken ct = default);
    Task<Result<StaffScreenshotDto>> UpdateStaffScreenshotAsync(Guid tenantId, Guid tenantUserId, UpdateStaffScreenshotRequest request, CancellationToken ct = default);
}

/// <summary>Masaüstü kabuğundan gelen olay: FocusLost (alta alma/ekran değiştirme) veya AppClosed (kapat butonu).</summary>
public sealed record DesktopEventRequest(string EventType, string? Detail);

/// <summary>
/// AllowStaffScreenshots: kurum varsayılanı. Staff kendi çağırdığında bu alan,
/// varsa kişisel istisna uygulanmış EFEKTİF değeri taşır (mobil doğrudan kullanır).
/// </summary>
public sealed record ScreenshotSettingsDto(bool AllowStaffScreenshots);

public sealed record UpdateScreenshotSettingsRequest(bool AllowStaffScreenshots);

/// <summary>Allow null = kurum varsayılanını izler; Effective her zaman uygulanacak sonuç.</summary>
public sealed record StaffScreenshotDto(Guid TenantUserId, string? FullName, string Email, bool? Allow, bool Effective);

public sealed record UpdateStaffScreenshotRequest(bool? Allow);

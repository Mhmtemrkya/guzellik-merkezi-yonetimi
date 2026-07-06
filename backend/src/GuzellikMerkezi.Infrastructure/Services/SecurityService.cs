using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Security;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class SecurityService : ISecurityService
{
    // Masaüstü kabuğunun gönderebileceği olaylar; serbest metin action'a dönüşmesin diye beyaz liste.
    private static readonly Dictionary<string, string> DesktopEvents = new(StringComparer.OrdinalIgnoreCase)
    {
        ["FocusLost"] = "Uygulama alta alındı / başka ekrana geçildi; oturum sonlandırıldı.",
        ["AppClosed"] = "Masaüstü uygulaması kapat butonuyla kapatıldı.",
    };

    private readonly GuzellikDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public SecurityService(GuzellikDbContext db, ICurrentUser currentUser, IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result> LogDesktopEventAsync(Guid tenantId, DesktopEventRequest request, CancellationToken ct = default)
    {
        if (!DesktopEvents.TryGetValue(request.EventType?.Trim() ?? string.Empty, out var summary))
            return Result.Failure(Error.Validation("Geçersiz masaüstü olay tipi."));

        await _audit.LogAsync(
            tenantId,
            _currentUser.BranchId,
            $"Desktop.{char.ToUpperInvariant(request.EventType![0])}{request.EventType[1..]}",
            "Security",
            _currentUser.UserId,
            summary,
            string.IsNullOrWhiteSpace(request.Detail) ? null : new { request.Detail },
            ct);
        return Result.Success();
    }

    public async Task<Result<ScreenshotSettingsDto>> GetScreenshotSettingsAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<ScreenshotSettingsDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        // Staff kendi ayarını sorduğunda kişisel istisna uygulanmış efektif değeri döneriz;
        // mobil uygulama bu tek alana bakarak FLAG_SECURE kararı verir.
        var effective = tenant.AllowStaffScreenshots;
        if (_currentUser.Role == Domain.Enums.UserRole.Staff && _currentUser.UserId is Guid uid)
        {
            var user = await _db.TenantUsers.AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == uid && u.TenantId == tenantId, ct);
            effective = user?.AllowScreenshots ?? effective;
        }
        return Result<ScreenshotSettingsDto>.Success(new ScreenshotSettingsDto(effective));
    }

    public async Task<Result<IReadOnlyCollection<StaffScreenshotDto>>> ListStaffScreenshotOverridesAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<IReadOnlyCollection<StaffScreenshotDto>>.Failure(Error.NotFound("Kurum bulunamadı."));

        var users = await _db.TenantUsers.AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.Role == Domain.Enums.UserRole.Staff && u.IsActive)
            .OrderBy(u => u.FullName)
            .ToListAsync(ct);

        var rows = users
            .Select(u => new StaffScreenshotDto(u.Id, u.FullName, u.Email, u.AllowScreenshots,
                u.AllowScreenshots ?? tenant.AllowStaffScreenshots))
            .ToArray();
        return Result<IReadOnlyCollection<StaffScreenshotDto>>.Success(rows);
    }

    public async Task<Result<StaffScreenshotDto>> UpdateStaffScreenshotAsync(Guid tenantId, Guid tenantUserId, UpdateStaffScreenshotRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<StaffScreenshotDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        var user = await _db.TenantUsers.FirstOrDefaultAsync(u => u.Id == tenantUserId && u.TenantId == tenantId, ct);
        if (user is null) return Result<StaffScreenshotDto>.Failure(Error.NotFound("Kullanıcı bulunamadı."));

        user.SetAllowScreenshots(request.Allow);
        await _db.SaveChangesAsync(ct);

        var stateText = request.Allow switch
        {
            true => "izinli",
            false => "engelli",
            null => "kurum varsayılanı",
        };
        await _audit.LogAsync(tenantId, user.BranchId, "Security.StaffScreenshotOverrideChanged", "Security", tenantUserId,
            $"{user.FullName ?? user.Email} için ekran görüntüsü izni: {stateText}.", null, ct);

        return Result<StaffScreenshotDto>.Success(new StaffScreenshotDto(user.Id, user.FullName, user.Email,
            user.AllowScreenshots, user.AllowScreenshots ?? tenant.AllowStaffScreenshots));
    }

    public async Task<Result<ScreenshotSettingsDto>> UpdateScreenshotSettingsAsync(Guid tenantId, UpdateScreenshotSettingsRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<ScreenshotSettingsDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        tenant.SetAllowStaffScreenshots(request.AllowStaffScreenshots);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(tenantId, null,
            request.AllowStaffScreenshots ? "Security.StaffScreenshotsAllowed" : "Security.StaffScreenshotsBlocked",
            "Security", tenantId,
            request.AllowStaffScreenshots
                ? "Personelin ekran görüntüsü almasına izin verildi."
                : "Personelin ekran görüntüsü alması engellendi.",
            null, ct);
        return Result<ScreenshotSettingsDto>.Success(new ScreenshotSettingsDto(tenant.AllowStaffScreenshots));
    }
}

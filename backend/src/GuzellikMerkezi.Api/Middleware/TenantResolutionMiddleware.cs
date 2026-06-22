using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Middleware;

public sealed class TenantResolutionMiddleware
{
    private readonly RequestDelegate _next;

    public TenantResolutionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext httpContext, ITenantContext tenantContext, ICurrentUser currentUser, GuzellikDbContext db)
    {
        // Şube kapsamı: seçili şube (X-Branch-Id) global query filter ile operasyonel veriyi süzer.
        // GÜVENLİK: istemciden gelen başlık körlemesine kabul EDİLMEZ — yetkisi olmayan kullanıcı başka şubeyi
        // hedefleyemesin diye doğrulanır (bkz. ResolveBranchAsync).
        var branchId = await ResolveBranchAsync(httpContext, currentUser, db);
        tenantContext.Set(currentUser.TenantId, branchId, currentUser.IsPlatformAdmin);
        await _next(httpContext);
    }

    private static async Task<Guid?> ResolveBranchAsync(HttpContext httpContext, ICurrentUser currentUser, GuzellikDbContext db)
    {
        var header = TryReadBranchHeader(httpContext);

        // Platform admin: tenant kapsamı yoktur; başlık yalnızca görüntüleme seçimidir, aynen kullanılır.
        if (currentUser.IsPlatformAdmin) return header ?? currentUser.BranchId;

        // Yalnızca KURUM SAHİBİ şube değiştirebilir. Diğer roller (şube yöneticisi, personel) JWT'deki şubeye
        // SABİTLENİR — gönderilen başlık yok sayılır (başka şubeye erişim engellenir).
        if (currentUser.Role != UserRole.InstitutionOwner) return currentUser.BranchId;

        // Kurum sahibi: başlık yoksa JWT şubesi; varsa seçilen şubenin AYNI tenant'a ait olduğu DB'den doğrulanır.
        if (header is null || currentUser.TenantId is null) return currentUser.BranchId;

        var belongsToTenant = await db.Branches
            .IgnoreQueryFilters()
            .AnyAsync(b => b.Id == header.Value && b.TenantId == currentUser.TenantId.Value && !b.IsDeleted, httpContext.RequestAborted);

        // Başka tenant'ın şubesi gönderildiyse başlığı yok say (kendi JWT şubesine düş).
        return belongsToTenant ? header : currentUser.BranchId;
    }

    private static Guid? TryReadBranchHeader(HttpContext httpContext)
    {
        if (httpContext.Request.Headers.TryGetValue("X-Branch-Id", out var value)
            && Guid.TryParse(value.ToString(), out var branchId))
        {
            return branchId;
        }
        return null;
    }
}

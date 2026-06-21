using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Api.Middleware;

public sealed class TenantResolutionMiddleware
{
    private readonly RequestDelegate _next;

    public TenantResolutionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext httpContext, ITenantContext tenantContext, ICurrentUser currentUser)
    {
        // Şube kapsamı: kullanıcının seçtiği şube (X-Branch-Id başlığı) önceliklidir; yoksa JWT'deki şube.
        // Bu, global query filter ile operasyonel verinin seçili şubeye göre süzülmesini sağlar.
        var branchId = TryReadBranchHeader(httpContext) ?? currentUser.BranchId;
        tenantContext.Set(currentUser.TenantId, branchId, currentUser.IsPlatformAdmin);
        await _next(httpContext);
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

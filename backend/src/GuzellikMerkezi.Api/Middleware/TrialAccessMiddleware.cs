using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Tenant kullanıcısının süresi dolmuş denemeyle panel/API kullanımını sürdürmesini engeller.
/// Paket seçimi için gereken self-service endpoint'leri açık bırakılır.
/// </summary>
public sealed class TrialAccessMiddleware
{
    private const string TrialExpiredMessage = "Deneme süresi bitti, lütfen paketlerden birisini alın.";
    private const string SubscriptionExpiredMessage = "Abonelik süreniz doldu, lütfen paketlerden birini satın alın.";
    private readonly RequestDelegate _next;

    public TrialAccessMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext httpContext, ICurrentUser currentUser, GuzellikDbContext db)
    {
        if (!currentUser.IsAuthenticated || currentUser.IsPlatformAdmin || currentUser.TenantId is null)
        {
            await _next(httpContext);
            return;
        }

        var tenant = await db.Tenants.FirstOrDefaultAsync(x => x.Id == currentUser.TenantId.Value, httpContext.RequestAborted);
        if (tenant is null)
        {
            await WriteBlockedAsync(httpContext, StatusCodes.Status401Unauthorized, "TenantMissing", "Kurum kaydı bulunamadı.");
            return;
        }

        var now = DateTime.UtcNow;
        if (tenant.Status == TenantStatus.Trial && tenant.IsTrialExpired(now))
        {
            tenant.Suspend();
            await db.SaveChangesAsync(httpContext.RequestAborted);
        }
        else if (tenant.Status == TenantStatus.Active && tenant.IsSubscriptionExpired(now))
        {
            tenant.Suspend();
            await db.SaveChangesAsync(httpContext.RequestAborted);
        }

        var expiredTrial = tenant.TrialEndsAtUtc.HasValue && tenant.TrialEndsAtUtc.Value <= now;
        var expiredSubscription = tenant.SubscriptionEndsAtUtc.HasValue && tenant.SubscriptionEndsAtUtc.Value <= now;
        var blocked = tenant.Status == TenantStatus.Cancelled
            || tenant.Status == TenantStatus.Suspended
            || (tenant.Status == TenantStatus.Trial && expiredTrial);

        if (blocked && !IsSelfServiceBillingPath(httpContext.Request))
        {
            string code;
            string message;
            if (expiredTrial)
            {
                code = "TrialExpired";
                message = TrialExpiredMessage;
            }
            else if (expiredSubscription)
            {
                code = "SubscriptionExpired";
                message = SubscriptionExpiredMessage;
            }
            else if (tenant.Status == TenantStatus.Cancelled)
            {
                code = "TenantCancelled";
                message = "Kurum iptal edilmiş. Platform yöneticisiyle görüşün.";
            }
            else
            {
                code = "TenantSuspended";
                message = "Kurum askıya alınmış. Lütfen platform yöneticisiyle görüşün.";
            }

            await WriteBlockedAsync(httpContext, StatusCodes.Status403Forbidden, code, message);
            return;
        }

        await _next(httpContext);
    }

    private static bool IsSelfServiceBillingPath(HttpRequest request)
    {
        var path = request.Path.Value?.TrimEnd('/') ?? string.Empty;
        if (path.StartsWith("/api/admin/subscription-plans", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("/api/admin/tenant/upgrade", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("/api/admin/usage", StringComparison.OrdinalIgnoreCase)) return true;
        if (HttpMethods.IsGet(request.Method) && path.Equals("/api/admin/tenant", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static async Task WriteBlockedAsync(HttpContext httpContext, int statusCode, string code, string message)
    {
        httpContext.Response.StatusCode = statusCode;
        httpContext.Response.ContentType = "application/json; charset=utf-8";
        var response = ApiResponse<object>.Fail(code, message, httpContext.TraceIdentifier);
        await httpContext.Response.WriteAsJsonAsync(response);
    }
}

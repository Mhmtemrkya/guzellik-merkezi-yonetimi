using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.SubscriptionPlans;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class SubscriptionPlanEndpoints
{
    public static IEndpointRouteBuilder MapSubscriptionPlanEndpoints(this IEndpointRouteBuilder app)
    {
        // Plan kataloğu — platform admin yönetir.
        var platform = app.MapGroup("/api/platform/subscription-plans").WithTags("Subscription Plans").RequireAuthorization("PlatformAdmin");

        platform.MapGet("/", async (ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.ListAsync(ct)).ToHttpResult(http));

        platform.MapGet("/{id:guid}", async (Guid id, ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.GetAsync(id, ct)).ToHttpResult(http));

        platform.MapPost("/", async (CreateSubscriptionPlanRequest req, ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.CreateAsync(req, ct)).ToHttpResult(http));

        platform.MapPut("/{id:guid}", async (Guid id, UpdateSubscriptionPlanRequest req, ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.UpdateAsync(id, req, ct)).ToHttpResult(http));

        platform.MapDelete("/{id:guid}", async (Guid id, ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.DeleteAsync(id, ct)).ToHttpResult(http));

        platform.MapPost("/{id:guid}/assign", async (Guid id, AssignTenantPayload payload, ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.AssignToTenantAsync(payload.TenantId, id, ParsePeriod(payload.BillingPeriod), ct)).ToHttpResult(http));

        // Public list: aktif tenant kullanıcısı kendi paket detayları görüntü için.
        app.MapGet("/api/admin/subscription-plans", async (ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
            (await svc.ListAsync(ct)).ToHttpResult(http))
            .WithTags("Subscription Plans").RequireAuthorization();

        // Self-service yükseltme: kurum yöneticisi kendi tenant'ı için yeni paket seçer.
        app.MapPost("/api/admin/tenant/upgrade", async (
            AdminUpgradePayload payload, Guid? tenantId, ICurrentUser cu,
            ISubscriptionPlanService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.AssignToTenantAsync(t, payload.SubscriptionPlanId, ParsePeriod(payload.BillingPeriod), ct)).ToHttpResult(http);
        }).WithTags("Subscription Plans").RequireAuthorization();

        // Usage endpoint'leri
        app.MapGet("/api/platform/usage", async (IUsageService usage, HttpContext http, CancellationToken ct) =>
            (await usage.GetPlatformSummaryAsync(ct)).ToHttpResult(http))
            .WithTags("Usage").RequireAuthorization("PlatformAdmin");

        app.MapGet("/api/admin/usage", async (Guid? tenantId, ICurrentUser cu, IUsageService usage, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await usage.GetTenantUsageAsync(t, ct)).ToHttpResult(http);
        }).WithTags("Usage").RequireAuthorization();

        return app;
    }

    /// <summary>Paket atama/yükseltme döneminin varsayılanı Aylık'tır; "Yearly" gelirse Yıllık.</summary>
    private static BillingPeriod ParsePeriod(string? value)
        => string.Equals(value?.Trim(), "Yearly", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value?.Trim(), "Yıllık", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value?.Trim(), "Yillik", StringComparison.OrdinalIgnoreCase)
            ? BillingPeriod.Yearly
            : BillingPeriod.Monthly;

    public sealed record AssignTenantPayload(Guid TenantId, string? BillingPeriod = null);
    public sealed record AdminUpgradePayload(Guid SubscriptionPlanId, string? BillingPeriod = null);
}

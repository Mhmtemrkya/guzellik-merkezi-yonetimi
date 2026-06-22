using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var tpl = app.MapGroup("/api/admin/notification-templates").WithTags("Notifications").RequireAuthorization().RequirePermission(Permissions.Notifications);

        tpl.MapGet("/", async (Guid? tenantId, int page, int pageSize, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.ListTemplatesAsync(t, new PageRequest(page, pageSize), ct)).ToHttpResult(http);
        });

        tpl.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.GetTemplateAsync(t, id, ct)).ToHttpResult(http);
        });

        tpl.MapPost("/", async (CreateNotificationTemplateRequest req, Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.CreateTemplateAsync(t, req, ct)).ToHttpResult(http);
        });

        tpl.MapPut("/{id:guid}", async (Guid id, UpdateNotificationTemplateRequest req, Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.UpdateTemplateAsync(t, id, req, ct)).ToHttpResult(http);
        });

        tpl.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.DeleteTemplateAsync(t, id, ct)).ToHttpResult(http);
        });

        tpl.MapPost("/send", async (SendNotificationRequest req, Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.SendAsync(t, req, ct)).ToHttpResult(http);
        });

        // Vadesi geçen taksit hatırlatmasını şimdi çalıştır (arka plan taramasını beklemeden).
        tpl.MapPost("/payment-reminders/run", async (Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.RunPaymentDueRemindersAsync(t, ct)).ToHttpResult(http);
        });

        var logs = app.MapGroup("/api/admin/notification-logs").WithTags("Notifications").RequireAuthorization().RequirePermission(Permissions.Notifications);

        logs.MapGet("/", async (Guid? tenantId, Guid? templateId, int page, int pageSize, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.ListLogsAsync(t, templateId, new PageRequest(page, pageSize), ct)).ToHttpResult(http);
        });

        app.MapGet("/api/admin/notifications/summary", async (Guid? tenantId, ICurrentUser cu, INotificationService svc, HttpContext http, CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            return t == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await svc.GetSummaryAsync(t, ct)).ToHttpResult(http);
        }).WithTags("Notifications").RequireAuthorization();

        return app;
    }
}

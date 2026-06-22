using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AuditLogs;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class AuditLogEndpoints
{
    public static IEndpointRouteBuilder MapAuditLogEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/logs").WithTags("Audit Logs").RequireAuthorization().RequirePermission(Permissions.Logs);

        group.MapGet("/", async (
            Guid? tenantId,
            string? action,
            string? entity,
            Guid? actorUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            string? search,
            int page,
            int pageSize,
            ICurrentUser cu,
            IAuditLogService svc,
            HttpContext http,
            CancellationToken ct) =>
        {
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var filter = new AuditLogFilter(action, entity, actorUserId, fromUtc, toUtc, search);
            return (await svc.ListAsync(t, filter, new PageRequest(page, pageSize), ct)).ToHttpResult(http);
        });

        group.MapGet("/all", async (
            Guid? tenantId,
            string? action,
            string? entity,
            Guid? actorUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            string? search,
            ICurrentUser cu,
            IAuditLogService svc,
            HttpContext http,
            CancellationToken ct) =>
        {
            if (!CanManageTenantAuditLogs(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var filter = new AuditLogFilter(action, entity, actorUserId, fromUtc, toUtc, search);
            return (await svc.ListAllAsync(t, filter, ct)).ToHttpResult(http);
        });

        group.MapDelete("/clear", async (
            Guid? tenantId,
            ICurrentUser cu,
            IAuditLogService svc,
            HttpContext http,
            CancellationToken ct) =>
        {
            if (!CanManageTenantAuditLogs(cu)) return Forbidden(http);
            var t = EndpointHelpers.ResolveTenantId(cu, tenantId);
            if (t == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            return (await svc.DeleteAllAsync(t, ct)).ToHttpResult(http);
        });

        return app;
    }

    private static bool CanManageTenantAuditLogs(ICurrentUser currentUser) =>
        currentUser.Role is UserRole.InstitutionOwner or UserRole.PlatformAdmin;

    private static IResult Forbidden(HttpContext httpContext) =>
        Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Log kayıtlarını yalnızca kurum yöneticisi silebilir/görüntüleyebilir.", httpContext.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
}

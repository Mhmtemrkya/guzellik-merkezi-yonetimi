using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Schedule;

namespace GuzellikMerkezi.Api.Endpoints;

public static class ScheduleEndpoints
{
    public static IEndpointRouteBuilder MapScheduleEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/schedule").WithTags("Schedule").RequireAuthorization();

        group.MapGet("/timeoff", async (Guid? tenantId, DateOnly fromDate, DateOnly toDate, ICurrentUser currentUser, IScheduleService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListTimeOffAsync(resolvedTenantId, fromDate, toDate, ct)).ToHttpResult(http);
        });

        group.MapPost("/timeoff", async (CreateTimeOffRequest request, Guid? tenantId, ICurrentUser currentUser, IScheduleService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.AddTimeOffAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/timeoff/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IScheduleService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RemoveTimeOffAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}

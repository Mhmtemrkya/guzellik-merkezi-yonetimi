using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class ExpenseEndpoints
{
    public static IEndpointRouteBuilder MapExpenseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/expenses").WithTags("Expenses").RequireAuthorization();

        group.MapGet("/", async (
            Guid? tenantId,
            DateTime? fromUtc,
            DateTime? toUtc,
            ExpenseCategory? category,
            Guid? staffMemberId,
            int page,
            int pageSize,
            ICurrentUser currentUser,
            IExpenseService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var filter = new ExpenseFilter(fromUtc, toUtc, category, staffMemberId);
            return (await service.ListAsync(resolvedTenantId, filter, new PageRequest(page, pageSize), ct)).ToHttpResult(http);
        });

        group.MapGet("/summary", async (
            Guid? tenantId,
            DateTime? fromUtc,
            DateTime? toUtc,
            ExpenseCategory? category,
            Guid? staffMemberId,
            ICurrentUser currentUser,
            IExpenseService service,
            HttpContext http,
            CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var filter = new ExpenseFilter(fromUtc, toUtc, category, staffMemberId);
            return (await service.SummaryAsync(resolvedTenantId, filter, ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IExpenseService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateExpenseRequest request, Guid? tenantId, ICurrentUser currentUser, IExpenseService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateExpenseRequest request, Guid? tenantId, ICurrentUser currentUser, IExpenseService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/approve", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IExpenseService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ApproveAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/revoke", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IExpenseService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RevokeAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IExpenseService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}

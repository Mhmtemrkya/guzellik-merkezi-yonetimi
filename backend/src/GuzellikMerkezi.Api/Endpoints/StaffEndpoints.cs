using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class StaffEndpoints
{
    public static IEndpointRouteBuilder MapStaffEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/staff").WithTags("Staff").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            var staffTenantUserId = currentUser.Role == UserRole.Staff ? currentUser.UserId : null;
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct, staffTenantUserId)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateStaffRequest request, Guid? tenantId, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateStaffRequest request, Guid? tenantId, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // Şifre sıfırlama — yalnızca yönetici roller; yeni geçici şifre tek seferlik döner.
        group.MapPost("/{id:guid}/reset-password", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            if (currentUser.Role == UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ResetPasswordAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        // Şubeler arası aktarma — yalnızca yönetici roller (çok şubeli kurumlarda kullanılır).
        group.MapPost("/{id:guid}/transfer-branch", async (Guid id, TransferStaffBranchRequest request, Guid? tenantId, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            if (currentUser.Role == UserRole.Staff) return Results.Forbid();
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.TransferBranchAsync(resolvedTenantId, id, request.BranchId, ct)).ToHttpResult(http);
        });

        // Mevcut izin listesi (frontend checkbox grid için)
        group.MapGet("/permissions", () => Results.Ok(GuzellikMerkezi.Domain.Permissions.All.Select(p => new { p.Key, p.Label, p.Description })));

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IStaffService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}

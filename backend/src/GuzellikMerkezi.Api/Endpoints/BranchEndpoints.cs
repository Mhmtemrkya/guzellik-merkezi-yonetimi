using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Validation;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class BranchEndpoints
{
    public static IEndpointRouteBuilder MapBranchEndpoints(this IEndpointRouteBuilder app)
    {
        // YETKİ: TÜM KURUM KULLANICILARI — personel kendi şube kapsamını bilmek zorunda (navbar şube seçici, randevu formu).
        // Okuma zararsızdır; YAZMA yolları personelde onay kapısına düşer (StaffApprovalGateMiddleware).
        var group = app.MapGroup("/api/admin/branches").WithTags("Branches").RequireAuthorization();

        group.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        // ŞUBE YAZMA = BranchWrite. Okuma tüm kurum kullanıcılarına açık (şube seçici herkeste var),
        // ama şube açmak/yeniden adlandırmak/varsayılan yapmak rol tablosunda BranchWrite'ı olan
        // rollere aittir (kurum sahibi + platform admin). Şube yöneticisinde bu yetki YOKTUR.
        group.MapPost("/", async (UpsertBranchRequest request, Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpsertBranchRequest>().RequireRolePermission(Permission.BranchWrite);

        group.MapPut("/{id:guid}", async (Guid id, UpsertBranchRequest request, Guid? tenantId, ICurrentUser currentUser, IBranchService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        }).ValidatesRequest<UpsertBranchRequest>().RequireRolePermission(Permission.BranchWrite);

        return app;
    }
}

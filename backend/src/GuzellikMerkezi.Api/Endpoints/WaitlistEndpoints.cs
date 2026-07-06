using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Api.Endpoints;

public static class WaitlistEndpoints
{
    public static IEndpointRouteBuilder MapWaitlistEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/waitlist").WithTags("Waitlist").RequireAuthorization().RequirePermission(Permissions.Waitlist);

        group.MapGet("/", async (Guid? tenantId, bool? activeOnly, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, activeOnly, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateWaitlistRequest request, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/status", async (Guid id, UpdateWaitlistStatusRequest request, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SetStatusAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // Manuel "Yer öner": kaydı Notified yap + WhatsApp teklif mesajı gönder (boşalan slotu elle teklif etmek için).
        // WhatsApp gönderimi (yavaş Meta HTTP) KALICI kuyruğa yazılır → istek yanıtı beklemez, restart'ta kaybolmaz.
        group.MapPost("/{id:guid}/offer", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, IDurableJobQueue jobs, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var res = await service.SetStatusAsync(resolvedTenantId, id, new UpdateWaitlistStatusRequest(WaitlistStatus.Notified), ct);
            if (res.IsSuccess) await jobs.EnqueueAsync(DurableJobTypes.WaitlistOffer, new WaitlistOfferJob(resolvedTenantId, id), ct);
            return res.ToHttpResult(http);
        });

        // Manuel "Randevuya çevir": telefonla/yüz yüze teyit alınca teklifi elle randevuya dönüştür + aktifleşti mesajı (kalıcı kuyrukta).
        group.MapPost("/{id:guid}/book", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, IDurableJobQueue jobs, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var res = await service.AcceptOfferAsync(resolvedTenantId, id, ct);
            if (res.IsSuccess && res.Value is { } appointmentId) await jobs.EnqueueAsync(DurableJobTypes.WaitlistActivated, new WaitlistActivatedJob(resolvedTenantId, appointmentId), ct);
            return res.ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IWaitlistService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        return app;
    }
}

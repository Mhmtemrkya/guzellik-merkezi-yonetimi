using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Application.Features.Consents;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Onam formu uçları.
///
/// Şablonlar /api/admin altındadır (personel yazma işlemleri onay kapısına takılır).
/// İmza akışı ise /api/consent altındadır: tablet ve personel gerçek zamanlı çalışır,
/// onay kuyruğuna düşerse imza hiç alınamaz.
/// </summary>
public static class ConsentEndpoints
{
    public static IEndpointRouteBuilder MapConsentEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- şablonlar (kurum yöneticisi) ----
        var templates = app.MapGroup("/api/admin/consent-templates").WithTags("Consents")
            .RequireAuthorization().RequirePermission(Permissions.Customers);

        templates.MapGet("/", async (Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListTemplatesAsync(resolved, ct)).ToHttpResult(http);
        });

        templates.MapPost("/", async (UpsertConsentTemplateRequest request, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateTemplateAsync(resolved, request, ct)).ToHttpResult(http);
        });

        templates.MapPut("/{id:guid}", async (Guid id, UpsertConsentTemplateRequest request, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateTemplateAsync(resolved, id, request, ct)).ToHttpResult(http);
        });

        templates.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteTemplateAsync(resolved, id, ct)).ToHttpResult(http);
        });

        // ---- müşteri kayıtları + imza oturumu ----
        // /api/admin ALTINDA DEĞİL: imza akışı anlık çalışmalı, personel onay kapısına takılmamalı.
        // GÜVENLİK: /api/admin dışında olduğu için onay kapısına da girmiyor; izin kontrolü
        // BURADA yapılmazsa izinsiz personel imzalı onam ve dijital imza görsellerine erişebilir.
        var forms = app.MapGroup("/api/consent").WithTags("Consents")
            .RequireAuthorization().RequirePermission(Permissions.Customers);

        forms.MapGet("/customers/{customerId:guid}", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListCustomerFormsAsync(resolved, customerId, ct)).ToHttpResult(http);
        });

        forms.MapGet("/customers/{customerId:guid}/status", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetCustomerStatusAsync(resolved, customerId, ct)).ToHttpResult(http);
        });

        forms.MapGet("/appointments/{appointmentId:guid}/status", async (Guid appointmentId, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAppointmentStatusAsync(resolved, appointmentId, ct)).ToHttpResult(http);
        });

        forms.MapGet("/forms/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetFormAsync(resolved, id, ct)).ToHttpResult(http);
        });

        forms.MapPost("/forms", async (CreateConsentFormRequest request, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateFormAsync(resolved, request, ct)).ToHttpResult(http);
        });

        forms.MapPut("/forms/{id:guid}", async (Guid id, UpdateConsentFormRequest request, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateFormAsync(resolved, id, request, ct)).ToHttpResult(http);
        });

        forms.MapDelete("/forms/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CancelFormAsync(resolved, id, ct)).ToHttpResult(http);
        });

        // "Tablete Aktar" — tek kullanımlık imza oturumu açar.
        forms.MapPost("/forms/{id:guid}/session", async (Guid id, StartConsentSessionRequest request, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.StartSessionAsync(resolved, id, request, ct)).ToHttpResult(http);
        });

        forms.MapDelete("/forms/{id:guid}/session", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CancelSessionAsync(resolved, id, ct)).ToHttpResult(http);
        });

        // Tablet yoklaması: bu istasyona gönderilmiş bekleyen form.
        forms.MapGet("/station/pending", async (string? station, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetPendingForStationAsync(resolved, station, ct)).ToHttpResult(http);
        });

        forms.MapGet("/session/{token:guid}", async (Guid token, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetBySessionAsync(resolved, token, ct)).ToHttpResult(http);
        });

        forms.MapPost("/session/{token:guid}/sign", async (Guid token, SignConsentFormRequest request, Guid? tenantId, ICurrentUser currentUser, IConsentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolved = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolved == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.SignAsync(resolved, token, request, ct)).ToHttpResult(http);
        });

        return app;
    }
}

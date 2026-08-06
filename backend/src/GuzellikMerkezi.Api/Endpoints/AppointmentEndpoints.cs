using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Validation;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

public static class AppointmentEndpoints
{
    public static IEndpointRouteBuilder MapAppointmentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/appointments").WithTags("Appointments").RequireAuthorization().RequirePermission(Permissions.Appointments);

        group.MapGet("/", async (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, int page, int pageSize, Guid? customerId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, fromUtc, toUtc, new PageRequest(page, pageSize), ct, ResolveStaffTenantUserId(currentUser), customerId)).ToHttpResult(http);
        });

        // Kurum yöneticisi aksiyon kutusu — saati gelmiş randevular + onay bekleyen taslaklar.
        group.MapGet("/inbox", async (Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetInboxAsync(resolvedTenantId, DateTime.UtcNow, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateAppointmentRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        }).ValidatesRequest<CreateAppointmentRequest>();

        group.MapPatch("/{id:guid}/schedule", async (Guid id, RescheduleAppointmentRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RescheduleAsync(resolvedTenantId, id, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/status", async (Guid id, ChangeAppointmentStatusRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ChangeStatusAsync(resolvedTenantId, id, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        // Randevu + katalog satışı TEK işlem. Ekran eskiden adisyon aç → kalem ekle → randevu
        // diye üç ayrı çağrı yapıyordu; randevu adımı düşünce müşteriye yazılmış açık satış
        // ortada kalıyordu. Satış verilmezse davranış normal oluşturmayla aynıdır.
        group.MapPost("/with-sale", async (CreateAppointmentWithSaleRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateWithSaleAsync(resolvedTenantId, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        // Tamamlama + tahsilat TEK işlem. Ekran eskiden iki ayrı çağrı yapıyordu; ikincisi
        // düşünce "randevu tamamlandı, para alınmadı" durumu kalıcı oluyordu.
        // Onay kapısı açısından /status ile aynı sınıftadır (randevu durum değişikliği).
        group.MapPost("/{id:guid}/complete", async (Guid id, CompleteAppointmentRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CompleteWithPaymentAsync(resolvedTenantId, id, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        // YANLIŞ TAMAMLAMANIN GERİ ALINMASI. Onay kapısı açısından /status ile aynı sınıfta DEĞİLDİR:
        // ayrı yetki (Appointments.VoidCompletion) ister ve personel isteği taslağa düşer.
        group.MapPost("/{id:guid}/void-completion", async (Guid id, VoidAppointmentCompletionRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.VoidCompletionAsync(resolvedTenantId, id, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        // Taslak randevu onayı (Draft → aktif) — kurum yöneticisi.
        group.MapPost("/{id:guid}/approve", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ApproveAsync(resolvedTenantId, id, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/notes", async (Guid id, ChangeAppointmentNotesRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ChangeNotesAsync(resolvedTenantId, id, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        // Düzenleme ekranının TEK kaydetme ucu: zaman + durum + not aynı transaction'da.
        // Üç ayrı çağrı yapıldığında ortadaki başarılı olup sonraki patlarsa randevu tamamlanmış
        // (ve seans düşmüş) hâlde kalırken arayüz "kaydedilemedi" gösteriyordu.
        group.MapPatch("/{id:guid}", async (Guid id, UpdateAppointmentRequest request, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        group.MapDelete("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, IAppointmentService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.DeleteAsync(resolvedTenantId, id, ct, ResolveStaffTenantUserId(currentUser))).ToHttpResult(http);
        });

        return app;
    }

    private static Guid? ResolveStaffTenantUserId(ICurrentUser currentUser)
    {
        if (currentUser.Role != UserRole.Staff) return null;
        return currentUser.UserId ?? Guid.Empty;
    }
}

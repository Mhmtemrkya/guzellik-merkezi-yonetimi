using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerPortal;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Online randevu portalı (mobil müşteri rolü). Tüm uçlar müşterinin JWT'sindeki customer_id'ye
/// bağlıdır; müşteri yalnızca kendi kurumunun şube/hizmet/personelini görür ve randevu alır.
/// </summary>
public static class CustomerPortalEndpoints
{
    public static IEndpointRouteBuilder MapCustomerPortalEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/customer").WithTags("CustomerPortal").RequireAuthorization();

        group.MapGet("/me", async (ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.GetProfileAsync(id, ct)).ToHttpResult(http)
                : Forbidden(http));

        group.MapGet("/branches", async (ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.ListBranchesAsync(id, ct)).ToHttpResult(http)
                : Forbidden(http));

        group.MapGet("/branches/{branchId:guid}/services", async (Guid branchId, ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.ListServicesAsync(id, branchId, ct)).ToHttpResult(http)
                : Forbidden(http));

        group.MapGet("/branches/{branchId:guid}/staff", async (Guid branchId, Guid serviceId, ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.ListStaffAsync(id, branchId, serviceId, ct)).ToHttpResult(http)
                : Forbidden(http));

        group.MapGet("/availability", async (Guid branchId, Guid staffId, Guid serviceId, DateOnly date, ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.GetAvailabilityAsync(id, branchId, staffId, serviceId, date, ct)).ToHttpResult(http)
                : Forbidden(http));

        // Randevu talebi Draft (yönetici onayı bekleyen) olarak oluşur; spam'e karşı IP hız sınırı uygulanır.
        group.MapPost("/appointments", async (CreatePortalAppointmentRequest request, ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.CreateAppointmentAsync(id, request, ct)).ToHttpResult(http)
                : Forbidden(http)).RequireRateLimiting("customer-portal-write");

        group.MapGet("/appointments", async (ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.ListMyAppointmentsAsync(id, ct)).ToHttpResult(http)
                : Forbidden(http));

        // Müşteri kendi randevusunu iptal eder (başlangıca ≥ 2 saat varken).
        group.MapPost("/appointments/{appointmentId:guid}/cancel", async (Guid appointmentId, ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.CancelMyAppointmentAsync(id, appointmentId, ct)).ToHttpResult(http)
                : Forbidden(http)).RequireRateLimiting("customer-portal-write");

        // Müşteri kendi randevusunu erteler — yeni saat yönetici onayına (Draft) düşer.
        group.MapPost("/appointments/{appointmentId:guid}/reschedule", async (Guid appointmentId, ReschedulePortalAppointmentRequest request, ICurrentUser currentUser, ICustomerPortalService service, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await service.RescheduleMyAppointmentAsync(id, appointmentId, request, ct)).ToHttpResult(http)
                : Forbidden(http)).RequireRateLimiting("customer-portal-write");

        // Salon sayfasından manuel yorum: yalnızca o salonda tamamlanmış randevusu olan gerçek müşteri.
        group.MapPost("/salons/{slug}/review", async (string slug, Application.Features.PublicSalons.SubmitSalonReviewRequest request, ICurrentUser currentUser, Application.Features.PublicSalons.IPublicSalonService salons, HttpContext http, CancellationToken ct) =>
            RequireCustomer(currentUser, http, out var id)
                ? (await salons.SubmitReviewAsync(id, slug, request, ct)).ToHttpResult(http)
                : Forbidden(http)).RequireRateLimiting("customer-portal-write");

        return app;
    }

    private static bool RequireCustomer(ICurrentUser currentUser, HttpContext http, out Guid customerId)
    {
        customerId = currentUser.CustomerId ?? Guid.Empty;
        return customerId != Guid.Empty;
    }

    private static IResult Forbidden(HttpContext http) =>
        Results.Json(ApiResponse<object>.Fail("Forbidden", "Bu işlem yalnızca müşteri hesabıyla yapılabilir.", http.TraceIdentifier), statusCode: StatusCodes.Status403Forbidden);
}

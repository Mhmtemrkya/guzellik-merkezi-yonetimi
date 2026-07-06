using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AppNotifications;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Uygulama-içi bildirim uçları. Kasıtlı olarak <c>/api/admin</c> DIŞINDA (<c>/api/notifications</c>):
/// personel onay kapısı (StaffApprovalGate) yalnızca /api/admin yazma isteklerini taslağa düşürür;
/// "okundu" işaretleme / token kaydı gibi rutin işlemler onaya takılmamalı.
/// Her kullanıcı yalnızca KENDİ bildirimlerini görür/işler (RecipientUserId = giriş yapan kullanıcı).
/// </summary>
public static class AppNotificationEndpoints
{
    public static IEndpointRouteBuilder MapAppNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/notifications").WithTags("Notifications").RequireAuthorization();

        // Feed (yoklama): since'den sonra oluşan bildirimler + okunmamış sayaç + sunucu saati.
        group.MapGet("/feed", async (DateTime? since, bool? unreadOnly, int? take,
            ICurrentUser currentUser, IAppNotificationService service, HttpContext http, CancellationToken ct) =>
        {
            var (tenantId, userId) = Resolve(currentUser);
            if (userId == Guid.Empty) return Results.Unauthorized();
            return (await service.GetFeedAsync(tenantId, userId, since, unreadOnly ?? false, take ?? 30, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/read", async (Guid id,
            ICurrentUser currentUser, IAppNotificationService service, HttpContext http, CancellationToken ct) =>
        {
            var (tenantId, userId) = Resolve(currentUser);
            if (userId == Guid.Empty) return Results.Unauthorized();
            return (await service.MarkReadAsync(tenantId, userId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/read-all", async (
            ICurrentUser currentUser, IAppNotificationService service, HttpContext http, CancellationToken ct) =>
        {
            var (tenantId, userId) = Resolve(currentUser);
            if (userId == Guid.Empty) return Results.Unauthorized();
            return (await service.MarkAllReadAsync(tenantId, userId, ct)).ToHttpResult(http);
        });

        // FCM/APNs token kaydı (mobil, uzaktan push için). LAN yoklaması bu ucu gerektirmez.
        group.MapPost("/device-token", async (RegisterDeviceTokenRequest request,
            ICurrentUser currentUser, IAppNotificationService service, HttpContext http, CancellationToken ct) =>
        {
            var (tenantId, userId) = Resolve(currentUser);
            if (userId == Guid.Empty) return Results.Unauthorized();
            return (await service.RegisterDeviceTokenAsync(tenantId, userId, request, ct)).ToHttpResult(http);
        });

        group.MapDelete("/device-token/{deviceId}", async (string deviceId,
            ICurrentUser currentUser, IAppNotificationService service, HttpContext http, CancellationToken ct) =>
        {
            var (tenantId, userId) = Resolve(currentUser);
            if (userId == Guid.Empty) return Results.Unauthorized();
            return (await service.UnregisterDeviceTokenAsync(tenantId, userId, deviceId, ct)).ToHttpResult(http);
        });

        return app;
    }

    private static (Guid TenantId, Guid UserId) Resolve(ICurrentUser currentUser) =>
        (currentUser.TenantId ?? Guid.Empty, currentUser.UserId ?? Guid.Empty);
}

using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.AppNotifications;

/// <summary>
/// Uygulama-içi bildirim (push + feed) servisi. İki grup metot:
///  1) YAYIN (Notify*): diğer servisler/arka plan işleri çağırır. Çağıranın akışını ASLA bozmaz
///     (kendi içinde try/catch + ayrı unit-of-work); alıcıları role/kullanıcıya göre çözer, satır yazar,
///     ardından kayıtlı cihaz token'larına FCM push dener (yapılandırılmışsa).
///  2) TÜKETİM (GetFeed/MarkRead/RegisterToken): mobil endpoint'lerinden çağrılır, kullanıcı bağlamı ister.
/// </summary>
public interface IAppNotificationService
{
    // ---- Yayın (fire-and-forget güvenli) ----

    Task NotifyUserAsync(
        Guid tenantId,
        Guid? branchId,
        Guid recipientUserId,
        AppNotificationType type,
        AppNotificationSeverity severity,
        string title,
        string body,
        object? data = null,
        string? dedupeKey = null,
        CancellationToken ct = default);

    /// <summary>
    /// Verilen rollerdeki aktif kullanıcılara bildirir. branchScoped=true iken bir kullanıcı,
    /// yalnızca şubesi olay şubesiyle eşleşiyorsa VEYA şubesi null (kurum geneli, ör. kurum yöneticisi) ise dahil edilir.
    /// </summary>
    Task NotifyRolesAsync(
        Guid tenantId,
        Guid? branchId,
        IReadOnlyCollection<UserRole> roles,
        AppNotificationType type,
        AppNotificationSeverity severity,
        string title,
        string body,
        object? data = null,
        string? dedupeKey = null,
        bool branchScoped = true,
        CancellationToken ct = default);

    // ---- Tüketim (mobil) ----

    Task<Result<AppNotificationFeedDto>> GetFeedAsync(
        Guid tenantId, Guid userId, DateTime? sinceUtc, bool unreadOnly, int take, CancellationToken ct = default);

    Task<Result> MarkReadAsync(Guid tenantId, Guid userId, Guid notificationId, CancellationToken ct = default);
    Task<Result> MarkAllReadAsync(Guid tenantId, Guid userId, CancellationToken ct = default);
    Task<Result> RegisterDeviceTokenAsync(Guid tenantId, Guid userId, RegisterDeviceTokenRequest req, CancellationToken ct = default);
    Task<Result> UnregisterDeviceTokenAsync(Guid tenantId, Guid userId, string deviceId, CancellationToken ct = default);
}

using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.AppNotifications;

/// <summary>Feed'de dönen tek bildirim. Enum alanları JSON'da integer (mobil int okur).</summary>
public sealed record AppNotificationDto(
    Guid Id,
    AppNotificationType Type,
    AppNotificationSeverity Severity,
    string Title,
    string Body,
    string? DataJson,
    bool IsRead,
    DateTime CreatedAtUtc);

/// <summary>
/// Yoklama yanıtı: yeni/tüm bildirimler + okunmamış sayaç + sunucu saati.
/// Mobil ServerTimeUtc'yi bir sonraki isteğin "since" parametresi olarak kullanır (saat kayması güvenli).
/// </summary>
public sealed record AppNotificationFeedDto(
    IReadOnlyList<AppNotificationDto> Items,
    int UnreadCount,
    DateTime ServerTimeUtc);

/// <summary>FCM/APNs kayıt token'ını cihaz için kaydeder/günceller.</summary>
public sealed record RegisterDeviceTokenRequest(
    string DeviceId,
    string Token,
    string? Platform);

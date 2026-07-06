using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bir kullanıcının bir cihazındaki push (FCM/APNs) kayıt token'ı. (TenantUserId, DeviceId) ile upsert edilir.
/// FCM token'ı opak ve as-is kullanılması gerektiğinden ŞİFRELENMEZ (bkz. DbContext encryption listesi).
/// LAN feed yoklaması token'a ihtiyaç duymaz; bu kayıt yalnızca gerçek uzaktan push (FCM) için doldurulur.
/// </summary>
public sealed class DeviceNotificationToken : Entity
{
    private DeviceNotificationToken() { }

    public DeviceNotificationToken(Guid tenantId, Guid tenantUserId, string deviceId, string token, string? platform, DateTime utcNow)
    {
        if (tenantUserId == Guid.Empty) throw new DomainException("Kullanıcı kimliği boş olamaz.");
        if (string.IsNullOrWhiteSpace(deviceId)) throw new DomainException("Cihaz kimliği boş olamaz.");
        if (string.IsNullOrWhiteSpace(token)) throw new DomainException("Push token boş olamaz.");
        TenantId = tenantId;
        TenantUserId = tenantUserId;
        DeviceId = deviceId.Trim();
        Token = token.Trim();
        Platform = NormalizePlatform(platform);
        LastSeenUtc = utcNow;
    }

    public Guid TenantId { get; private set; }
    public Guid TenantUserId { get; private set; }
    public TenantUser? TenantUser { get; private set; }
    public string DeviceId { get; private set; } = string.Empty;
    public string Token { get; private set; } = string.Empty;
    public string Platform { get; private set; } = "android";
    public DateTime LastSeenUtc { get; private set; }

    public void Update(string token, string? platform, DateTime utcNow)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new DomainException("Push token boş olamaz.");
        Token = token.Trim();
        Platform = NormalizePlatform(platform);
        LastSeenUtc = utcNow;
        Touch(utcNow);
    }

    private static string NormalizePlatform(string? platform)
    {
        var p = platform?.Trim().ToLowerInvariant();
        return p switch { "ios" => "ios", "web" => "web", _ => "android" };
    }
}

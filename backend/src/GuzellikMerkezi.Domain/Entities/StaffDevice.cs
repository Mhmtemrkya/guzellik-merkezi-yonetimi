using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Cihaz güvenliği özelliği: personelin giriş yapmasına izin verilen tanımlı cihaz.
/// DeviceId istemci tarafında üretilen kalıcı kimliktir (localStorage/cihaz deposu).
/// Kurum yöneticisi personel başına cihaz limiti belirler (TenantUser.MaxDeviceCount);
/// limit doluyken tanımsız cihazdan giriş engellenir ve güvenlik logu düşer.
/// </summary>
public sealed class StaffDevice : Entity
{
    private StaffDevice() { }

    public StaffDevice(Guid tenantId, Guid tenantUserId, string deviceId, string name, string? deviceType, string? userAgent, string? networkInfoJson, string? ipAddress, DateTime nowUtc)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) throw new DomainException("Cihaz kimliği boş olamaz.");
        TenantId = tenantId;
        TenantUserId = tenantUserId;
        DeviceId = deviceId.Trim();
        Rename(name);
        DeviceType = string.IsNullOrWhiteSpace(deviceType) ? null : deviceType.Trim();
        RecordSeen(nowUtc, userAgent, networkInfoJson, ipAddress);
    }

    public Guid TenantId { get; private set; }
    public Guid TenantUserId { get; private set; }
    public TenantUser? TenantUser { get; private set; }
    /// <summary>İstemcinin ürettiği kalıcı cihaz kimliği (UUID).</summary>
    public string DeviceId { get; private set; } = string.Empty;
    /// <summary>Kullanıcının/otomatiğin verdiği cihaz adı ("Kurum PC'si", "Cep telefonum").</summary>
    public string Name { get; private set; } = string.Empty;
    /// <summary>Pc / Mobile / Tablet vb. — istemci beyanı.</summary>
    public string? DeviceType { get; private set; }
    public string? UserAgent { get; private set; }
    /// <summary>İstemciden gelen ağ/wifi bilgisi (bağlantı türü, hız vb.) JSON olarak.</summary>
    public string? NetworkInfoJson { get; private set; }
    public string? LastIpAddress { get; private set; }
    public DateTime LastSeenUtc { get; private set; }

    public void Rename(string name)
    {
        Name = string.IsNullOrWhiteSpace(name) ? "Tanımsız cihaz" : name.Trim();
        Touch();
    }

    public void RecordSeen(DateTime nowUtc, string? userAgent, string? networkInfoJson, string? ipAddress)
    {
        LastSeenUtc = nowUtc;
        if (!string.IsNullOrWhiteSpace(userAgent)) UserAgent = userAgent.Trim();
        if (!string.IsNullOrWhiteSpace(networkInfoJson)) NetworkInfoJson = networkInfoJson;
        if (!string.IsNullOrWhiteSpace(ipAddress)) LastIpAddress = ipAddress.Trim();
        Touch(nowUtc);
    }
}

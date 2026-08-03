namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Anlık (push) haber verme. Kalıcılık BURADA DEĞİL: durum her zaman veritabanındadır
/// (pending_operations, app_notifications). Bu arayüz yalnızca "şu an açık olan ekranlar
/// hemen tazelensin" içindir — mesaj kaybolursa istemci yeniden bağlanınca durumu sunucudan
/// okur ve hiçbir bilgi yitmez.
/// </summary>
public interface IRealtimeNotifier
{
    /// <summary>Kurumdaki tüm bağlı istemcilere yayınlar.</summary>
    Task PublishToTenantAsync(Guid tenantId, RealtimeEvent payload, CancellationToken ct = default);

    /// <summary>Tek bir kullanıcının açık oturumlarına yayınlar (ör. isteği gönderen personel).</summary>
    Task PublishToUserAsync(Guid tenantId, Guid userId, RealtimeEvent payload, CancellationToken ct = default);
}

/// <summary>
/// İstemciye giden olay. <paramref name="Topics"/> "neyi tazele" ipucudur: ekranlar ilgilendikleri
/// konuya abone olur (ör. "adisyon", "sessions", "approvals") ve yalnız kendi verisini yeniler.
/// </summary>
/// <param name="Kind">Olay türü — ör. "approval.approved", "approval.rejected", "notification".</param>
/// <param name="Title">Kullanıcıya gösterilebilecek kısa başlık.</param>
/// <param name="Message">Kullanıcıya gösterilebilecek açıklama.</param>
/// <param name="Topics">Tazelenmesi gereken veri konuları.</param>
/// <param name="Data">Ek alanlar (id, route vb.).</param>
public sealed record RealtimeEvent(
    string Kind,
    string? Title = null,
    string? Message = null,
    IReadOnlyCollection<string>? Topics = null,
    IReadOnlyDictionary<string, string>? Data = null);

/// <summary>Bilinen konular — istemci ile sunucu arasındaki sözleşme tek yerde dursun.</summary>
public static class RealtimeTopics
{
    public const string Approvals = "approvals";
    public const string Adisyon = "adisyon";
    public const string Sessions = "sessions";
    public const string Appointments = "appointments";
    public const string Accounts = "accounts";
    public const string Notifications = "notifications";
}

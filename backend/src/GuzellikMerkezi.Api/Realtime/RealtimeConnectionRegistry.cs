using System.Collections.Concurrent;

namespace GuzellikMerkezi.Api.Realtime;

/// <summary>
/// BU ÖRNEĞE bağlı canlı hub oturumlarının kaydı.
///
/// <para>
/// Neden gerekli: hub yetkisi YALNIZ bağlantı kurulurken doğrulanıyordu. WebSocket açık kaldığı
/// sürece token bir daha kontrol edilmediği için parola sıfırlama, hesap kapatma, şube değişimi
/// ya da yetki geri alma AÇIK SOKETİ hiç etkilemiyordu: iptal edilmiş bir oturum, kurum grubuna
/// üye kalmaya ve olay akışını (hangi konu ne zaman değişti) izlemeye devam ediyordu — HTTP
/// tarafında aynı token'ın çoktan reddedildiği bir anda.
/// </para>
/// <para>
/// Her bağlantı TAM OLARAK BİR sunucu örneğinde yaşar; dolayısıyla her örnek yalnız kendi
/// bağlantılarını tutar ve yalnız onları koparabilir. Çok örnekli kurulumda bile kapsam eksiksizdir
/// (bkz. <c>RealtimeSessionSentinel</c>), backplane'e ihtiyaç duyulmaz.
/// </para>
/// </summary>
public sealed class RealtimeConnectionRegistry
{
    private readonly ConcurrentDictionary<string, LiveConnection> _connections = new(StringComparer.Ordinal);

    public void Add(LiveConnection connection) => _connections[connection.ConnectionId] = connection;

    public void Remove(string connectionId) => _connections.TryRemove(connectionId, out _);

    public int Count => _connections.Count;

    /// <summary>Anlık görüntü — tarama sırasında sözlük değişebilir, kopya üzerinde çalışılır.</summary>
    public IReadOnlyList<LiveConnection> Snapshot() => _connections.Values.ToArray();

    /// <param name="TokenIssuedAtUtc">
    /// Token'ın <c>iat</c> değeri. <c>null</c> ise damga karşılaştırması ATLANIR — HTTP tarafındaki
    /// <c>OnTokenValidated</c> ile birebir aynı davranış (iat'siz eski token'lar kabul edilir).
    /// </param>
    /// <param name="IsCustomer">
    /// Müşteri portalı oturumu: <c>tenant_users</c> karşılığı yoktur, damga kuralı uygulanmaz.
    /// </param>
    /// <param name="Abort">Bağlantıyı koparan işlem (<c>HubCallerContext.Abort</c>).</param>
    public sealed record LiveConnection(
        string ConnectionId,
        Guid UserId,
        DateTime? TokenIssuedAtUtc,
        bool IsCustomer,
        Action Abort);
}

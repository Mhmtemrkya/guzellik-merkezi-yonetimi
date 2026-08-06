using GuzellikMerkezi.Api.Realtime;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// AÇIK HUB OTURUMLARININ YETKİSİNİ TEKRAR TEKRAR DOĞRULAR.
///
/// <para>
/// Hub yetkisi yalnız bağlantı kurulurken kontrol ediliyordu: WebSocket bir kez açıldıktan sonra
/// token bir daha doğrulanmadığı için parola sıfırlama, hesap kapatma, personeli pasife alma,
/// şube taşıma ve yetki geri alma açık soketi hiç etkilemiyordu. HTTP tarafında aynı token
/// <c>OnTokenValidated</c>'da reddedilirken, aynı kullanıcı kurum grubundan olay akışını
/// izlemeye devam edebiliyordu.
/// </para>
/// <para>
/// KURAL HTTP İLE AYNI: token'ın üretim anı (<c>iat</c>) kullanıcının <c>SecurityStampUtc</c>
/// damgasından eskiyse oturum geçersizdir. Damga, "bu kullanıcının tüm oturumlarını düşür" diyen
/// TEK primitif tarafından ileri alınır (<c>SessionRevocation.RevokeAllAsync</c>), dolayısıyla
/// parola/yetki/şube/pasifleştirme değişimlerinin hepsi bu kontrole düşer. Kullanıcının kaydı
/// silinmiş ya da pasifse de bağlantı koparılır.
/// </para>
/// <para>
/// KAPSAM EKSİKSİZ: her bağlantı tam olarak bir sunucu örneğinde yaşar ve o örnek kendi kaydını
/// tarar. Kopan istemci yeniden bağlanmayı dener; negotiate isteği aynı (artık geçersiz) token'la
/// geldiği için 401 alır ve normal token yenileme akışına düşer.
/// </para>
/// </summary>
public sealed class RealtimeSessionSentinel : BackgroundService
{
    /// <summary>
    /// Tarama sıklığı = iptalin en geç ne kadar gecikeceği. HTTP tarafındaki damga önbelleği de
    /// 30 saniyedir; iki yolun penceresi bilerek aynı tutulur.
    /// </summary>
    private static readonly TimeSpan SweepInterval = TimeSpan.FromSeconds(30);

    private readonly RealtimeConnectionRegistry _registry;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RealtimeSessionSentinel> _logger;

    public RealtimeSessionSentinel(
        RealtimeConnectionRegistry registry,
        IServiceScopeFactory scopeFactory,
        ILogger<RealtimeSessionSentinel> logger)
    {
        _registry = registry;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(SweepInterval);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
                await SweepAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                // Tarama başarısız olsa bile servis durmaz; bir sonraki turda tekrar denenir.
                _logger.LogWarning(ex, "Anlık kanal oturum taraması tamamlanamadı.");
            }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        var connections = _registry.Snapshot();
        if (connections.Count == 0) return;

        // Müşteri portalı oturumlarının tenant_users karşılığı yoktur; HTTP tarafında da bu kural
        // uygulanmaz (bkz. OnTokenValidated) — kapsam dışı bırakılır.
        var userIds = connections.Where(c => !c.IsCustomer).Select(c => c.UserId).Distinct().ToList();
        if (userIds.Count == 0) return;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();

        // TEK TEK SORGULANIR. Guid listesiyle sunucu tarafı `IN (...)` bu sağlayıcıda çevrilemiyor
        // (parametreye tip eşlemesi atanamıyor → çalışma anında hata). Bağlantı sayısı örnek başına
        // küçük ve sorgu birincil anahtar üzerinden olduğu için maliyet ihmal edilebilir.
        var states = new Dictionary<Guid, UserState?>();
        foreach (var userId in userIds)
        {
            var snapshot = await db.TenantUsers.AsNoTracking().IgnoreQueryFilters()
                .Where(u => u.Id == userId)
                .Select(u => new UserState(u.IsActive, u.IsDeleted, u.SecurityStampUtc))
                .FirstOrDefaultAsync(ct);
            states[userId] = snapshot;
        }

        foreach (var connection in connections)
        {
            if (connection.IsCustomer) continue;
            if (!states.TryGetValue(connection.UserId, out var state)) continue;

            var reason = RevocationReason(state, connection.TokenIssuedAtUtc);
            if (reason is null) continue;

            _registry.Remove(connection.ConnectionId);
            try
            {
                connection.Abort();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Anlık kanal bağlantısı koparılamadı ({ConnectionId}).", connection.ConnectionId);
            }

            _logger.LogInformation(
                "Anlık kanal oturumu sonlandırıldı (kullanıcı {UserId}): {Reason}", connection.UserId, reason);
        }
    }

    /// <summary>
    /// Bağlantının koparılma sebebi; oturum hâlâ geçerliyse <c>null</c>.
    /// Damga karşılaştırması HTTP tarafıyla birebir aynıdır: <c>iat</c> yoksa fail-open.
    /// </summary>
    public static string? RevocationReason(UserState? state, DateTime? tokenIssuedAtUtc)
    {
        // KAYIT YOKSA HTTP İLE AYNI DAVRAN (fail-open). HTTP tarafındaki kontrol de satırı
        // bulamadığında isteği geçirir; burada koparsaydık istemci yeniden bağlanır, negotiate
        // HTTP kapısından geçer ve 30 saniye sonra yine kopardı — sonu gelmeyen bir döngü.
        if (state is null) return null;
        if (state.IsDeleted) return "kullanıcı silinmiş";
        if (!state.IsActive) return "kullanıcı pasif";
        if (tokenIssuedAtUtc is not { } issuedAtUtc) return null;
        if (state.SecurityStampUtc is not { } invalidatedAt) return null;
        return issuedAtUtc < DateTime.SpecifyKind(invalidatedAt, DateTimeKind.Utc)
            ? $"oturum damgası ileri alınmış ({invalidatedAt:O})"
            : null;
    }

    public sealed record UserState(bool IsActive, bool IsDeleted, DateTime? SecurityStampUtc);
}

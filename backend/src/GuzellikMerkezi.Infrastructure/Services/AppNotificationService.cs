using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// <see cref="IAppNotificationService"/> uygulaması. Yayın metotları ÇAĞIRANIN unit-of-work'ünü etkilememek
/// ve akışını asla bozmamak için AYRI bir scope (dolayısıyla ayrı DbContext) açar; tüm gövde try/catch'lidir.
/// Tüketim metotları endpoint'ten gelen scoped DbContext'i (tenant bağlamı dolu) kullanır.
/// </summary>
public sealed class AppNotificationService : IAppNotificationService
{
    private const int MaxFeedItems = 100;

    private readonly GuzellikDbContext _db;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IPushSender _push;
    private readonly IDurableJobQueue _jobs;
    private readonly IDateTimeProvider _clock;
    private readonly IRealtimeNotifier _realtime;
    private readonly ILogger<AppNotificationService> _logger;

    public AppNotificationService(
        GuzellikDbContext db,
        IServiceScopeFactory scopeFactory,
        IPushSender push,
        IDurableJobQueue jobs,
        IDateTimeProvider clock,
        IRealtimeNotifier realtime,
        ILogger<AppNotificationService> logger)
    {
        _db = db;
        _scopeFactory = scopeFactory;
        _push = push;
        _jobs = jobs;
        _clock = clock;
        _realtime = realtime;
        _logger = logger;
    }

    // ----------------------------------------------------------------- Yayın

    public Task NotifyUserAsync(
        Guid tenantId, Guid? branchId, Guid recipientUserId,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string body, object? data = null, string? dedupeKey = null, CancellationToken ct = default)
        => PublishAsync(tenantId, branchId, new[] { recipientUserId }, type, severity, title, body, data, dedupeKey, ct);

    public async Task NotifyRolesAsync(
        Guid tenantId, Guid? branchId, IReadOnlyCollection<UserRole> roles,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string body, object? data = null, string? dedupeKey = null, bool branchScoped = true, CancellationToken ct = default)
    {
        try
        {
            using var lease = LeaseContext();
            var db = lease.Db;

            var candidates = await db.TenantUsers
                .IgnoreQueryFilters()
                .Where(u => u.TenantId == tenantId && !u.IsDeleted && u.IsActive)
                .Select(u => new { u.Id, u.Role, u.BranchId })
                .ToListAsync(ct);

            var recipients = candidates
                .Where(u => roles.Contains(u.Role))
                .Where(u => IsInScope(u.Role, u.BranchId, branchId, branchScoped))
                .Select(u => u.Id)
                .Distinct()
                .ToList();

            if (recipients.Count == 0) return;
            await PublishInScopeAsync(db, tenantId, branchId, recipients, type, severity, title, body, data, dedupeKey, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Rol bazlı bildirim üretilemedi ({Type}).", type);
        }
    }

    /// <summary>
    /// Rol bazlı bildirimin ŞUBE KAPSAMI. Ölçüt OLAYIN şubesidir; kurum geneli (şubesiz) olay
    /// herkese, şubeli olay yalnız o şubenin kullanıcılarına gider. Kurum yöneticisi her zaman alır.
    /// <para>
    /// Eski kural KULLANICININ şubesizliğine bakıyor ve onu "kurum geneli yetki" sayıyordu: şubesi
    /// atanmamış bir ŞUBE YÖNETİCİSİ tüm şubelerin bildirimlerini (onay detayı, müşteri/personel
    /// adı, kasa kapanışı, WhatsApp yanıtı) alıyordu. Artık şubesiz kullanıcı hiçbir ŞUBEYE ait
    /// olayı almaz — yetkilendirmenin fail-closed kuralıyla aynı hizada.
    /// </para>
    /// </summary>
    private static bool IsInScope(UserRole role, Guid? userBranchId, Guid? eventBranchId, bool branchScoped)
    {
        if (!branchScoped) return true;
        if (role == UserRole.InstitutionOwner) return true;
        if (eventBranchId is null) return true;    // kurum geneli olay → şubeli yöneticiler de görsün
        return userBranchId == eventBranchId;
    }

    private async Task PublishAsync(
        Guid tenantId, Guid? branchId, IReadOnlyList<Guid> recipientIds,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string body, object? data, string? dedupeKey, CancellationToken ct)
    {
        try
        {
            using var lease = LeaseContext();
            await PublishInScopeAsync(lease.Db, tenantId, branchId, recipientIds, type, severity, title, body, data, dedupeKey, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bildirim üretilemedi ({Type}).", type);
        }
    }

    /// <summary>
    /// BİLDİRİM HANGİ İŞLEM BİRİMİNE YAZILIR? (M8)
    ///
    /// <para>
    /// Yayın normalde AYRI bir scope (ayrı DbContext, ayrı bağlantı) kullanır: çağıranın
    /// unit-of-work'ünü kirletmemek ve bildirim hatasının asıl akışı düşürmemesi için. Ama çağıran
    /// AÇIK BİR TRANSACTION içindeyse bu ayrım zarar veriyordu: bildirim ayrı bağlantıdan hemen
    /// commit ediliyor, asıl işlem sonradan GERİ ALINSA bile kalıcı kalıyordu. Kullanıcı
    /// "randevunuz tamamlandı" bildirimi alıyor, randevu ise hiç değişmemiş oluyordu.
    /// </para>
    /// <para>
    /// Açık transaction varsa ÇAĞIRANIN bağlamına katılırız: bildirim asıl işlemle birlikte kalıcı
    /// olur ya da onunla birlikte geri alınır. Yoksa eski davranış (ayrı scope) sürer.
    /// </para>
    /// </summary>
    private ContextLease LeaseContext()
    {
        if (_db.Database.CurrentTransaction is not null) return new ContextLease(_db, null);
        var scope = _scopeFactory.CreateScope();
        return new ContextLease(scope.ServiceProvider.GetRequiredService<GuzellikDbContext>(), scope);
    }

    /// <summary>Ödünç alınan bağlam; yalnız KENDİ açtığı scope'u kapatır.</summary>
    private readonly struct ContextLease : IDisposable
    {
        public ContextLease(GuzellikDbContext db, IServiceScope? scope) { Db = db; _scope = scope; }
        private readonly IServiceScope? _scope;
        public GuzellikDbContext Db { get; }
        public void Dispose() => _scope?.Dispose();
    }

    private async Task PublishInScopeAsync(
        GuzellikDbContext db, Guid tenantId, Guid? branchId, IReadOnlyList<Guid> recipientIds,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string body, object? data, string? dedupeKey, CancellationToken ct)
    {
        var targets = recipientIds.Where(id => id != Guid.Empty).Distinct().ToList();
        if (targets.Count == 0) return;

        // Dedupe: DedupeKey düz metin (şifresiz) olduğundan eşitlikle sorgulanabilir.
        if (!string.IsNullOrWhiteSpace(dedupeKey))
        {
            var already = await db.AppNotifications
                .IgnoreQueryFilters()
                .Where(n => n.TenantId == tenantId && n.DedupeKey == dedupeKey)
                .Select(n => n.RecipientUserId)
                .ToListAsync(ct);
            targets = targets.Where(id => !already.Contains(id)).ToList();
            if (targets.Count == 0) return;
        }

        var dataJson = data is null ? null : JsonSerializer.Serialize(data);
        var rows = targets
            .Select(id => new AppNotification(tenantId, branchId, id, type, severity, title, body, dataJson, dedupeKey))
            .ToList();

        // YAZMA, TEKİLLEŞTİRMENİN ZORLANDIĞI YERDİR (M5).
        //
        // Yukarıdaki "önce sor" kontrolü tek instance'ta yeterliydi; iki backend örneği ya da iki
        // eşzamanlı çağrı aynı anda "yok" görüp İKİ bildirim yazabiliyordu. Artık benzersiz indeks
        // (TenantId, RecipientUserId, DedupeKey) ikinciyi eler ve çakışma HATA DEĞİL, "zaten
        // gönderilmiş" anlamına gelir. Toplu yazma çakışırsa satır satır yeniden denenir:
        // çakışmayan alıcılar bildirimini alsın, çakışan sessizce atlansın.
        db.AppNotifications.AddRange(rows);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            foreach (var row in rows) db.Entry(row).State = EntityState.Detached;
            targets = await InsertOneByOneAsync(db, rows, ct);
            if (targets.Count == 0) return;
        }

        // Satır yazıldıktan SONRA anlık haber ver: alıcı o an ekrandaysa zil sayacı ve akış
        // yoklamayı beklemeden güncellenir. Ulaşmazsa kayıp yok — satır veritabanında duruyor.
        //
        // COMMIT EDİLMEMİŞ İÇERİK YAYINLANMAZ.
        //
        // Açık bir transaction içindeyken (çağıranın bağlamına katıldık, bkz. LeaseContext) satır
        // HENÜZ KALICI DEĞİLDİR. Yük başlık ve gövde taşıdığı için, transaction sonradan geri
        // alındığında kullanıcı ekranında "ödemeniz alındı / işleminiz onaylandı" yazan bir
        // bildirim kalıyordu — karşılığı olmayan bir olayın metni. Anlık olay bu durumda İÇERİKSİZ
        // gider: yalnız "bu konuyu tazele" der. İstemci veriyi HTTP'den okur; işlem geri alınmışsa
        // görecek bir şey bulamaz, sonuç en fazla bir fazladan tazelemedir.
        var committed = db.Database.CurrentTransaction is null;
        foreach (var recipient in targets)
        {
            await _realtime.PublishToUserAsync(tenantId, recipient, new RealtimeEvent(
                "notification",
                committed ? title : null,
                committed ? body : null,
                new[] { RealtimeTopics.Notifications },
                new Dictionary<string, string> { ["type"] = type.ToString() }), ct);
        }

        await TrySendPushAsync(db, tenantId, targets, type, severity, title, body, data, ct);
    }

    /// <summary>
    /// Toplu yazma benzersiz indekse takıldığında satır satır yazar; GERÇEKTEN yazılan alıcıları
    /// döner. Çakışan satır "zaten gönderilmiş" demektir — hata değildir, atlanır.
    /// </summary>
    private static async Task<List<Guid>> InsertOneByOneAsync(
        GuzellikDbContext db, IReadOnlyList<AppNotification> rows, CancellationToken ct)
    {
        var written = new List<Guid>();
        foreach (var row in rows)
        {
            db.AppNotifications.Add(row);
            try
            {
                await db.SaveChangesAsync(ct);
                written.Add(row.RecipientUserId);
            }
            catch (DbUpdateException)
            {
                db.Entry(row).State = EntityState.Detached;
            }
        }
        return written;
    }

    private async Task TrySendPushAsync(
        GuzellikDbContext db, Guid tenantId, IReadOnlyCollection<Guid> recipientIds,
        AppNotificationType type, AppNotificationSeverity severity, string title, string body, object? data, CancellationToken ct)
    {
        try
        {
            // Küçük ölçek: kurumun tüm token'larını çekip alıcı kümesine göre bellekte süz
            // (MySql sağlayıcısı Guid listesi .Contains() sunucuda çeviremiyor).
            var recipientSet = recipientIds.ToHashSet();
            var tokens = (await db.DeviceNotificationTokens
                    .IgnoreQueryFilters()
                    .Where(t => t.TenantId == tenantId)
                    .Select(t => new { t.TenantUserId, t.Token })
                    .ToListAsync(ct))
                .Where(t => recipientSet.Contains(t.TenantUserId))
                .Select(t => t.Token)
                .Distinct()
                .ToList();

            if (tokens.Count == 0) return;

            var payload = new Dictionary<string, string>
            {
                ["type"] = ((int)type).ToString(),
                ["severity"] = ((int)severity).ToString(),
            };
            if (data is not null)
            {
                // route/id gibi düz alanları data payload'ına string olarak ekle (mobil deep-link).
                foreach (var kv in Flatten(data))
                    payload[kv.Key] = kv.Value;
            }

            var messages = tokens
                .Select(tk => new PushMessage(tk, title, body, payload))
                .ToList();
            // FCM push'u (yapılandırıldığında token başına HTTP) KALICI kuyruğa yaz → bildirim üretimi
            // (ve onu bekleyen kasa/randevu isteği) push için beklemez; restart'ta iş kaybolmaz.
            await _jobs.EnqueueAsync(Background.DurableJobTypes.PushSend, new Background.PushSendJob(messages), ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Push gönderimi atlandı.");
        }
    }

    private static IEnumerable<KeyValuePair<string, string>> Flatten(object data)
    {
        var json = JsonSerializer.SerializeToElement(data);
        if (json.ValueKind != JsonValueKind.Object) yield break;
        foreach (var prop in json.EnumerateObject())
        {
            var value = prop.Value.ValueKind switch
            {
                JsonValueKind.String => prop.Value.GetString() ?? string.Empty,
                JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                _ => prop.Value.ToString(),
            };
            yield return new KeyValuePair<string, string>(prop.Name, value);
        }
    }

    // ----------------------------------------------------------------- Tüketim

    public async Task<Result<AppNotificationFeedDto>> GetFeedAsync(
        Guid tenantId, Guid userId, DateTime? sinceUtc, bool unreadOnly, int take, CancellationToken ct = default)
    {
        var limit = take <= 0 ? 30 : Math.Min(take, MaxFeedItems);
        var now = _clock.UtcNow;

        var query = _db.AppNotifications
            .AsNoTracking()
            .Where(n => n.TenantId == tenantId && n.RecipientUserId == userId);
        if (sinceUtc.HasValue) query = query.Where(n => n.CreatedAtUtc > sinceUtc.Value);
        if (unreadOnly) query = query.Where(n => !n.IsRead);

        var items = await query
            .OrderByDescending(n => n.CreatedAtUtc)
            .Take(limit)
            .Select(n => new AppNotificationDto(
                n.Id, n.Type, n.Severity, n.Title, n.Body, n.DataJson, n.IsRead, n.CreatedAtUtc))
            .ToListAsync(ct);

        var unread = await _db.AppNotifications
            .Where(n => n.TenantId == tenantId && n.RecipientUserId == userId && !n.IsRead)
            .CountAsync(ct);

        return Result<AppNotificationFeedDto>.Success(new AppNotificationFeedDto(items, unread, now));
    }

    public async Task<Result> MarkReadAsync(Guid tenantId, Guid userId, Guid notificationId, CancellationToken ct = default)
    {
        var row = await _db.AppNotifications
            .FirstOrDefaultAsync(n => n.Id == notificationId && n.TenantId == tenantId && n.RecipientUserId == userId, ct);
        if (row is null) return Result.Failure(Error.NotFound("Bildirim bulunamadı."));
        row.MarkRead(_clock.UtcNow);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> MarkAllReadAsync(Guid tenantId, Guid userId, CancellationToken ct = default)
    {
        var rows = await _db.AppNotifications
            .Where(n => n.TenantId == tenantId && n.RecipientUserId == userId && !n.IsRead)
            .ToListAsync(ct);
        if (rows.Count == 0) return Result.Success();
        var now = _clock.UtcNow;
        foreach (var r in rows) r.MarkRead(now);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> RegisterDeviceTokenAsync(Guid tenantId, Guid userId, RegisterDeviceTokenRequest req, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId) || string.IsNullOrWhiteSpace(req.Token))
            return Result.Failure(Error.Validation("Cihaz kimliği ve token gerekli."));

        var now = _clock.UtcNow;
        var existing = await _db.DeviceNotificationTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.TenantUserId == userId && t.DeviceId == req.DeviceId, ct);

        if (existing is null)
        {
            // Aynı token başka kullanıcı/cihazda kayıtlıysa (cihaz el değiştirdi) eskisini temizle.
            var stale = await _db.DeviceNotificationTokens
                .IgnoreQueryFilters()
                .Where(t => t.Token == req.Token && t.TenantUserId != userId)
                .ToListAsync(ct);
            if (stale.Count > 0) _db.DeviceNotificationTokens.RemoveRange(stale);

            _db.DeviceNotificationTokens.Add(new DeviceNotificationToken(tenantId, userId, req.DeviceId, req.Token, req.Platform, now));
        }
        else
        {
            existing.Update(req.Token, req.Platform, now);
        }

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> UnregisterDeviceTokenAsync(Guid tenantId, Guid userId, string deviceId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return Result.Success();
        var rows = await _db.DeviceNotificationTokens
            .IgnoreQueryFilters()
            .Where(t => t.TenantUserId == userId && t.DeviceId == deviceId)
            .ToListAsync(ct);
        if (rows.Count == 0) return Result.Success();
        _db.DeviceNotificationTokens.RemoveRange(rows);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

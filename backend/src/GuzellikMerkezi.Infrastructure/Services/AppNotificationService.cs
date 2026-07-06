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
    private readonly ILogger<AppNotificationService> _logger;

    public AppNotificationService(
        GuzellikDbContext db,
        IServiceScopeFactory scopeFactory,
        IPushSender push,
        IDurableJobQueue jobs,
        IDateTimeProvider clock,
        ILogger<AppNotificationService> logger)
    {
        _db = db;
        _scopeFactory = scopeFactory;
        _push = push;
        _jobs = jobs;
        _clock = clock;
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
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();

            var candidates = await db.TenantUsers
                .IgnoreQueryFilters()
                .Where(u => u.TenantId == tenantId && !u.IsDeleted && u.IsActive)
                .Select(u => new { u.Id, u.Role, u.BranchId })
                .ToListAsync(ct);

            var recipients = candidates
                .Where(u => roles.Contains(u.Role))
                .Where(u => !branchScoped || branchId is null || u.BranchId is null || u.BranchId == branchId)
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

    private async Task PublishAsync(
        Guid tenantId, Guid? branchId, IReadOnlyList<Guid> recipientIds,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string body, object? data, string? dedupeKey, CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            await PublishInScopeAsync(db, tenantId, branchId, recipientIds, type, severity, title, body, data, dedupeKey, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bildirim üretilemedi ({Type}).", type);
        }
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
        db.AppNotifications.AddRange(rows);
        await db.SaveChangesAsync(ct);

        await TrySendPushAsync(db, tenantId, targets, type, severity, title, body, data, ct);
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

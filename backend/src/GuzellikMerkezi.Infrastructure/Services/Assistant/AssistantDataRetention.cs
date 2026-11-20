using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Maydi sohbet kayıtlarının saklama ve silme kuralları (KVKK):
/// <list type="bullet">
/// <item><b>Saklama</b>: <c>Assistant:RetentionDays</c> (varsayılan 90) günden eski mesaj ve sohbetler silinir.
/// Kayıtlar güvenlik amacıyla tutulur; süre dolunca geri getirilemez.</item>
/// <item><b>Hesap silme</b>: müşteri kendi hesabını silince o kullanıcının bütün Maydi kayıtları silinir
/// (App Store 5.1.1(v)). Kurum silinince tablolar <c>TenantPurge</c> ile zaten temizlenir.</item>
/// </list>
/// <para>
/// HAM SQL + partili (LIMIT): <c>ExecuteDeleteAsync</c> takma adlı DELETE üretiyor ve MariaDB bunu reddediyor
/// (bkz. AuditLogService.DeleteAllAsync); partili silme büyük tabloda satırları uzun süre kilitlemez.
/// İlişkisel olmayan sağlayıcıda (testler) aynı küme EF ile silinir.
/// </para>
/// </summary>
public sealed class AssistantDataRetention(GuzellikDbContext db, IConfiguration? configuration = null)
{
    public const int DefaultRetentionDays = 90;
    private const int BatchSize = 5000;

    public int RetentionDays => Math.Clamp(configuration?.GetValue("Assistant:RetentionDays", DefaultRetentionDays) ?? DefaultRetentionDays, 1, 3650);

    /// <summary>Süresi dolan mesaj ve sohbetleri siler; silinen satır sayısını döner.</summary>
    public async Task<int> PurgeExpiredAsync(DateTime utcNow, CancellationToken ct)
    {
        var cutoff = utcNow.AddDays(-RetentionDays);
        if (!db.Database.IsRelational())
        {
            var messages = await db.AssistantMessages.IgnoreQueryFilters().Where(x => x.CreatedAtUtc < cutoff).ToListAsync(ct);
            var conversations = await db.AssistantConversations.IgnoreQueryFilters().Where(x => x.LastMessageAtUtc < cutoff).ToListAsync(ct);
            db.AssistantMessages.RemoveRange(messages);
            db.AssistantConversations.RemoveRange(conversations);
            await db.SaveChangesAsync(ct);
            return messages.Count + conversations.Count;
        }

        // Mesajlar önce: son mesajı süreyi aşmış bir sohbetin bütün mesajları da süreyi aşmıştır.
        var deleted = await DeleteBatchesAsync("DELETE FROM `assistant_messages` WHERE `CreatedAtUtc` < {0} LIMIT " + BatchSize, [cutoff], ct);
        deleted += await DeleteBatchesAsync("DELETE FROM `assistant_conversations` WHERE `LastMessageAtUtc` < {0} LIMIT " + BatchSize, [cutoff], ct);
        return deleted;
    }

    /// <summary>Bir kullanıcının (kurum içinde) bütün Maydi sohbet ve mesajlarını siler.</summary>
    public async Task<int> DeleteUserDataAsync(Guid tenantId, Guid userId, CancellationToken ct)
    {
        if (!db.Database.IsRelational())
        {
            var messages = await db.AssistantMessages.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.UserId == userId).ToListAsync(ct);
            var conversations = await db.AssistantConversations.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.UserId == userId).ToListAsync(ct);
            db.AssistantMessages.RemoveRange(messages);
            db.AssistantConversations.RemoveRange(conversations);
            await db.SaveChangesAsync(ct);
            return messages.Count + conversations.Count;
        }

        object[] args = [tenantId.ToString(), userId.ToString()];
        var deleted = await DeleteBatchesAsync("DELETE FROM `assistant_messages` WHERE `TenantId` = {0} AND `UserId` = {1} LIMIT " + BatchSize, args, ct);
        deleted += await DeleteBatchesAsync("DELETE FROM `assistant_conversations` WHERE `TenantId` = {0} AND `UserId` = {1} LIMIT " + BatchSize, args, ct);
        return deleted;
    }

    private async Task<int> DeleteBatchesAsync(string sql, object[] args, CancellationToken ct)
    {
        var total = 0;
        while (true)
        {
            var removed = await db.Database.ExecuteSqlRawAsync(sql, args, ct);
            total += removed;
            if (removed < BatchSize) return total;
        }
    }
}

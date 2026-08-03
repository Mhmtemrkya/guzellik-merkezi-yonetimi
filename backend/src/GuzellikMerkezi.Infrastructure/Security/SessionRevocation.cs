using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Security;

/// <summary>
/// Bir kullanıcının TÜM oturumlarını kapatan tek primitif: oturum damgası ileri alınır
/// (eldeki access token'lar <c>OnTokenValidated</c>'da reddedilir) ve aktif refresh token'ların
/// hepsi iptal edilir.
///
/// <para>
/// Neden ortak: aynı mantık <c>AuthService</c> içinde özel bir metottu ve parola değişimi/sıfırlama
/// yollarında çağrılıyordu. Personeli PASİFLEŞTİRME yolu (StaffService) bunu hiç çağırmıyordu:
/// personel pasife alınsa bile giriş hesabı açık kalıyor, eldeki oturum çalışmaya devam ediyordu.
/// Tek primitife bağlamak, "erişimi kes" diyen her yolun gerçekten kesmesini garanti eder.
/// </para>
/// </summary>
public static class SessionRevocation
{
    public static async Task RevokeAllAsync(GuzellikDbContext db, Guid userId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var user = await db.TenantUsers.IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        user?.InvalidateSessions(nowUtc);

        // InMemory sağlayıcı ExecuteUpdate desteklemez → orada tek tek işaretlenir.
        if (!db.Database.IsRelational())
        {
            var tokens = await db.RefreshTokens
                .Where(t => t.TenantUserId == userId && t.RevokedAtUtc == null)
                .ToListAsync(cancellationToken);
            foreach (var token in tokens) token.Revoke(nowUtc);
            return;
        }

        await db.RefreshTokens
            .Where(t => t.TenantUserId == userId && t.RevokedAtUtc == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.RevokedAtUtc, nowUtc)
                .SetProperty(t => t.UpdatedAtUtc, nowUtc), cancellationToken);
    }
}

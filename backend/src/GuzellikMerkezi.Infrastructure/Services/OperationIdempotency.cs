using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// HTTP'YE UĞRAMAYAN mutasyonlar için "tam bir kez uygula" güvencesi.
///
/// <para>
/// <c>IdempotencyMiddleware</c> aynı işi istek yolunda yapar: anahtarı ÖNCE rezerve eder, sonucu
/// sonra yazar; sonuç kesinleşmeden biten denemede rezervasyonu SİLMEZ. Onay kapısındaki generic
/// dispatcher (tahsilat, gider, cari, stok…) servisleri doğrudan çağırdığı için o korumadan
/// geçmiyordu: işlem commit edildikten sonra bekleyen kayıt "Approved" yapılamadan süreç çökerse,
/// bayat sahiplenme zaman aşımıyla yeniden denenip AYNI hareketi ikinci kez oluşturuyordu
/// (çift tahsilat / çift stok hareketi). Bu yardımcı aynı tabloyu ve aynı protokolü kullanır.
/// </para>
///
/// <para>
/// KAPSAM KURUMA BAĞLIDIR (<c>UserId = Guid.Empty</c>): onayı A yönetici başlatıp yanıt
/// kaybolduktan sonra B yönetici tekrar denerse koruma yine çalışsın. Anahtar da işlem kimliğinden
/// türetilir, denemeler arasında değişmez — bkz. <c>PendingOperationService.ReplayIdempotencyKey</c>.
/// </para>
/// </summary>
public static class OperationIdempotency
{
    /// <summary>Sistem anahtarlarının kapsamı kullanıcı değil KURUMDUR (bkz. IdempotencyMiddleware).</summary>
    private static readonly Guid SystemScope = Guid.Empty;

    public enum ClaimKind
    {
        /// <summary>Anahtar bu çağrıda rezerve edildi — işi YAP.</summary>
        Started,

        /// <summary>İş daha önce uygulandı ve sonucu saklandı — TEKRAR UYGULAMA.</summary>
        AlreadyApplied,

        /// <summary>Önceki deneme sürüyor ya da sonucu kesinleşmeden bitti — uygulanmış OLABİLİR.</summary>
        Unresolved,
    }

    /// <param name="ResultEntityId">Yalnız <see cref="ClaimKind.AlreadyApplied"/>'de dolu olabilir.</param>
    public readonly record struct Claim(ClaimKind Kind, Guid ReservationId, Guid? ResultEntityId);

    /// <summary>
    /// Anahtarı rezerve eder. Rezervasyon KALICI olarak yazılır (commit edilir) — asıl iş ancak
    /// ondan sonra yapılmalıdır; sıra tersine dönerse eşzamanlı/tekrar denemeler işi iki kez yapar.
    /// </summary>
    public static async Task<Claim> TryBeginAsync(
        GuzellikDbContext db, Guid tenantId, string key, string method, string path, CancellationToken ct)
    {
        var existing = await FindAsync(db, tenantId, key, ct);
        if (existing is not null) return Describe(existing);

        var reservation = new ProcessedClientRequest(tenantId, SystemScope, key, method, path, 0, null, null);
        db.ProcessedClientRequests.Add(reservation);
        try
        {
            await db.SaveChangesAsync(ct);
            return new Claim(ClaimKind.Started, reservation.Id, null);
        }
        catch (DbUpdateException)
        {
            // Yarışı kaybettik: benzersiz indeks (TenantId, UserId, IdempotencyKey) ikinci insert'i eledi.
            db.Entry(reservation).State = EntityState.Detached;
            var winner = await FindAsync(db, tenantId, key, ct);
            return winner is null
                ? new Claim(ClaimKind.Unresolved, Guid.Empty, null)
                : Describe(winner);
        }
    }

    private static Task<ProcessedClientRequest?> FindAsync(GuzellikDbContext db, Guid tenantId, string key, CancellationToken ct) =>
        db.ProcessedClientRequests.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == SystemScope && x.IdempotencyKey == key, ct);

    private static Claim Describe(ProcessedClientRequest row) =>
        row.IsPending
            ? new Claim(ClaimKind.Unresolved, row.Id, null)
            : new Claim(ClaimKind.AlreadyApplied, row.Id,
                Guid.TryParse(row.ResponseBody, out var resultId) ? resultId : null);

    /// <summary>
    /// Rezervasyonu sonuçla tamamlar; kaydın kalıcı olup olmadığını döner. Sonuç kimliği düz metin
    /// olarak saklanır — tekrar denemede aynı kimlik döner ve bekleyen işlem doğru varlığa bağlanır.
    /// <para>
    /// HAM SQL (ilişkiselde): değişiklik izleyicisine dokunmaz. Bu noktada izleyicide dispatcher'ın
    /// varlıkları duruyor olabilir ve <c>SaveChanges</c> onları da yazardı.
    /// </para>
    /// </summary>
    public static async Task<bool> CompleteAsync(GuzellikDbContext db, Guid reservationId, Guid? resultEntityId)
    {
        try
        {
            if (db.Database.IsRelational())
            {
                var affected = await db.Database.ExecuteSqlRawAsync(
                    "UPDATE processed_client_requests SET StatusCode = 200, ResponseBody = {0}, UpdatedAtUtc = {1} "
                    + "WHERE Id = {2} AND StatusCode = 0",
                    new object?[] { resultEntityId?.ToString(), DateTime.UtcNow, reservationId.ToString() }!,
                    CancellationToken.None);
                return affected > 0;
            }

            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null || !row.IsPending) return false;
            row.Complete(200, null, resultEntityId?.ToString());
            await db.SaveChangesAsync(CancellationToken.None);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Sonucu belirsiz kalan rezervasyonu DAMGALAR (silmez): tekrar denemeler "uygulanmış olabilir"
    /// muamelesi görür. Aynı desen: <c>IdempotencyMiddleware.MarkOutcomeUnknownAsync</c>.
    /// </summary>
    public static async Task MarkOutcomeUnknownAsync(GuzellikDbContext db, Guid reservationId)
    {
        try
        {
            if (db.Database.IsRelational())
            {
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE processed_client_requests SET UpdatedAtUtc = {0} WHERE Id = {1} AND StatusCode = 0",
                    new object[] { DateTime.UtcNow, reservationId.ToString() }, CancellationToken.None);
                return;
            }

            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null || !row.IsPending) return;
            row.Touch();
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch
        {
            // Damgalanamadıysa kayıt yine duruyor; tekrar "çözülmemiş" sayılır — güvenli taraf.
        }
    }

    /// <summary>
    /// KESİN reddedilen (hiçbir şey uygulanmayan) denemenin rezervasyonunu GERÇEKTEN siler; anahtar
    /// dürüst bir tekrar denemesine açık kalır. Soft-delete yetmez: satır tabloda kalır ve benzersiz
    /// indeks tekrarı kalıcı olarak bloklardı. <c>ExecuteDeleteAsync</c> DEĞİL — ürettiği takma adlı
    /// DELETE'i canlı MariaDB reddediyor (kodda yerleşik tuzak).
    /// </summary>
    public static async Task ReleaseAsync(GuzellikDbContext db, Guid reservationId)
    {
        try
        {
            if (db.Database.IsRelational())
            {
                await db.Database.ExecuteSqlRawAsync(
                    "DELETE FROM processed_client_requests WHERE Id = {0} AND StatusCode = 0",
                    new object[] { reservationId.ToString() }, CancellationToken.None);
                return;
            }

            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null || !row.IsPending) return;
            db.ProcessedClientRequests.Remove(row);
            db.HardDeleteEnabled = true;
            try { await db.SaveChangesAsync(CancellationToken.None); }
            finally { db.HardDeleteEnabled = false; }
        }
        catch
        {
            // En kötü durumda satır "çözülmemiş" kalır; yalnız o anahtarın tekrarını bloklar.
        }
    }

    /// <summary>
    /// ELLE ÇÖZÜM (dead-letter çıkışı). Sonucu belirsiz kalan bir rezervasyon otomatik olarak
    /// ÇÖZÜLEMEZ: sistem hedefin commit edip etmediğini bilemez, bu yüzden her tekrar denemesi
    /// sonsuza dek "uygulanmış olabilir" der ve işlem takılı kalır. Çıkış yolu bir İNSAN kararıdır:
    /// yetkili kaydı kontrol eder ve gerçeği bildirir.
    /// <para>
    /// <paramref name="applied"/> = true → anahtar TAMAMLANMIŞ damgalanır; sonraki denemeler işi
    /// tekrarlamaz. false → rezervasyon silinir ve işlem dürüst bir tekrara açılır.
    /// </para>
    /// <para>
    /// ÇELİŞKİ KORUMASI: kayıt zaten "uygulandı" diyorsa (StatusCode &lt;&gt; 0) ve yetkili
    /// "uygulanmadı" derse <c>false</c> döner — defter insandan daha güvenilirdir; anahtarı silip
    /// işi ikinci kez uygulatmak muhasebeyi bozardı.
    /// </para>
    /// </summary>
    /// <returns>Çözüm uygulanabildiyse true; defterle çelişiyorsa false.</returns>
    public static async Task<bool> ResolveUnknownAsync(
        GuzellikDbContext db, Guid tenantId, string key, bool applied, CancellationToken ct)
    {
        var row = await FindAsync(db, tenantId, key, ct);
        // Hiç rezervasyon yok: HttpReplay isteği hedefe hiç ulaşmamış olabilir. Çözecek bir şey yok.
        if (row is null) return true;

        if (!row.IsPending) return applied;   // defter "uygulandı" diyor → yalnız bu karar geçerli

        if (applied)
        {
            await CompleteAsync(db, row.Id, null);
            return true;
        }

        await ReleaseAsync(db, row.Id);
        return true;
    }
}

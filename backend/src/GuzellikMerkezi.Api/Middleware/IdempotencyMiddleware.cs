using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Idempotent yazma desteği: <c>Idempotency-Key</c> header'ı taşıyan /api/admin yazma istekleri
/// bir kez işlenir; aynı anahtar (aynı kullanıcı) tekrar geldiğinde endpoint YENİDEN çalıştırılmaz,
/// ilk yanıt aynen döndürülür. Masaüstü çevrimdışı kuyruğu (outbox) bağlantı kesintisinde yarıda
/// kalan tekrar oynatmaların çift kayıt üretmemesi için bunu kullanır. Header'sız istekler etkilenmez.
/// ActivityAudit + onay kapısından ÖNCE (dışta) durur: tekrar oynatma kısa devre olduğunda
/// audit/taslak da mükerrer üretilmez; taze istekler normal akıştan geçer ve nihai yanıt saklanır.
/// </summary>
public sealed class IdempotencyMiddleware
{
    private readonly RequestDelegate _next;

    private static readonly string[] WriteMethods = { "POST", "PUT", "PATCH", "DELETE" };

    public IdempotencyMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext http, ICurrentUser currentUser, GuzellikDbContext db)
    {
        var key = http.Request.Headers["Idempotency-Key"].ToString().Trim();
        var path = http.Request.Path.Value ?? string.Empty;
        if (key.Length is 0 or > 64
            || !WriteMethods.Contains(http.Request.Method)
            || !path.StartsWith("/api/admin", StringComparison.OrdinalIgnoreCase)
            || currentUser.UserId is not Guid userId)
        {
            await _next(http);
            return;
        }

        var tenantId = currentUser.TenantId ?? Guid.Empty;

        // SİSTEM ANAHTARLARI KULLANICIYA DEĞİL İŞLEME BAĞLIDIR.
        // Onay replay'i "sys:" ön ekli, bekleyen işlem Id'sinden türetilmiş kararlı bir anahtar
        // gönderir. Normal anahtarlar (TenantId, UserId, Key) ile kapsanır; ama onayı A yönetici
        // başlatıp yanıt kaybolduktan sonra B yönetici tekrar denerse kullanıcı farklı olduğu için
        // koruma ıskalanır ve iş İKİNCİ KEZ uygulanırdı. Bu anahtarlarda kapsam kurum düzeyidir.
        var scopeUserId = key.StartsWith("sys:", StringComparison.Ordinal) ? Guid.Empty : userId;

        var existing = await db.ProcessedClientRequests.AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.TenantId == tenantId && x.UserId == scopeUserId && x.IdempotencyKey == key,
                http.RequestAborted);
        if (existing is not null)
        {
            await ReplayAsync(http, existing);
            return;
        }

        // ANAHTARI ÖNCE REZERVE ET. Kayıt eskiden yalnız iş BİTTİKTEN sonra ekleniyordu: aynı
        // anahtarla eşzamanlı gelen iki istek (çift tıklama, outbox'ın paralel oynatması, retry
        // ile orijinalin yarışması) yukarıdaki ön kontrolden BİRLİKTE geçip işi iki kez yapıyordu
        // — iki ayrı tahsilat/mutasyon. Unique indeks (TenantId, UserId, IdempotencyKey) ikinci
        // insert'i eler; böylece işi yalnızca bir istek yapar.
        var reservation = new ProcessedClientRequest(
            tenantId, scopeUserId, key, http.Request.Method, path, 0, null, null);
        db.ProcessedClientRequests.Add(reservation);
        try
        {
            await db.SaveChangesAsync(http.RequestAborted);
        }
        catch (DbUpdateException)
        {
            db.Entry(reservation).State = EntityState.Detached;

            // Yarışı kaybettik. İlk istek bittiyse onun yanıtını aynen döndür; hâlâ işliyorsa
            // istemciye "tekrar dene" de — işi ikinci kez YAPMA.
            var winner = await db.ProcessedClientRequests.AsNoTracking()
                .FirstOrDefaultAsync(
                    x => x.TenantId == tenantId && x.UserId == scopeUserId && x.IdempotencyKey == key,
                    http.RequestAborted);
            if (winner is not null && !winner.IsPending)
            {
                await ReplayAsync(http, winner);
                return;
            }

            http.Response.StatusCode = StatusCodes.Status409Conflict;
            http.Response.ContentType = "application/json; charset=utf-8";
            await http.Response.WriteAsync(
                "{\"success\":false,\"error\":{\"code\":\"IdempotencyInFlight\",\"message\":\"Aynı istek şu anda işleniyor. Lütfen birkaç saniye sonra tekrar deneyin.\"}}",
                http.RequestAborted);
            return;
        }

        // Yanıtı belleğe yakala: hem istemciye akıt hem (5xx değilse) rezervasyona yaz.
        var originalBody = http.Response.Body;
        await using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        var completed = false;
        try
        {
            await _next(http);

            buffer.Position = 0;
            string bodyText;
            using (var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true))
            {
                bodyText = await reader.ReadToEndAsync(http.RequestAborted);
            }
            buffer.Position = 0;
            await buffer.CopyToAsync(originalBody, http.RequestAborted);

            // 5xx saklanmaz: geçici sunucu hatası sonraki denemede gerçekten yeniden işlenebilmeli.
            // 2xx/4xx saklanır: iş kuralı reddi (409 vb.) da deterministik kalmalı.
            if (http.Response.StatusCode < 500)
            {
                await FinalizeAsync(db, reservation.Id,
                    http.Response.StatusCode, http.Response.ContentType, bodyText);
                completed = true;
            }
        }
        finally
        {
            http.Response.Body = originalBody;
            // Rezervasyon tamamlanmadıysa (5xx ya da istisna) SERBEST BIRAK: aksi halde anahtar
            // kalıcı olarak "işleniyor" durumunda kilitli kalır ve gerçek bir tekrar denemesi
            // sonsuza dek 409 alırdı.
            if (!completed) await ReleaseAsync(db, reservation.Id);
        }
    }

    private static async Task ReplayAsync(HttpContext http, ProcessedClientRequest record)
    {
        http.Response.StatusCode = record.StatusCode;
        http.Response.Headers["Idempotency-Replayed"] = "true";
        if (!string.IsNullOrEmpty(record.ContentType)) http.Response.ContentType = record.ContentType;
        if (!string.IsNullOrEmpty(record.ResponseBody))
            await http.Response.WriteAsync(record.ResponseBody, http.RequestAborted);
    }

    /// <summary>
    /// Rezervasyonu gerçek yanıtla tamamlar. Satır yeniden okunur: endpoint akışı bu istek
    /// sırasında <c>ChangeTracker</c>'ı temizlemiş olabilir ve izlenmeyen varlık üzerinden
    /// yapılan güncelleme sessizce kaydedilmezdi.
    /// </summary>
    private static async Task FinalizeAsync(GuzellikDbContext db, Guid reservationId, int statusCode, string? contentType, string? body)
    {
        try
        {
            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null) return;
            row.Complete(statusCode, contentType, body);
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch
        {
            // Yanıt zaten istemciye gitti; kayıt tutulamadıysa akışı bozma.
        }
    }

    /// <summary>
    /// Tamamlanmamış rezervasyonu GERÇEKTEN siler.
    /// <para>
    /// Soft-delete yetmez: satır tabloda kalır ve unique indeks (TenantId, UserId, IdempotencyKey)
    /// aynı anahtarla yapılacak DÜRÜST bir tekrar denemesini kalıcı olarak 409'a düşürürdü.
    /// <c>ExecuteDelete</c> değişiklik izleyicisine hiç dokunmaz — bu noktada izleyicide endpoint'in
    /// varlıkları duruyor olabilir ve global <c>HardDeleteEnabled</c> bayrağını açmak onları da
    /// gerçek silmeye çevirme riski taşırdı.
    /// </para>
    /// </summary>
    private static async Task ReleaseAsync(GuzellikDbContext db, Guid reservationId)
    {
        try
        {
            if (db.Database.IsRelational())
            {
                await db.ProcessedClientRequests
                    .Where(x => x.Id == reservationId && x.StatusCode == 0)
                    .ExecuteDeleteAsync(CancellationToken.None);
                return;
            }

            // InMemory (birim testleri): ExecuteDelete yok → izleyici üzerinden gerçek silme.
            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null || !row.IsPending) return;
            db.ProcessedClientRequests.Remove(row);
            db.HardDeleteEnabled = true;
            try { await db.SaveChangesAsync(CancellationToken.None); }
            finally { db.HardDeleteEnabled = false; }
        }
        catch
        {
            // En kötü durumda satır "işleniyor" kalır; bu yalnız o anahtarın tekrarını bloklar,
            // veri bütünlüğünü bozmaz.
        }
    }
}

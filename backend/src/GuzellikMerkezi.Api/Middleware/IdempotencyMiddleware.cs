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

        var existing = await db.ProcessedClientRequests.AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.TenantId == tenantId && x.UserId == userId && x.IdempotencyKey == key,
                http.RequestAborted);
        if (existing is not null)
        {
            http.Response.StatusCode = existing.StatusCode;
            http.Response.Headers["Idempotency-Replayed"] = "true";
            if (!string.IsNullOrEmpty(existing.ContentType)) http.Response.ContentType = existing.ContentType;
            if (!string.IsNullOrEmpty(existing.ResponseBody))
                await http.Response.WriteAsync(existing.ResponseBody, http.RequestAborted);
            return;
        }

        // Yanıtı belleğe yakala: hem istemciye akıt hem (5xx değilse) idempotency kaydına yaz.
        var originalBody = http.Response.Body;
        await using var buffer = new MemoryStream();
        http.Response.Body = buffer;
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
                try
                {
                    db.ProcessedClientRequests.Add(new ProcessedClientRequest(
                        tenantId, userId, key, http.Request.Method, path,
                        http.Response.StatusCode, http.Response.ContentType, bodyText));
                    await db.SaveChangesAsync(CancellationToken.None);
                }
                catch
                {
                    // Unique yarışı (aynı anahtar eşzamanlı) vb. — yanıt zaten istemciye gitti.
                }
            }
        }
        finally
        {
            http.Response.Body = originalBody;
        }
    }
}

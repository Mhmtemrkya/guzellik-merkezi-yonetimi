using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>Bağlayıcı anahtarı: yapılandırmadan (<c>Connector:Keys:&lt;id&gt;:Secret</c>, <c>:Scopes</c>).</summary>
public sealed record ConnectorKey(string Id, string Secret, IReadOnlySet<string> Scopes)
{
    public bool Allows(string scope) => Scopes.Contains("*") || Scopes.Contains(scope);
}

/// <summary>
/// Maydanoz kontrol merkezinin bu Asist'e girdiği TEK kapı: <c>/api/connector/v1/*</c>.
/// <para>
/// JWT kullanılmaz; her istek HMAC-SHA256 ile imzalıdır (bkz. <see cref="ConnectorSignature"/>):
/// bilinen anahtar, ±5 dk zaman damgası, tek kullanımlık nonce (veritabanında benzersiz),
/// ham gövde özeti, sabit zamanlı karşılaştırma. Anahtar yapılandırılmamışsa uç grubu tümüyle
/// kapalıdır (404) — açık bırakılmış bir kapı yoktur. Başarılı istek platform yöneticisi
/// kapsamında çalışır (kullanıcı kararı 17 Kas 2026: platform panelinin her bölümü Maydanoz'dan
/// yönetilir); her uç ayrıca kendi kapsamını (<see cref="RequireConnectorScope"/>) ister.
/// </para>
/// </summary>
public sealed class ConnectorAuthMiddleware(RequestDelegate next, ILogger<ConnectorAuthMiddleware> logger)
{
    public const string PathPrefix = "/api/connector";
    public const string KeyItem = "connector.key";
    private const int MaxBodyBytes = 1024 * 1024;

    public static IReadOnlyDictionary<string, ConnectorKey> LoadKeys(IConfiguration config)
    {
        var keys = new Dictionary<string, ConnectorKey>(StringComparer.Ordinal);
        foreach (var section in config.GetSection("Connector:Keys").GetChildren())
        {
            var secret = section["Secret"];
            // Kısa gizli anahtar kabul edilmez: tahmin edilebilir imza anahtarı kapıyı açık bırakmak demektir.
            if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32) continue;
            var scopes = (section["Scopes"] ?? string.Empty)
                .Split([',', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.Ordinal);
            keys[section.Key] = new ConnectorKey(section.Key, secret, scopes);
        }
        return keys;
    }

    public async Task InvokeAsync(HttpContext http, IConfiguration config, GuzellikDbContext db)
    {
        var key = await AuthenticateAsync(http, config, db, logger);
        if (key is null) return;
        http.Items[KeyItem] = key;
        await next(http);
    }

    /// <summary>
    /// İmzayı, zamanı ve tek kullanımlık nonce'u doğrular; geçerliyse anahtarı döner. Geçersizse yanıtı (404/401/413)
    /// YAZMIŞ olarak null döner. Platform köprüsü (<see cref="PlatformBridgeMiddleware"/>) de aynı kapıdan geçer:
    /// doğrulamanın ikinci bir kopyası yoktur.
    /// </summary>
    public static async Task<ConnectorKey?> AuthenticateAsync(HttpContext http, IConfiguration config, GuzellikDbContext db, ILogger logger)
    {
        var keys = LoadKeys(config);
        if (keys.Count == 0)
        {
            http.Response.StatusCode = StatusCodes.Status404NotFound;
            return null;
        }

        var req = http.Request;
        var keyId = req.Headers[ConnectorSignature.KeyHeader].ToString();
        var nonce = req.Headers[ConnectorSignature.NonceHeader].ToString();
        var signature = req.Headers[ConnectorSignature.SignatureHeader].ToString();
        if (!keys.TryGetValue(keyId, out var key)
            || !long.TryParse(req.Headers[ConnectorSignature.TimestampHeader].ToString(), out var timestamp)
            || !ConnectorSignature.IsValidNonce(nonce))
        {
            await Reject(http, "signature.missing");
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        if (Math.Abs(now.ToUnixTimeSeconds() - timestamp) > ConnectorSignature.MaxClockSkew.TotalSeconds)
        {
            await Reject(http, "signature.expired");
            return null;
        }

        if (req.ContentLength is > MaxBodyBytes)
        {
            http.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            return null;
        }
        req.EnableBuffering(bufferThreshold: 64 * 1024, bufferLimit: MaxBodyBytes);
        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms, http.RequestAborted);
        if (ms.Length > MaxBodyBytes)
        {
            http.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            return null;
        }
        req.Body.Position = 0;

        var pathAndQuery = $"{req.PathBase}{req.Path}{req.QueryString}";
        var canonical = ConnectorSignature.Canonical(req.Method, pathAndQuery, timestamp, nonce,
            ConnectorSignature.BodyHash(ms.ToArray()));
        if (!ConnectorSignature.Matches(ConnectorSignature.Sign(key.Secret, canonical), signature))
        {
            logger.LogWarning("Bağlayıcı imzası geçersiz ({KeyId} {Method} {Path}).", keyId, req.Method, req.Path);
            await Reject(http, "signature.invalid");
            return null;
        }

        // TEKRAR KORUMASI: aynı (anahtar, nonce) ikinci kez yazılamaz. İmza geçerli olsa da tekrar reddedilir.
        db.ConnectorNonces.Add(new ConnectorNonce(key.Id, nonce, now.UtcDateTime.Add(ConnectorSignature.MaxClockSkew * 2)));
        try
        {
            // Süresi geçen nonce'lar: takma adsız ham SQL + LIMIT (EF'in DELETE'ini MariaDB reddeder,
            // bkz. QueryTranslationTests). İstek başına küçük parti; tablo kendiliğinden küçük kalır.
            if (db.Database.IsRelational())
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"DELETE FROM connector_nonces WHERE ExpiresAtUtc < {now.UtcDateTime} LIMIT 200", http.RequestAborted);
            await db.SaveChangesAsync(http.RequestAborted);
        }
        catch (DbUpdateException)
        {
            await Reject(http, "signature.replayed");
            return null;
        }
        finally
        {
            db.ChangeTracker.Clear();
        }

        return key;
    }

    private static Task Reject(HttpContext http, string code)
    {
        http.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return http.Response.WriteAsJsonAsync(new { success = false, error = new { code, message = "Bağlayıcı isteği doğrulanamadı." } });
    }
}

/// <summary>Uç başına kapsam: anahtar bu işe yetkili değilse 403.</summary>
public static class RequireConnectorScope
{
    public static TBuilder Scope<TBuilder>(this TBuilder builder, string scope) where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(async (ctx, next) =>
        {
            if (ctx.HttpContext.Items[ConnectorAuthMiddleware.KeyItem] is ConnectorKey key && key.Allows(scope))
                return await next(ctx);
            return Results.Json(new { success = false, error = new { code = "connector.scope", message = $"Bu anahtarın '{scope}' yetkisi yok." } },
                statusCode: StatusCodes.Status403Forbidden);
        });
}

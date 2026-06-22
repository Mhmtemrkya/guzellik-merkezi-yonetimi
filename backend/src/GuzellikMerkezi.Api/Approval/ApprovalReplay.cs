using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Api.Approval;

/// <summary>Onay kapısının sakladığı HTTP isteği — onayda aynen replay edilir.</summary>
public sealed record ReplayPayload(
    string Method,
    string Path,
    string Query,
    string? ContentType,
    string Body,
    string? BranchId);

/// <summary>
/// Onaylanan HttpReplay işlemini, isteği localhost'a yeniden göndererek uygular.
/// Replay, onaylayan kurum yöneticisinin token'ıyla yapılır → onay kapısı (yalnızca Staff'i yakalar)
/// bu isteği yakalamaz, doğrudan çalışır. Personelin şube bağlamı (X-Branch-Id) korunur.
/// </summary>
public sealed class HttpApprovalReplayer : IApprovalReplayer
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IConfiguration _configuration;

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    public HttpApprovalReplayer(IHttpClientFactory httpClientFactory, IHttpContextAccessor httpContextAccessor, IConfiguration configuration)
    {
        _httpClientFactory = httpClientFactory;
        _httpContextAccessor = httpContextAccessor;
        _configuration = configuration;
    }

    public async Task<Result<Guid?>> ReplayAsync(string payloadJson, CancellationToken cancellationToken = default)
    {
        ReplayPayload? p;
        try { p = JsonSerializer.Deserialize<ReplayPayload>(payloadJson, JsonOpts); }
        catch (JsonException) { return Result<Guid?>.Failure(Error.Validation("Onay payload'u çözümlenemedi.")); }
        if (p is null || string.IsNullOrWhiteSpace(p.Method) || string.IsNullOrWhiteSpace(p.Path))
            return Result<Guid?>.Failure(Error.Validation("Onay payload'u geçersiz."));

        var configuredUrl = _configuration["Urls"]?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault()
                            ?? "http://localhost:5019";
        // Replay backend'in KENDİNE (loopback) gider. ASPNETCORE_URLS wildcard host'larıyla (+, *, 0.0.0.0, [::])
        // bağlanmışsa bu host'lar dışa giden istek için geçersizdir → 127.0.0.1'e normalize ederiz (Docker'da kritik).
        var baseUrl = NormalizeLoopbackUrl(configuredUrl).TrimEnd('/');

        using var request = new HttpRequestMessage(new HttpMethod(p.Method), $"{baseUrl}{p.Path}{p.Query}");
        if (!string.IsNullOrEmpty(p.Body))
        {
            // StringContent'in mediaType parametresi yalın olmalı ("application/json"); saklanan
            // content-type "; charset=utf-8" gibi parametreler taşıyabilir → ayıkla (Encoding zaten UTF-8).
            var mediaType = p.ContentType;
            var semi = mediaType?.IndexOf(';') ?? -1;
            if (semi >= 0) mediaType = mediaType![..semi];
            mediaType = string.IsNullOrWhiteSpace(mediaType) ? "application/json" : mediaType.Trim();
            request.Content = new StringContent(p.Body, Encoding.UTF8, mediaType);
        }

        // Onaylayan yöneticinin token'ı (mevcut /approve isteğinden) — replay onun adına çalışır.
        var auth = _httpContextAccessor.HttpContext?.Request.Headers.Authorization.ToString();
        if (!string.IsNullOrWhiteSpace(auth)) request.Headers.TryAddWithoutValidation("Authorization", auth);
        if (!string.IsNullOrWhiteSpace(p.BranchId)) request.Headers.TryAddWithoutValidation("X-Branch-Id", p.BranchId);

        var client = _httpClientFactory.CreateClient("ApprovalReplay");
        HttpResponseMessage response;
        try { response = await client.SendAsync(request, cancellationToken); }
        catch (Exception ex) { return Result<Guid?>.Failure(Error.Validation($"İşlem uygulanamadı (replay hatası): {ex.Message}")); }

        if (response.IsSuccessStatusCode) return Result<Guid?>.Success(null);

        var msg = await response.Content.ReadAsStringAsync(cancellationToken);
        if (msg.Length > 300) msg = msg[..300];
        return Result<Guid?>.Failure(Error.Validation($"Onaylanan işlem uygulanamadı ({(int)response.StatusCode}). {msg}"));
    }

    /// <summary>
    /// ASPNETCORE_URLS wildcard host'larını (+, *, 0.0.0.0, [::]) loopback (127.0.0.1) ile değiştirir.
    /// Bu host'lar dinleme için geçerli ama dışa giden HTTP isteği için geçersizdir; replay backend'in
    /// kendisine gittiğinden 127.0.0.1 her zaman doğrudur. Parse edilemezse URL aynen döner.
    /// </summary>
    private static string NormalizeLoopbackUrl(string url)
    {
        var schemeSep = url.IndexOf("://", StringComparison.Ordinal);
        if (schemeSep < 0) return url;
        var scheme = url[..schemeSep];
        var rest = url[(schemeSep + 3)..]; // host[:port][/path...]
        var slash = rest.IndexOf('/');
        var authority = slash >= 0 ? rest[..slash] : rest;
        var path = slash >= 0 ? rest[slash..] : string.Empty;

        string host, port;
        if (authority.StartsWith('['))
        {
            var close = authority.IndexOf(']');
            host = close > 0 ? authority[..(close + 1)] : authority;
            port = close > 0 && close + 1 < authority.Length && authority[close + 1] == ':'
                ? authority[(close + 2)..]
                : string.Empty;
        }
        else
        {
            var colon = authority.LastIndexOf(':');
            host = colon >= 0 ? authority[..colon] : authority;
            port = colon >= 0 ? authority[(colon + 1)..] : string.Empty;
        }

        var isWildcard = host is "+" or "*" or "0.0.0.0" or "[::]" or "[::0]" or "::";
        if (!isWildcard) return url;

        var hostPort = string.IsNullOrEmpty(port) ? "127.0.0.1" : $"127.0.0.1:{port}";
        return $"{scheme}://{hostPort}{path}";
    }
}

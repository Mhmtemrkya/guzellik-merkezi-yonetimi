using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Push;

/// <summary>
/// Firebase Cloud Messaging HTTP v1 göndericisi. Google servis-hesabı JSON'u ile OAuth2 access token üretir
/// (RS256 imzalı JWT → token endpoint; ek NuGet paketi gerektirmez, System.Security.Cryptography ile).
/// Yapılandırma yoksa <see cref="IsConfigured"/>=false ve gönderim simülasyona düşer (loglanır, patlamaz).
///
/// Yapılandırma (herhangi biri):
///  - Push:Fcm:ServiceAccountJson  → satır içi servis-hesabı JSON'u
///  - Push:Fcm:ServiceAccountPath  → JSON dosya yolu
///  - GOOGLE_APPLICATION_CREDENTIALS ortam değişkeni → JSON dosya yolu
/// Opsiyonel: Push:Fcm:ProjectId (JSON'daki project_id'yi ezer).
/// </summary>
public sealed class FcmPushSender : IPushSender, IDisposable
{
    private const string Scope = "https://www.googleapis.com/auth/firebase.messaging";
    private const string DefaultTokenUri = "https://oauth2.googleapis.com/token";

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<FcmPushSender> _logger;

    private readonly ServiceAccount? _account;
    private readonly string? _projectId;

    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private string? _cachedToken;
    private DateTime _tokenExpiresUtc;

    public FcmPushSender(IConfiguration configuration, IHttpClientFactory httpFactory, ILogger<FcmPushSender> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;

        var json = ResolveServiceAccountJson(configuration);
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                _account = ParseServiceAccount(json!);
                _projectId = configuration["Push:Fcm:ProjectId"] ?? _account?.ProjectId;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FCM servis-hesabı JSON'u çözümlenemedi; push simülasyon moduna düştü.");
                _account = null;
            }
        }

        if (!IsConfigured)
            _logger.LogInformation("FCM push yapılandırılmadı — gönderimler simüle edilecek (uzaktan push kapalı).");
    }

    public bool IsConfigured => _account is not null && !string.IsNullOrWhiteSpace(_projectId);

    public async Task<int> SendAsync(IReadOnlyCollection<PushMessage> messages, CancellationToken ct = default)
    {
        if (messages.Count == 0) return 0;

        if (!IsConfigured)
        {
            // Simülasyon: gerçek gönderim yok, loglayıp "gönderildi" say (dev'de uçtan uca akış görünür).
            foreach (var m in messages)
                _logger.LogInformation("[FCM-SIM] → {Token}: {Title} — {Body}", Trunc(m.Token), m.Title, m.Body);
            return messages.Count;
        }

        string accessToken;
        try
        {
            accessToken = await GetAccessTokenAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "FCM access token alınamadı; push gönderilemedi.");
            return 0;
        }

        var endpoint = $"https://fcm.googleapis.com/v1/projects/{_projectId}/messages:send";
        var client = _httpFactory.CreateClient("Fcm");
        var sent = 0;

        foreach (var m in messages)
        {
            try
            {
                var payload = BuildMessagePayload(m);
                using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
                {
                    Content = new StringContent(payload, Encoding.UTF8, "application/json"),
                };
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);

                using var response = await client.SendAsync(request, ct);
                if (response.IsSuccessStatusCode)
                {
                    sent++;
                }
                else
                {
                    var respBody = await response.Content.ReadAsStringAsync(ct);
                    // UNREGISTERED/INVALID_ARGUMENT → token artık geçersiz; loglayıp geç (temizliği çağıran yapabilir).
                    _logger.LogWarning("FCM gönderim başarısız ({Status}) {Token}: {Body}",
                        (int)response.StatusCode, Trunc(m.Token), Trunc(respBody, 300));
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FCM tekil gönderim hatası.");
            }
        }

        return sent;
    }

    private string BuildMessagePayload(PushMessage m)
    {
        // FCM v1: data değerleri string olmak zorunda. Android'de yüksek öncelik + kanal id gönderiyoruz.
        var data = new Dictionary<string, string>();
        if (m.Data is not null)
            foreach (var kv in m.Data)
                data[kv.Key] = kv.Value ?? string.Empty;

        var message = new
        {
            message = new
            {
                token = m.Token,
                notification = new { title = m.Title, body = m.Body },
                data,
                android = new
                {
                    priority = "high",
                    notification = new { channel_id = "beautyassist_default", default_sound = true },
                },
            },
        };
        return JsonSerializer.Serialize(message);
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken ct)
    {
        if (_cachedToken is not null && DateTime.UtcNow < _tokenExpiresUtc)
            return _cachedToken;

        await _tokenLock.WaitAsync(ct);
        try
        {
            if (_cachedToken is not null && DateTime.UtcNow < _tokenExpiresUtc)
                return _cachedToken;

            var account = _account!;
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var header = Base64Url(Encoding.UTF8.GetBytes("{\"alg\":\"RS256\",\"typ\":\"JWT\"}"));
            var claimsJson = JsonSerializer.Serialize(new Dictionary<string, object>
            {
                ["iss"] = account.ClientEmail,
                ["scope"] = Scope,
                ["aud"] = account.TokenUri,
                ["iat"] = now,
                ["exp"] = now + 3600,
            });
            var claims = Base64Url(Encoding.UTF8.GetBytes(claimsJson));
            var unsigned = $"{header}.{claims}";

            using var rsa = RSA.Create();
            rsa.ImportFromPem(account.PrivateKey);
            var signature = rsa.SignData(Encoding.UTF8.GetBytes(unsigned), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            var assertion = $"{unsigned}.{Base64Url(signature)}";

            var client = _httpFactory.CreateClient("Fcm");
            using var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                new KeyValuePair<string, string>("assertion", assertion),
            });
            using var response = await client.PostAsync(account.TokenUri, content, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            response.EnsureSuccessStatusCode();

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var token = root.GetProperty("access_token").GetString()!;
            var expiresIn = root.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 3600;

            _cachedToken = token;
            _tokenExpiresUtc = DateTime.UtcNow.AddSeconds(expiresIn - 60);
            return token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private static string? ResolveServiceAccountJson(IConfiguration configuration)
    {
        var inline = configuration["Push:Fcm:ServiceAccountJson"];
        if (!string.IsNullOrWhiteSpace(inline)) return inline;

        var path = configuration["Push:Fcm:ServiceAccountPath"]
                   ?? Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS");
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
        {
            try { return File.ReadAllText(path); }
            catch { return null; }
        }
        return null;
    }

    private static ServiceAccount ParseServiceAccount(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        string Get(string key) => root.TryGetProperty(key, out var v) ? v.GetString() ?? string.Empty : string.Empty;
        return new ServiceAccount(
            ClientEmail: Get("client_email"),
            PrivateKey: Get("private_key"),
            TokenUri: string.IsNullOrWhiteSpace(Get("token_uri")) ? DefaultTokenUri : Get("token_uri"),
            ProjectId: Get("project_id"));
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Trunc(string? s, int max = 12) =>
        string.IsNullOrEmpty(s) ? string.Empty : (s.Length <= max ? s : s[..max] + "…");

    public void Dispose() => _tokenLock.Dispose();

    private sealed record ServiceAccount(string ClientEmail, string PrivateKey, string TokenUri, string ProjectId);
}

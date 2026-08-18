using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.Extensions.Caching.Memory;

namespace GuzellikMerkezi.Api.Services;

/// <summary>Parola doğrulandı, sırada e-posta kodu var.</summary>
public sealed record PanelLoginChallenge(string ChallengeId, string MaskedEmail, string? DevCode = null);

/// <summary>
/// PANEL GİRİŞİNDE İKİNCİ FAKTÖR — parola + e-postaya gelen 6 haneli kod.
///
/// <para>
/// Kurum yöneticisi ve personel paneline parola tek başına yetmiyordu. Panel; müşteri kişisel
/// verisi, tahsilat ve kasa içerdiği için ele geçirilmiş ya da tahmin edilmiş bir parolanın tek
/// engeli olması kabul edilemez. Kod, kullanıcının HESAP E-POSTASINA gider (SMS değil: kayıtlı
/// personelin telefonu her zaman doğrulanmış olmayabilir, e-posta ise giriş kimliğinin kendisi).
/// </para>
///
/// <para>
/// <b>Neden sarmalayıcı?</b> <see cref="IAuthService.LoginAsync"/> parola, hesap kilidi, kurum
/// durumu, şube eşleşmesi ve cihaz güvenliğini birlikte yürütüyor. Bu zinciri ikiye bölmek,
/// kontrollerden birinin yeni yolda unutulması riskini taşırdı. Bunun yerine zincir AYNEN
/// çalıştırılır; üretilen oturum istemciye VERİLMEZ, sunucu belleğinde tutulur ve ancak kod
/// doğrulanınca teslim edilir.
/// </para>
///
/// <para>
/// KABUL EDİLEN SONUÇ: oturum (refresh token satırı) kod doğrulanmadan ÖNCE oluşur. Doğrulanmayan
/// denemeler kullanılmamış bir refresh token satırı bırakır; satır istemciye hiç ulaşmaz ve 14
/// günde kendiliğinden düşer. Alternatifi — zinciri bölmek — daha büyük bir risk taşıyordu.
/// </para>
///
/// <para>
/// SINIR: bekleyen giriş bellekte tutulur (CustomerOtpService ile aynı tercih). Çok örnekli
/// kuruluma geçilirse Redis/DB'ye taşınmalı.
/// </para>
/// </summary>
public sealed class PanelLoginOtpService
{
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(10);
    private const int MaxAttempts = 5;

    private readonly IAuthService _auth;
    private readonly IMemoryCache _cache;
    private readonly IPlatformMessagingService _messaging;
    private readonly IHostEnvironment _env;
    private readonly ILogger<PanelLoginOtpService> _logger;

    public PanelLoginOtpService(
        IAuthService auth,
        IMemoryCache cache,
        IPlatformMessagingService messaging,
        IHostEnvironment env,
        ILogger<PanelLoginOtpService> logger)
    {
        _auth = auth;
        _cache = cache;
        _messaging = messaging;
        _env = env;
        _logger = logger;
    }

    private sealed class PendingLogin
    {
        public required string Code { get; init; }
        public required string Email { get; init; }
        public required LoginResponse Session { get; init; }
        public int Attempts;
        public bool Consumed;
    }

    private static string Key(string id) => $"panel-login:{id}";

    /// <summary>
    /// Adım 1 — parola ve tüm giriş kontrolleri. Geçerse e-postaya kod gider ve MEYDAN OKUMA döner.
    /// </summary>
    public async Task<Result<PanelLoginChallenge>> StartAsync(LoginRequest request, CancellationToken ct)
    {
        // Zincirin tamamı burada çalışır: yanlış parola, kilitli hesap, askıya alınmış kurum ve
        // cihaz kısıtı BU noktada reddedilir — kod hiç gönderilmez.
        var login = await _auth.LoginAsync(request, ct);
        if (login.IsFailure) return Result<PanelLoginChallenge>.Failure(login.Error);

        var session = login.Value!;
        var email = session.User.Email;
        var code = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();

        var sent = await SendAsync(email, session.User.FullName, code, ct);
        if (!sent)
        {
            // FAIL-CLOSED: kod gönderilemediyse oturum TESLİM EDİLMEZ. "Gönderemedik, buyur gir"
            // demek ikinci faktörü tamamen kaldırmak olurdu.
            _logger.LogError("Panel giriş kodu gönderilemedi: {Email}. Giriş reddedildi.", EmailMask.Mask(email));
            return Result<PanelLoginChallenge>.Failure(Error.Unauthorized(
                "Doğrulama kodu gönderilemedi. Lütfen daha sonra tekrar deneyin ya da yöneticinizle iletişime geçin."));
        }

        var challengeId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        _cache.Set(Key(challengeId), new PendingLogin { Code = code, Email = email, Session = session }, ChallengeLifetime);

        return Result<PanelLoginChallenge>.Success(new PanelLoginChallenge(
            challengeId, EmailMask.Mask(email), _env.IsDevelopment() ? code : null));
    }

    /// <summary>Adım 2 — kod doğruysa oturum teslim edilir. Kod TEK KULLANIMLIKTIR.</summary>
    public Task<Result<LoginResponse>> VerifyAsync(string challengeId, string code, CancellationToken ct)
    {
        var key = Key(challengeId ?? string.Empty);
        if (string.IsNullOrWhiteSpace(challengeId) || !_cache.TryGetValue<PendingLogin>(key, out var pending) || pending is null)
            return Task.FromResult(Result<LoginResponse>.Failure(Error.Unauthorized("Kodun süresi doldu. Lütfen tekrar giriş yapın.")));

        // Tek kullanım ve deneme sayacı kilit altında: eşzamanlı iki istek aynı kodu iki oturuma
        // çeviremesin, 5 deneme freni yarışta delinmesin.
        string? failure = null;
        lock (pending)
        {
            if (pending.Consumed) failure = "Bu kod zaten kullanıldı. Lütfen tekrar giriş yapın.";
            else if (pending.Attempts >= MaxAttempts) failure = "Çok fazla yanlış deneme. Lütfen tekrar giriş yapın.";
            else if (!string.Equals(pending.Code, code?.Trim(), StringComparison.Ordinal))
            {
                pending.Attempts++;
                failure = "Kod hatalı. Tekrar deneyin.";
            }
            else pending.Consumed = true;
        }

        if (failure is not null)
        {
            if (pending.Attempts >= MaxAttempts) _cache.Remove(key);
            return Task.FromResult(Result<LoginResponse>.Failure(Error.Unauthorized(failure)));
        }

        _cache.Remove(key);
        return Task.FromResult(Result<LoginResponse>.Success(pending.Session));
    }

    private async Task<bool> SendAsync(string email, string? fullName, string code, CancellationToken ct)
    {
        var body =
            $"<div style='font-family:sans-serif;font-size:15px;color:#2f1724'>" +
            $"<p>Merhaba {System.Net.WebUtility.HtmlEncode(fullName ?? "")},</p>" +
            $"<p>BeautyAsist paneline giriş doğrulama kodunuz:</p>" +
            $"<p style='font-size:30px;font-weight:700;letter-spacing:8px;color:#c85776'>{code}</p>" +
            $"<p>Kod 10 dakika geçerlidir. Bu girişi siz yapmadıysanız <b>parolanızı hemen değiştirin</b>.</p></div>";

        try
        {
            var result = await _messaging.SendEmailAsync(email, "BeautyAsist panel giriş kodunuz", body, ct);
            // SİMÜLASYON TESLİMAT DEĞİLDİR — sağlayıcı kurulu değilse kod kimseye ulaşmaz.
            // Geliştirmede simülasyon tek yoldur ve kod yanıtta döner.
            return result.Success && (!result.Simulated || _env.IsDevelopment());
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Panel giriş kodu gönderilemedi.");
            return false;
        }
    }
}

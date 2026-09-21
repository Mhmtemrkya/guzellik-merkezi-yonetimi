using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
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
    private readonly IOtpStateStore _store;
    private readonly IPlatformMessagingService _messaging;
    private readonly GuzellikDbContext _db;
    private readonly IConfiguration _config;
    private readonly IHostEnvironment _env;
    private readonly ILogger<PanelLoginOtpService> _logger;

    public PanelLoginOtpService(
        IAuthService auth,
        IOtpStateStore store,
        IPlatformMessagingService messaging,
        GuzellikDbContext db,
        IConfiguration config,
        IHostEnvironment env,
        ILogger<PanelLoginOtpService> logger)
    {
        _auth = auth;
        _store = store;
        _messaging = messaging;
        _db = db;
        _config = config;
        _env = env;
        _logger = logger;
    }

    /// <summary>
    /// Bekleyen giriş. <b>Alanlar değil PROPERTY, ve <c>init</c> değil <c>set</c>:</b>
    /// <see cref="System.Text.Json"/> alanları serileştirmez ve parametresiz kurucu ister —
    /// aksi hâlde Redis'e yazılan challenge geri okunamaz ve hiçbir panel girişi tamamlanamazdı.
    /// <c>internal</c>: serileştirici erişebilmeli.
    /// </summary>
    internal sealed class PendingLogin
    {
        public string Code { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public LoginResponse? Session { get; set; }
        public int Attempts { get; set; }
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
        // Apple inceleme hesabı `.test` adresi kullandığı için gerçek posta teslimatı mümkün
        // değildir. Kısa yol yalnız yapılandırılmış e-posta + InstitutionOwner rolü + kurumun
        // ÜÇÜ birden eşleşirse açılır; parola, hesap, kurum ve cihaz kontrolleri yukarıdaki
        // LoginAsync çağrısında yine eksiksiz çalışmıştır. Kod yanıtla yalnız bu dar hesap için
        // paylaşılır ve mağaza onayından sonra AppReview:Enabled kapatılarak devreden çıkarılır.
        var reviewCode = AppReviewOwnerCode(session.User);
        var code = reviewCode
            ?? RandomNumberGenerator.GetInt32(100000, 1000000).ToString();

        var sent = reviewCode is not null || await SendAsync(session.User, code, ct);
        if (!sent)
        {
            // FAIL-CLOSED: kod gönderilemediyse oturum TESLİM EDİLMEZ. "Gönderemedik, buyur gir"
            // demek ikinci faktörü tamamen kaldırmak olurdu.
            _logger.LogError("Panel giriş kodu gönderilemedi: {Email}. Giriş reddedildi.", EmailMask.Mask(email));
            return Result<PanelLoginChallenge>.Failure(Error.Unauthorized(
                "Doğrulama kodu gönderilemedi. Lütfen daha sonra tekrar deneyin ya da yöneticinizle iletişime geçin."));
        }

        var challengeId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        await _store.SetAsync(Key(challengeId), new PendingLogin { Code = code, Email = email, Session = session }, ChallengeLifetime, ct);

        return Result<PanelLoginChallenge>.Success(new PanelLoginChallenge(
            challengeId, EmailMask.Mask(email), reviewCode is not null || _env.IsDevelopment() ? code : null));
    }

    /// <summary>
    /// App Store incelemesinde yalnız önceden belirlenmiş demo yöneticisine gösterilecek sabit kod.
    /// Her yapılandırma parçası zorunludur; eksik/bozuk değer normal e-posta akışına fail-closed döner.
    /// </summary>
    private string? AppReviewOwnerCode(UserProfileDto user)
    {
        if (!_config.GetValue<bool>("AppReview:Enabled") ||
            user.Role != UserRole.InstitutionOwner ||
            user.TenantId is null)
            return null;

        var configuredEmail = _config["AppReview:OwnerEmail"]?.Trim();
        var configuredTenant = _config["AppReview:OwnerTenantId"]?.Trim();
        var configuredCode = _config["AppReview:OwnerOtpCode"]?.Trim();

        if (string.IsNullOrWhiteSpace(configuredEmail) ||
            !Guid.TryParse(configuredTenant, out var tenantId) ||
            configuredCode is not { Length: 6 } ||
            !configuredCode.All(char.IsAsciiDigit))
            return null;

        return string.Equals(user.Email.Trim(), configuredEmail, StringComparison.OrdinalIgnoreCase) &&
               user.TenantId.Value == tenantId
            ? configuredCode
            : null;
    }

    /// <summary>Adım 2 — kod doğruysa oturum teslim edilir. Kod TEK KULLANIMLIKTIR.</summary>
    public async Task<Result<LoginResponse>> VerifyAsync(string challengeId, string code, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(challengeId))
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kodun süresi doldu. Lütfen tekrar giriş yapın."));

        // Tek kullanım ve deneme sayacı DEPO KİLİDİ altında: eşzamanlı iki istek aynı kodu iki
        // oturuma çeviremesin, 5 deneme freni yarışta delinmesin. Başarıda kayıt SİLİNİR —
        // Consumed bayrağı process içi paylaşılan nesneye dayanıyordu, depoya taşınan durumda
        // silme hem daha basit hem yeniden okumaya karşı dayanıklıdır.
        var trimmed = code?.Trim();
        var decision = await _store.MutateAsync<PendingLogin, (LoginResponse? Session, string? Failure)>(
            Key(challengeId), ChallengeLifetime, pending =>
            {
                if (pending is null)
                    return (null, (null, "Kodun süresi doldu. Lütfen tekrar giriş yapın."));

                if (pending.Attempts >= MaxAttempts)
                    return (null, (null, "Çok fazla yanlış deneme. Lütfen tekrar giriş yapın."));

                if (!string.Equals(pending.Code, trimmed, StringComparison.Ordinal))
                {
                    pending.Attempts++;
                    return (pending.Attempts >= MaxAttempts ? null : pending,
                        (null, "Kod hatalı. Tekrar deneyin."));
                }

                return (null, (pending.Session, null));
            }, ct);

        if (decision.Session is null)
            return Result<LoginResponse>.Failure(Error.Unauthorized(
                decision.Failure ?? "Kodun süresi doldu. Lütfen tekrar giriş yapın."));

        return Result<LoginResponse>.Success(decision.Session);
    }

    /// <summary>
    /// Kodu markalı "DOĞRULAMA KODU BİLGİLERİ" şablonuyla gönderir (bkz.
    /// <see cref="VerificationEmailTemplate"/>).
    /// </summary>
    /// <remarks>
    /// Geçerlilik metni ELLE YAZILMAZ: <see cref="ChallengeLifetime"/> geçirilir. Eskiden gövdede
    /// "Kod 10 dakika geçerlidir" sabit yazıyordu; sabit değiştiğinde e-posta yalan söylerdi.
    /// </remarks>
    private async Task<bool> SendAsync(UserProfileDto user, string code, CancellationToken ct)
    {
        var email = user.Email;
        var body = VerificationEmailTemplate.Build(new VerificationEmailContent(
            Code: code,
            Email: email,
            Validity: ChallengeLifetime,
            OperationType: OperationLabel(user.Role),
            TenantName: await TenantNameAsync(user.TenantId, ct),
            VerificationLink: VerificationEmailTemplate.BuildLink("/login",
                _config["App:PublicBaseUrl"], _config["Frontend:PublicBaseUrl"], _config["WhatsApp:PublicBaseUrl"]),
            SecurityNote: "Bu girişi siz yapmadıysanız parolanızı hemen değiştirin."));

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

    /// <summary>
    /// E-postadaki "İşlem Tipi" satırı. Bu uç YALNIZ yöneticiye değil personele de hizmet eder;
    /// herkese "Yönetici Girişi" yazmak kullanıcıya yanlış bilgi verirdi.
    /// </summary>
    private static string OperationLabel(UserRole role) => role switch
    {
        UserRole.InstitutionOwner => "Yönetici Girişi",
        UserRole.BranchManager => "Şube Yöneticisi Girişi",
        UserRole.Staff => "Personel Girişi",
        UserRole.PlatformAdmin => "Platform Yöneticisi Girişi",
        _ => "Panel Girişi",
    };

    /// <summary>
    /// Başlık altındaki kurum adı. Bulunamazsa <c>null</c> döner ve satır hiç basılmaz —
    /// kod gönderimi kurum adı yüzünden ASLA düşmemeli.
    /// </summary>
    private async Task<string?> TenantNameAsync(Guid? tenantId, CancellationToken ct)
    {
        if (tenantId is null || tenantId == Guid.Empty) return null;
        try
        {
            return await _db.Tenants.AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => t.Name)
                .FirstOrDefaultAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Panel giriş e-postası için kurum adı okunamadı.");
            return null;
        }
    }
}

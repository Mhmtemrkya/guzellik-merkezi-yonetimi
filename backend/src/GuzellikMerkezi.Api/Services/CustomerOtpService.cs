using System.Security.Cryptography;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace GuzellikMerkezi.Api.Services;

/// <summary>Kodun hangi akış için üretildiği — giriş kodu kayıt için (ya da tersi) kullanılamaz.</summary>
public enum CustomerOtpPurpose
{
    Login = 0,
    Register = 1,
}

/// <summary>
/// Müşteri OTP girişi/kaydı — portalın TEK kimlik kapısı.
///
/// <para>
/// Eskiden <c>/customer/login</c> ve <c>/customer/register</c> uçları OTP'siz token üretiyordu; OTP
/// paralel bir "isteğe bağlı" özellikti. Telefon ve doğum tarihi bilinen bir müşterinin hesabı
/// böylece ele geçirilebiliyordu. Artık token YALNIZ buradan, telefona gönderilen kod doğrulandıktan
/// sonra üretilir.
/// </para>
///
/// <para>
/// Kodlar bellekte 5 dk tutulur; 5 yanlış denemede geçersiz olur. Ayrıca TELEFON BAZLI istek freni
/// vardır: IP hız sınırı proxy zincirinde sahtelenebildiği için tek başına yeterli değildir.
/// </para>
/// <para>
/// SINIR: kod deposu process belleğidir (tek örnek kurulum). Birden çok backend örneğine geçilirse
/// Redis/DB'ye taşınmalı — aksi hâlde kod, isteği alan örnekte kalır.
/// </para>
/// </summary>
public sealed class CustomerOtpService
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(5);
    private const int MaxAttempts = 5;

    /// <summary>Aynı telefona bu pencerede en çok bu kadar kod istenebilir (SMS bombardımanı + enumerasyon freni).</summary>
    private static readonly TimeSpan RequestWindow = TimeSpan.FromMinutes(10);
    private const int MaxRequestsPerWindow = 3;

    private readonly GuzellikDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly IPlatformMessagingService _messaging;
    private readonly IAuthService _auth;
    private readonly IHostEnvironment _env;
    private readonly ILogger<CustomerOtpService> _logger;

    public CustomerOtpService(GuzellikDbContext db, IMemoryCache cache, IPlatformMessagingService messaging, IAuthService auth, IHostEnvironment env, ILogger<CustomerOtpService> logger)
    {
        _db = db;
        _cache = cache;
        _messaging = messaging;
        _auth = auth;
        _env = env;
        _logger = logger;
    }

    private sealed class OtpEntry
    {
        public string Code = string.Empty;
        public int Attempts;
    }

    private sealed class RequestCounter
    {
        public int Count;
    }

    private static string CacheKey(string loginKey, CustomerOtpPurpose purpose) => $"customer-otp:{purpose}:{loginKey}";
    private static string ThrottleKey(string loginKey) => $"customer-otp-throttle:{loginKey}";

    private static string NormalizeName(string? name) =>
        string.IsNullOrWhiteSpace(name)
            ? string.Empty
            : string.Join(' ', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

    /// <summary>
    /// Kod üretir ve telefona gönderir.
    /// <para>
    /// GİRİŞ akışında kod yalnız kimlik (ad + telefon + doğum tarihi) eşleşirse üretilir; KAYIT
    /// akışında telefon sahipliğini kanıtlamak için her hâlükârda üretilir. Yanıt iki durumda da
    /// AYNIDIR — hesap var/yok bilgisi sızmaz.
    /// </para>
    /// </summary>
    public async Task<Result<object>> RequestAsync(CustomerLoginRequest request, CustomerOtpPurpose purpose, CancellationToken ct)
    {
        var key = PhoneMask.LoginKey(request.Phone);
        var name = NormalizeName(request.FullName);
        if (key.Length < 10 || name.Length == 0 || request.BirthDate == default)
            return Result<object>.Failure(Error.Validation("Ad soyad, telefon ve doğum tarihi zorunludur."));

        // Telefon bazlı fren — IP'den bağımsız çalışır.
        var counter = _cache.GetOrCreate(ThrottleKey(key), entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = RequestWindow;
            return new RequestCounter();
        })!;
        if (counter.Count >= MaxRequestsPerWindow)
        {
            return Result<object>.Failure(Error.Unauthorized(
                "Bu numara için çok fazla kod istendi. Lütfen birkaç dakika sonra tekrar deneyin."));
        }
        counter.Count++;

        var shouldSend = purpose == CustomerOtpPurpose.Register;
        if (!shouldSend)
        {
            var candidates = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .Where(c => !c.IsDeleted && c.BirthDate == request.BirthDate)
                .Select(c => new { c.Phone, c.FullName })
                .ToListAsync(ct);
            shouldSend = candidates.Any(c => PhoneMask.LoginKey(c.Phone) == key && NormalizeName(c.FullName) == name);
        }

        string? devCode = null;
        if (shouldSend)
        {
            var code = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
            _cache.Set(CacheKey(key, purpose), new OtpEntry { Code = code }, CodeLifetime);
            try
            {
                await _messaging.SendWhatsAppAsync(request.Phone, $"BeautyAsist giriş kodunuz: {code}. Kod 5 dakika geçerlidir. Kimseyle paylaşmayın.", ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "OTP WhatsApp gönderilemedi.");
            }
            // Geliştirme ortamında kodu yanıtla da döndür (simülasyonda gerçek gönderim yapılmaz).
            if (_env.IsDevelopment()) devCode = code;
        }

        return Result<object>.Success(new
        {
            message = "Bilgiler kayıtlarımızla eşleşiyorsa WhatsApp numaranıza doğrulama kodu gönderildi.",
            devCode,
        });
    }

    /// <summary>Kodu doğrular ve akışa göre giriş ya da kayıt yapar. Kod TEK KULLANIMLIKTIR.</summary>
    public async Task<Result<LoginResponse>> VerifyAsync(
        CustomerLoginRequest request,
        string code,
        CustomerOtpPurpose purpose,
        CustomerRegisterRequest? registration,
        CancellationToken ct)
    {
        var key = PhoneMask.LoginKey(request.Phone);
        var cacheKey = CacheKey(key, purpose);
        if (!_cache.TryGetValue<OtpEntry>(cacheKey, out var entry) || entry is null)
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kodun süresi doldu ya da kod istenmedi. Yeni kod isteyin."));

        if (entry.Attempts >= MaxAttempts)
        {
            _cache.Remove(cacheKey);
            return Result<LoginResponse>.Failure(Error.Unauthorized("Çok fazla yanlış deneme. Yeni kod isteyin."));
        }

        if (!string.Equals(entry.Code, code?.Trim(), StringComparison.Ordinal))
        {
            entry.Attempts++;
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kod hatalı. Tekrar deneyin."));
        }

        // Kod tüketildi: aynı kod ikinci kez kullanılamaz.
        _cache.Remove(cacheKey);

        if (purpose == CustomerOtpPurpose.Register)
        {
            var payload = registration ?? new CustomerRegisterRequest(
                request.FullName, request.Phone, request.BirthDate, Domain.Enums.Gender.Unspecified, null);
            // Telefon sahipliği bu noktada kanıtlanmıştır.
            return await _auth.CustomerRegisterAsync(payload, phoneVerified: true, ct);
        }

        // Kod doğru → kimlik yeniden doğrulanır, JWT üretilir.
        return await _auth.CustomerLoginAsync(request, ct);
    }
}

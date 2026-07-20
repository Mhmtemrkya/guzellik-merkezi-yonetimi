using System.Security.Cryptography;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace GuzellikMerkezi.Api.Services;

/// <summary>
/// Müşteri OTP/2FA girişi: kimlik (ad+telefon+doğum tarihi) eşleşirse telefona 6 haneli kod
/// WhatsApp ile gönderilir (platform geneli WhatsApp altyapısı — Meta Cloud API; yapılandırılmamışsa
/// simülasyon modunda gerçek gönderim yapılmaz), kod doğrulanınca normal müşteri girişi (JWT) tamamlanır.
/// Kodlar bellekte 5 dk tutulur; 5 yanlış denemede kod geçersiz olur.
/// </summary>
public sealed class CustomerOtpService
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(5);
    private const int MaxAttempts = 5;

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

    private static string CacheKey(string loginKey) => $"customer-otp:{loginKey}";

    private static string NormalizeName(string? name) =>
        string.IsNullOrWhiteSpace(name)
            ? string.Empty
            : string.Join(' ', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

    /// <summary>Kimlik eşleşiyorsa kod üretip SMS'ler. Güvenlik: eşleşmese de aynı yanıt döner (hesap keşfini önler).</summary>
    public async Task<Result<object>> RequestAsync(CustomerLoginRequest request, CancellationToken ct)
    {
        var key = PhoneMask.LoginKey(request.Phone);
        var name = NormalizeName(request.FullName);
        if (key.Length < 10 || name.Length == 0 || request.BirthDate == default)
            return Result<object>.Failure(Error.Validation("Ad soyad, telefon ve doğum tarihi zorunludur."));

        var candidates = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .Where(c => !c.IsDeleted && c.BirthDate == request.BirthDate)
            .Select(c => new { c.Phone, c.FullName })
            .ToListAsync(ct);
        var matched = candidates.Any(c => PhoneMask.LoginKey(c.Phone) == key && NormalizeName(c.FullName) == name);

        string? devCode = null;
        if (matched)
        {
            var code = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
            _cache.Set(CacheKey(key), new OtpEntry { Code = code }, CodeLifetime);
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

    public async Task<Result<LoginResponse>> VerifyAsync(CustomerLoginRequest request, string code, CancellationToken ct)
    {
        var key = PhoneMask.LoginKey(request.Phone);
        if (!_cache.TryGetValue<OtpEntry>(CacheKey(key), out var entry) || entry is null)
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kodun süresi doldu ya da kod istenmedi. Yeni kod isteyin."));

        if (entry.Attempts >= MaxAttempts)
        {
            _cache.Remove(CacheKey(key));
            return Result<LoginResponse>.Failure(Error.Unauthorized("Çok fazla yanlış deneme. Yeni kod isteyin."));
        }

        if (!string.Equals(entry.Code, code?.Trim(), StringComparison.Ordinal))
        {
            entry.Attempts++;
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kod hatalı. Tekrar deneyin."));
        }

        _cache.Remove(CacheKey(key));
        // Kod doğru → normal müşteri girişi (kimlik yeniden doğrulanır, JWT üretilir).
        return await _auth.CustomerLoginAsync(request, ct);
    }
}

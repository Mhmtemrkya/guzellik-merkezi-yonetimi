using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Services;

/// <summary>Adım 1 yanıtı — kod gönderildi (ya da gönderilmiş gibi yapıldı; bkz. sınıf notu).</summary>
public sealed record PasswordResetChallenge(string ChallengeId, string MaskedEmail, string? DevCode = null);

/// <summary>Adım 1 isteği — yalnız e-posta.</summary>
public sealed record PasswordResetRequestBody(string Email);

/// <summary>Adım 2 isteği — meydan okuma + koda + yeni parola.</summary>
public sealed record PasswordResetCompleteBody(string ChallengeId, string Code, string NewPassword);

/// <summary>
/// PAROLA SIFIRLAMA — "şifremi unuttum" akışının sunucu tarafı.
///
/// <para>
/// Eskiden sıfırlama diye bir şey YOKTU: giriş ekranındaki kutu kullanıcıyı yöneticisine ya da
/// platform ekibine yönlendiren bir BİLGİ metniydi. Kurum yöneticisinin üstünde ise yalnızca
/// platform ekibi vardı — yani bir yöneticinin parolasını unutması insan müdahalesi gerektiriyordu.
/// </para>
///
/// <para>
/// <b>Kanal E-POSTADIR, SMS değil.</b> Panel girişinin ikinci faktörü de e-postadır
/// (bkz. <see cref="PanelLoginOtpService"/>): e-posta hesabın giriş kimliğinin ta kendisidir,
/// personelin telefonu ise her zaman doğrulanmış olmayabilir. SMS sağlayıcısı canlıya alındığında
/// bile bu akışın kanalı değişmemelidir — sıfırlamanın kanıtlaması gereken şey <b>giriş
/// kimliğinin sahipliğidir</b>.
/// </para>
///
/// <para>
/// <b>ENUMERASYON FRENİ.</b> Adres kayıtlı olsun olmasın yanıt AYNIDIR: her iki durumda da bir
/// meydan okuma kimliği ve maskeli adres döner. Kayıtlı olmayan adres için üretilen meydan okuma
/// bir <i>sahte</i>dir (<see cref="PendingReset.Exists"/> = false): kod hiç gönderilmez, hiçbir
/// kod onu doğrulayamaz. Aksi hâlde anonim bir uçtan "bu e-posta sistemde var mı?" sorusu
/// cevaplanabilir hâle gelirdi — bu depo baştan sona bundan kaçınmak üzere kuruludur
/// (bkz. TenantSignupService.DuplicateMessage).
/// </para>
///
/// <para>
/// <b>AYNI E-POSTA BİRDEN ÇOK KURUMDA OLABİLİR</b> ve bu desteklenen bir özelliktir (çoklu kurum
/// yöneticisi). Sıfırlama bu yüzden <c>FirstOrDefault</c> ile TEK bir satıra uygulanmaz:
/// adresle eşleşen TÜM aktif hesapların parolası birlikte değişir. Tek satır seçilseydi kullanıcı
/// parolasını "değiştirdikten" sonra diğer kurumuna hâlâ eski parolayla girmeye çalışır ve
/// nedenini anlayamazdı. Adresin sahibi tek kişidir; hesapları da öyle.
/// </para>
///
/// <para>
/// <b>MÜŞTERİLER KAPSAM DIŞIDIR.</b> Müşteri hesabının parolası yoktur — girişi zaten e-posta
/// koduyla yapılır (bkz. <see cref="CustomerOtpService"/>). Onlara "parola sıfırlama" sunmak
/// var olmayan bir şeyi sıfırlamak olurdu.
/// </para>
///
/// <para>
/// SINIR: bekleyen sıfırlama <see cref="IOtpStateStore"/>'da tutulur (Redis kuruluysa örnekler
/// arasında ortak, değilse process belleği) — panel girişiyle aynı tercih.
/// </para>
/// </summary>
public sealed class PasswordResetService
{
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(15);
    private const int MaxAttempts = 5;

    /// <summary>Aynı adrese bu pencerede en çok bu kadar sıfırlama isteği (maliyet + spam freni).</summary>
    private static readonly TimeSpan ThrottleWindow = TimeSpan.FromMinutes(15);
    private const int MaxRequestsPerWindow = 3;

    /// <summary>Yeni parola en az bu kadar karakter (ChangePasswordAsync ile aynı kural).</summary>
    private const int MinPasswordLength = 8;

    private readonly GuzellikDbContext _db;
    private readonly IOtpStateStore _store;
    private readonly IPlatformMessagingService _messaging;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IConfiguration _config;
    private readonly IHostEnvironment _env;
    private readonly ILogger<PasswordResetService> _logger;

    public PasswordResetService(
        GuzellikDbContext db,
        IOtpStateStore store,
        IPlatformMessagingService messaging,
        IPasswordHasher passwordHasher,
        IAuditLogger audit,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IConfiguration config,
        IHostEnvironment env,
        ILogger<PasswordResetService> logger)
    {
        _db = db;
        _store = store;
        _messaging = messaging;
        _passwordHasher = passwordHasher;
        _audit = audit;
        _currentUser = currentUser;
        _clock = clock;
        _config = config;
        _env = env;
        _logger = logger;
    }

    /// <summary>
    /// Bekleyen sıfırlama.
    /// </summary>
    /// <remarks>
    /// <b>Alanlar değil PROPERTY, <c>init</c> değil <c>set</c>, parametresiz kurucu:</b>
    /// <see cref="System.Text.Json"/> alanları serileştirmez — aksi hâlde Redis'e yazılan kayıt
    /// geri okunamaz ve hiçbir sıfırlama tamamlanamazdı (bkz. PanelLoginOtpService.PendingLogin).
    /// </remarks>
    internal sealed class PendingReset
    {
        public string Code { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;

        /// <summary>
        /// Adres GERÇEKTEN kayıtlı mı? <c>false</c> ise bu bir sahte meydan okumadır: kod hiç
        /// üretilmemiştir ve <see cref="Code"/> boştur — hiçbir giriş onu doğrulayamaz.
        /// </summary>
        public bool Exists { get; set; }

        public int Attempts { get; set; }
    }

    private static string Key(string id) => $"password-reset:{id}";
    private static string ThrottleKey(string email) => $"password-reset-throttle:{email}";

    // ----------------------------------------------------------------- adım 1

    /// <summary>
    /// Adres kayıtlıysa e-postaya 6 haneli kod gönderir. <b>Yanıt her durumda aynıdır.</b>
    /// </summary>
    public async Task<Result<PasswordResetChallenge>> RequestAsync(string? email, CancellationToken ct)
    {
        var normalized = TenantTextHelper.NormalizeEmail(email ?? string.Empty);
        if (normalized.Length == 0 || !normalized.Contains('@') || !normalized.Contains('.'))
            return Result<PasswordResetChallenge>.Failure(Error.Validation("Geçerli bir e-posta adresi girin."));

        // E-posta bazlı fren — IP kovasından BAĞIMSIZ. Artırım ATOMİKTİR: oku-artır-yaz üç ayrı
        // adım olsaydı eşzamanlı istekler aynı değeri okuyup sınırı delerdi.
        //
        // FREN SAHTE MEYDAN OKUMAYA DA UYGULANIR: yalnız gerçek adreslerde sayılsaydı, "429 aldım
        // demek ki bu adres kayıtlı" gözlemi enumerasyon kapısını geri açardı.
        var count = await _store.IncrementAsync(ThrottleKey(normalized), ThrottleWindow, ct);
        if (count > MaxRequestsPerWindow)
        {
            return Result<PasswordResetChallenge>.Failure(Error.Unauthorized(
                "Bu adres için çok fazla sıfırlama isteği yapıldı. Lütfen birkaç dakika sonra tekrar deneyin."));
        }

        var users = await FindResettableUsersAsync(normalized, ct);
        var challengeId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var masked = TenantTextHelper.MaskEmail(normalized);

        if (users.Count == 0)
        {
            // SAHTE MEYDAN OKUMA: gözlemlenebilir davranış gerçek akışla birebir aynı olsun.
            // Kayıt yine de yazılır — yoksa 2. adımda "süresi doldu" yerine farklı bir hata
            // üretilir ve fark ölçülebilir hâle gelirdi.
            await _store.SetAsync(Key(challengeId), new PendingReset { Email = normalized, Exists = false }, ChallengeLifetime, ct);
            _logger.LogInformation("Parola sıfırlama: kayıtlı olmayan adres için sahte meydan okuma üretildi.");
            return Result<PasswordResetChallenge>.Success(new PasswordResetChallenge(challengeId, masked));
        }

        var code = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        var sent = await SendAsync(normalized, users[0], code, ct);
        if (!sent)
        {
            // Gönderilemediyse kayıt bırakmanın anlamı yok: kimsenin göremediği bir kodu saklamak
            // yalnızca 6 hanelik bir kaba kuvvet hedefi bırakır.
            _logger.LogError("Parola sıfırlama kodu gönderilemedi.");
            return Result<PasswordResetChallenge>.Failure(Error.Unauthorized(
                "Sıfırlama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin."));
        }

        await _store.SetAsync(Key(challengeId),
            new PendingReset { Code = code, Email = normalized, Exists = true }, ChallengeLifetime, ct);

        return Result<PasswordResetChallenge>.Success(new PasswordResetChallenge(
            challengeId, masked, _env.IsDevelopment() ? code : null));
    }

    // ----------------------------------------------------------------- adım 2

    /// <summary>
    /// Kod doğruysa parolayı değiştirir ve <b>tüm oturumları kapatır</b>.
    /// </summary>
    /// <remarks>
    /// Oturum kapatma sıfırlamanın ayrılmaz parçasıdır: parolayı unutmanın en olası kötü senaryosu
    /// hesabın başkasının elinde olmasıdır. Yeni parola koyup eski refresh token'ları yaşatmak,
    /// saldırganın erişimini 14 gün daha sürdürmesine izin verirdi.
    /// </remarks>
    public async Task<Result<object>> CompleteAsync(string? challengeId, string? code, string? newPassword, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Trim().Length < MinPasswordLength)
            return Result<object>.Failure(Error.Validation($"Yeni parola en az {MinPasswordLength} karakter olmalı."));

        if (string.IsNullOrWhiteSpace(challengeId))
            return Result<object>.Failure(Error.Unauthorized("Sıfırlama oturumunuz sona ermiş. Lütfen baştan başlayın."));

        // Tek kullanım ve deneme sayacı DEPO KİLİDİ altında: eşzamanlı iki istek aynı kodu iki kez
        // kullanamasın, 5 deneme freni yarışta delinmesin. Karar SAF tutulur — parola yazma ve
        // e-posta gibi yavaş işler kilidin dışındadır.
        var trimmed = code?.Trim();
        var decision = await _store.MutateAsync<PendingReset, (string? Email, string? Failure)>(
            Key(challengeId), ChallengeLifetime, pending =>
            {
                if (pending is null)
                    return (null, (null, "Sıfırlama oturumunuz sona ermiş. Lütfen baştan başlayın."));

                if (pending.Attempts >= MaxAttempts)
                    return (null, (null, "Çok fazla yanlış deneme. Lütfen baştan başlayın."));

                // SAHTE MEYDAN OKUMA: Code boştur ve hiçbir girdiyle eşleşmez. Gerçek koddan
                // AYIRT EDİLEMEZ bir yanıt üretmek için aynı sayaç yolundan geçirilir.
                var ok = pending.Exists
                         && pending.Code.Length > 0
                         && string.Equals(pending.Code, trimmed, StringComparison.Ordinal);
                if (!ok)
                {
                    pending.Attempts++;
                    return (pending.Attempts >= MaxAttempts ? null : pending,
                        (null, "Kod hatalı. Tekrar deneyin."));
                }

                // BAŞARIDA KAYIT SİLİNİR: ikinci istek onu hiç bulamaz (tek kullanım).
                return (null, (pending.Email, null));
            }, ct);

        if (decision.Email is null)
            return Result<object>.Failure(Error.Unauthorized(decision.Failure ?? "Kod doğrulanamadı."));

        var users = await FindResettableUsersAsync(decision.Email, ct);
        if (users.Count == 0)
        {
            // Kod üretildikten sonra hesap kapatılmış olabilir (15 dakikalık pencere).
            return Result<object>.Failure(Error.Unauthorized(
                "Bu adres için parola sıfırlanamıyor. Lütfen bizimle iletişime geçin."));
        }

        var now = _clock.UtcNow;
        var hash = _passwordHasher.Hash(newPassword.Trim());

        foreach (var user in users)
        {
            // ConfirmOwnPassword: MustChangePassword=false — kullanıcı parolayı KENDİSİ seçti,
            // geçici parola değil. SetTemporaryPassword kullanılsaydı girer girmez yeniden
            // parola sorulurdu (anlamsız bir ikinci adım).
            user.ConfirmOwnPassword(hash);
            user.ResetFailedLogins();
            await Infrastructure.Security.SessionRevocation.RevokeAllAsync(_db, user.Id, now, ct);
        }

        await _db.SaveChangesAsync(ct);

        foreach (var user in users)
        {
            await _audit.LogActorAsync(
                user.TenantId, user.BranchId, user.Id, user.Email, user.Role.ToString(),
                "PasswordReset", "Auth", user.Id,
                "Parolasını e-posta doğrulamasıyla sıfırladı; tüm oturumlar kapatıldı.",
                new { userId = user.Id, user.Email, role = user.Role.ToString(), tenantId = user.TenantId },
                _currentUser.IpAddress, ct);
        }

        _logger.LogInformation("Parola sıfırlandı: {Count} hesap.", users.Count);

        return Result<object>.Success(new
        {
            message = "Parolanız güncellendi. Yeni parolanızla giriş yapabilirsiniz.",
            accounts = users.Count,
        });
    }

    // ----------------------------------------------------------------- yardımcılar

    /// <summary>
    /// Adresle eşleşen, parolası sıfırlanabilir TÜM aktif hesaplar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>IgnoreQueryFilters</c>: akış anonimdir, ortada kurum kapsamı yoktur — global kiracı
    /// süzgeci uygulanırsa sorgu HİÇBİR satır döndürmez.
    /// </para>
    /// <para>
    /// <c>TenantUser.Email</c> düz metin saklanır, bu yüzden SQL eşitliği güvenilirdir (telefon ve
    /// kurum adı şifreli olduğundan öyle aranamaz — bkz. TenantSignupService.IsDuplicateAsync).
    /// </para>
    /// </remarks>
    private async Task<List<TenantUser>> FindResettableUsersAsync(string email, CancellationToken ct)
        => await _db.TenantUsers.IgnoreQueryFilters()
            .Where(u => u.IsActive && u.Email == email)
            .ToListAsync(ct);

    /// <summary>
    /// Kodu markalı "DOĞRULAMA KODU BİLGİLERİ" şablonuyla gönderir.
    /// </summary>
    /// <remarks>
    /// Geçerlilik metni ELLE YAZILMAZ: <see cref="ChallengeLifetime"/> geçirilir — sabit
    /// değiştiğinde e-posta kendiliğinden doğru kalır (bkz. VerificationEmailTemplate).
    /// </remarks>
    private async Task<bool> SendAsync(string email, TenantUser user, string code, CancellationToken ct)
    {
        var body = VerificationEmailTemplate.Build(new VerificationEmailContent(
            Code: code,
            Email: email,
            Validity: ChallengeLifetime,
            OperationType: OperationLabel(user.Role),
            TenantName: await TenantNameAsync(user.TenantId, ct),
            VerificationLink: VerificationEmailTemplate.BuildLink("/login",
                _config["App:PublicBaseUrl"], _config["Frontend:PublicBaseUrl"], _config["WhatsApp:PublicBaseUrl"]),
            SecurityNote: "Bu isteği siz yapmadıysanız bu e-postayı yok sayın; parolanız değişmez."));

        try
        {
            var result = await _messaging.SendEmailAsync(email, "BeautyAsist parola sıfırlama kodunuz", body, ct);
            // SİMÜLASYON TESLİMAT DEĞİLDİR — sağlayıcı kurulu değilse kod kimseye ulaşmaz.
            // Geliştirmede simülasyon tek yoldur ve kod yanıtta döner.
            return result.Success && (!result.Simulated || _env.IsDevelopment());
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Parola sıfırlama kodu gönderilemedi.");
            return false;
        }
    }

    private static string OperationLabel(UserRole role) => role switch
    {
        UserRole.InstitutionOwner => "Yönetici Parola Sıfırlama",
        UserRole.BranchManager => "Şube Yöneticisi Parola Sıfırlama",
        UserRole.Staff => "Personel Parola Sıfırlama",
        UserRole.PlatformAdmin => "Platform Yöneticisi Parola Sıfırlama",
        _ => "Parola Sıfırlama",
    };

    /// <summary>
    /// Başlık altındaki kurum adı. Bulunamazsa <c>null</c> döner ve satır hiç basılmaz —
    /// kod gönderimi kurum adı yüzünden ASLA düşmemeli.
    /// </summary>
    private async Task<string?> TenantNameAsync(Guid tenantId, CancellationToken ct)
    {
        if (tenantId == Guid.Empty) return null;
        try
        {
            return await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => t.Name)
                .FirstOrDefaultAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Parola sıfırlama e-postası için kurum adı okunamadı.");
            return null;
        }
    }
}

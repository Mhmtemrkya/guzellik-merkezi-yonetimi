using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.TenantSignup;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// SELF-SERVİS KURUM KAYDI — kurum sahibi kendi kaydolur, 14 gün deneme başlar.
///
/// <para>
/// <b>İki faktör:</b> e-posta sahipliği + telefon sahipliği. İkisi de doğrulanmadan kurum
/// OLUŞMAZ. Tek faktör yeterli olsaydı, başkasının e-postasıyla kurum açıp o kişiye ait bir
/// işletme adını rezerve etmek mümkün olurdu.
/// </para>
///
/// <para>
/// <b>Kurum en son adımda oluşur.</b> Yarım kalan denemeler veritabanına hiç yazılmaz: kurum kodu
/// tüketilmez, ad/slug kilitlenmez, platform listesi çöplenmez. Taslak bellekte tutulur ve
/// <see cref="DraftLifetime"/> sonunda kendiliğinden kaybolur.
/// </para>
///
/// <para>
/// SINIR: taslak deposu process belleğidir (CustomerOtpService ile aynı tercih). Birden çok
/// backend örneğine geçilirse Redis/DB'ye taşınmalı — aksi hâlde 2. adım isteği başka örneğe
/// düşerse taslak bulunamaz.
/// </para>
/// </summary>
public sealed class TenantSignupService : ITenantSignupService
{
    private static readonly TimeSpan DraftLifetime = TimeSpan.FromMinutes(30);
    private const int MaxAttempts = 5;

    /// <summary>Aynı e-postaya bu pencerede en çok bu kadar kayıt denemesi (spam + enumerasyon freni).</summary>
    private static readonly TimeSpan ThrottleWindow = TimeSpan.FromMinutes(30);
    private const int MaxStartsPerWindow = 3;

    /// <summary>Kurum kodu UNIQUE ihlalinde kaç kez yeniden denenecek (bkz. TenantCodeAllocator).</summary>
    private const int MaxCodeAttempts = 5;

    /// <summary>Deneme süresi — landing sayfasındaki "14 gün ücretsiz" vaadi.</summary>
    private const int TrialDays = 14;

    /// <summary>
    /// Mükerrer kayıtta dönen TEK mesaj.
    /// </summary>
    /// <remarks>
    /// E-posta / telefon / işletme adı için AYRI mesajlar dönmek, anonim bir uçtan "bu kişi ya da
    /// işletme sistemde kayıtlı mı?" sorusunu cevaplanabilir hâle getiriyordu. Hangi alanın
    /// çakıştığı SÖYLENMEZ; kullanıcı zaten kendi bilgilerini biliyor, saldırgan bilmiyor.
    /// </remarks>
    private const string DuplicateMessage =
        "Bu bilgilerle kayıtlı bir hesap görünüyor. Giriş yapmayı deneyin ya da farklı bilgilerle kaydolun.";

    /// <summary>Aynı taslakta iki kod isteği arasındaki en kısa süre (maliyet freni).</summary>
    private static readonly TimeSpan ResendCooldown = TimeSpan.FromSeconds(60);

    /// <summary>Bir taslak ömrü boyunca en çok bu kadar kod yeniden gönderilebilir.</summary>
    private const int MaxResendsPerDraft = 3;

    private readonly GuzellikDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly IPlatformMessagingService _messaging;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenService _tokenService;
    private readonly ISearchIndexService _search;
    private readonly IDateTimeProvider _clock;
    private readonly IAppEnvironment _env;
    private readonly IAuditLogger _audit;
    private readonly ILogger<TenantSignupService> _logger;

    /// <summary>Denemede atanacak paket anahtarı (<c>TenantSignup:TrialPlanKey</c>).</summary>
    private readonly string? _trialPlanKey;

    public TenantSignupService(
        GuzellikDbContext db,
        IMemoryCache cache,
        IPlatformMessagingService messaging,
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        ISearchIndexService search,
        IDateTimeProvider clock,
        IAppEnvironment env,
        IAuditLogger audit,
        Microsoft.Extensions.Configuration.IConfiguration configuration,
        ILogger<TenantSignupService> logger)
    {
        _trialPlanKey = configuration["TenantSignup:TrialPlanKey"];
        _db = db;
        _cache = cache;
        _messaging = messaging;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _search = search;
        _clock = clock;
        _env = env;
        _audit = audit;
        _logger = logger;
    }

    // ----------------------------------------------------------------- taslak

    private enum SignupStage
    {
        AwaitingEmail = 0,
        AwaitingPhone = 1,
    }

    private sealed class SignupDraft
    {
        public required TenantSignupStartRequest Form { get; init; }
        public required string Slug { get; init; }
        public SignupStage Stage { get; set; } = SignupStage.AwaitingEmail;
        public string Code = string.Empty;
        public int Attempts;

        /// <summary>Telefon kodunun gittiği kanal ("whatsapp"/"sms") — 2. adım yanıtında gösterilir.</summary>
        public string PhoneChannel = "sms";

        /// <summary>Kurum oluşturuldu mu? Aynı taslakla İKİNCİ kurum açılmasını engeller.</summary>
        public bool Completed;

        /// <summary>
        /// Kaç kez kod YENİDEN gönderildi + son gönderim anı.
        /// </summary>
        /// <remarks>
        /// Her gönderim e-posta/SMS demek, yani PARA. Frensiz bir "tekrar gönder" ucu, taslak
        /// elinde olan birinin sınırsız gönderim tetiklemesine izin verirdi; IP/e-posta kovaları
        /// saldırganın değiştirebildiği değerlere bağlı olduğu için tek başına yetmiyor.
        /// </remarks>
        public int Resends;
        public DateTime LastSentAtUtc;

        /// <summary>
        /// Tamamlanmış kaydın SONUCU — aynı istek tekrar gelirse aynı yanıt döner.
        /// </summary>
        /// <remarks>
        /// Kurum oluşturulup HTTP yanıtı yolda kaybolduğunda (ağ koptu, sekme kapandı) kullanıcı
        /// tekrar denerdi ve "zaten tamamlandı" hatası alırdı: hesabı açılmış ama geçici parolasını
        /// ve oturumunu HİÇ ÖĞRENEMEMİŞ olurdu — kurtarılamaz bir durum. Sonuç taslak ömrü boyunca
        /// saklanır; tekrar gelen istek onu aynen alır.
        /// </remarks>
        public TenantSignupCompletedResponse? Result;
    }

    private sealed class StartCounter
    {
        public int Count;
    }

    private static string DraftKey(string id) => $"tenant-signup:{id}";
    private static string ThrottleKey(string email) => $"tenant-signup-throttle:{email}";

    // ----------------------------------------------------------------- hazırlık

    public async Task<Result<TenantSignupReadinessDto>> GetReadinessAsync(CancellationToken ct = default)
    {
        var (email, phone) = await GetChannelsAsync(ct);
        // Kayıt İKİ faktör ister: e-posta + telefon. Biri yoksa akış tamamlanamaz, o yüzden
        // formu hiç göstermemek "kod gelmedi" diye bekleyen kullanıcıdan iyidir.
        return Result<TenantSignupReadinessDto>.Success(
            new TenantSignupReadinessDto(email, phone, email && phone));
    }

    /// <summary>Platformda e-posta ve telefon (WhatsApp ya da SMS) kanalları kurulu mu?</summary>
    private async Task<(bool Email, bool Phone)> GetChannelsAsync(CancellationToken ct)
    {
        var settings = await _messaging.GetSettingsAsync(ct);
        if (!settings.IsSuccess || settings.Value is null) return (false, false);
        var s = settings.Value;
        var email = s.EmailEnabled && s.EmailConfigured;
        // İKİNCİ FAKTÖR = TELEFON SAHİPLİĞİ, "WhatsApp" değil. WhatsApp kuruluysa oradan, değilse
        // SMS'ten gider. WhatsApp'a mahkûm etmek App Store 3.2.2(v) reddinin ta kendisiydi.
        var phone = (s.WhatsAppEnabled && s.WhatsAppConfigured) || (s.SmsEnabled && s.SmsConfigured);

        // Geliştirmede hiçbir sağlayıcı kurulu olmaz; simülasyon gerçek gönderimin yerine geçer ve
        // kod yanıtta döner. Aksi hâlde yerel geliştirmede kayıt akışı hiç denenemezdi.
        return email || phone || !_env.IsDevelopment ? (email, phone) : (true, true);
    }

    // ----------------------------------------------------------------- adım 1

    public async Task<Result<TenantSignupStartResponse>> StartAsync(TenantSignupStartRequest request, CancellationToken ct = default)
    {
        var form = new TenantSignupStartRequest(
            TenantName: TenantTextHelper.NormalizeText(request.TenantName),
            OwnerName: TenantTextHelper.NormalizeText(request.OwnerName),
            Email: TenantTextHelper.NormalizeEmail(request.Email),
            Phone: TenantTextHelper.NormalizeText(request.Phone),
            BranchName: TenantTextHelper.NormalizeText(request.BranchName),
            City: TenantTextHelper.NormalizeText(request.City));

        // TÜM ALANLAR ZORUNLU (kullanıcı isteği). Boş bırakılan alan sonradan platform ekibinin
        // telefonla tamamlaması gereken bir eksik kayıt üretiyordu.
        var missing = Validate(form);
        if (missing is not null) return Result<TenantSignupStartResponse>.Failure(Error.Validation(missing));

        var (emailReady, phoneReady) = await GetChannelsAsync(ct);
        if (!emailReady || !phoneReady)
        {
            _logger.LogError(
                "Kurum kaydı denendi ama kanallar eksik (e-posta:{Email}, telefon:{Phone}). " +
                "Platform → Sistem Ayarları → Mesajlaşma'dan SMTP ve SMS/WhatsApp kurun.",
                emailReady, phoneReady);
            return Result<TenantSignupStartResponse>.Failure(Error.Unauthorized(
                "Kayıt şu anda alınamıyor. Lütfen daha sonra tekrar deneyin ya da bizimle iletişime geçin."));
        }

        // E-posta bazlı fren: aynı adrese sınırsız kod isteme kapısını kapatır.
        var counter = _cache.GetOrCreate(ThrottleKey(form.Email), e =>
        {
            e.AbsoluteExpirationRelativeToNow = ThrottleWindow;
            return new StartCounter();
        })!;
        if (counter.Count >= MaxStartsPerWindow)
        {
            return Result<TenantSignupStartResponse>.Failure(Error.Unauthorized(
                "Bu e-posta için çok fazla kayıt denemesi yapıldı. Lütfen birkaç dakika sonra tekrar deneyin."));
        }
        counter.Count++;

        // MÜKERRER KAYIT KAPISI — kurum oluşturmadan ÖNCE. Burada geçse bile son adımda tekrar
        // kontrol edilir: iki kişi aynı anda başlarsa ikisi de bu noktayı geçebilir.
        // ENUMERASYON FRENİ: "e-posta kayıtlı" / "telefon kayıtlı" / "işletme adı alınmış" diye
        // AYRI mesajlar dönmek, anonim bir uçtan "bu kişi/işletme sistemde var mı?" sorusunu
        // cevaplanabilir hâle getiriyordu. Üç durumda da AYNI genel mesaj döner.
        if (await IsDuplicateAsync(form, ct))
        {
            return Result<TenantSignupStartResponse>.Failure(Error.Conflict(DuplicateMessage));
        }

        var slug = await AllocateSlugAsync(form.TenantName, ct);
        var draft = new SignupDraft { Form = form, Slug = slug };
        var code = NewCode();
        draft.Code = code;

        var signupId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        draft.LastSentAtUtc = _clock.UtcNow; // ilk gönderim de cooldown saatini başlatır
        _cache.Set(DraftKey(signupId), draft, DraftLifetime);

        var sent = await SendEmailCodeAsync(form, code, ct);
        if (!sent)
        {
            // Gönderilemediyse taslağı bırakmanın anlamı yok: kullanıcı asla kod alamayacak.
            _cache.Remove(DraftKey(signupId));
            return Result<TenantSignupStartResponse>.Failure(Error.Unauthorized(
                "Doğrulama e-postası gönderilemedi. E-posta adresinizi kontrol edip tekrar deneyin."));
        }

        return Result<TenantSignupStartResponse>.Success(new TenantSignupStartResponse(
            signupId,
            TenantTextHelper.MaskEmail(form.Email),
            _env.IsDevelopment ? code : null));
    }

    private static string? Validate(TenantSignupStartRequest f)
    {
        if (f.TenantName.Length < 2) return "İşletme adı zorunludur.";
        if (f.OwnerName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Length < 2)
            return "Yetkili adı ve soyadı birlikte yazılmalıdır.";
        if (!f.Email.Contains('@') || !f.Email.Contains('.')) return "Geçerli bir e-posta adresi girin.";
        if (!CustomerIdentityLookup.IsUsablePhone(f.Phone)) return "Geçerli bir telefon numarası girin (örn. 0555 123 45 67).";
        if (f.BranchName.Length < 2) return "Şube adı zorunludur.";
        if (f.City.Length < 2) return "Şehir zorunludur.";
        return null;
    }

    /// <summary>
    /// Mükerrer kayıt kontrolü — e-posta, telefon ve işletme adı.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden e-posta ve telefon farklı yollardan aranıyor?</b> <c>TenantUser.Email</c> düz metin
    /// saklanır, SQL'de eşitlikle aranabilir. <c>Tenant.Phone</c> ve <c>Tenant.Name</c> ise AES-GCM
    /// (rastgele nonce) ile şifrelidir: aynı düz metin her satırda farklı ciphertext ürettiği için
    /// <c>WHERE Phone = @p</c> HİÇBİR ZAMAN eşleşmez. Telefon bu yüzden blind index (HMAC)
    /// üzerinden aranır, işletme adı ise çözülmüş değerler üzerinde bellekte karşılaştırılır.
    /// </para>
    /// </remarks>
    private async Task<bool> IsDuplicateAsync(TenantSignupStartRequest form, CancellationToken ct)
    {
        // 1) Yetkili e-postası — düz kolon, SQL eşitliği güvenilir.
        if (await _db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(u => u.IsActive && u.Email == form.Email, ct))
        {
            return true;
        }

        // 2) Kurum telefonu — blind index ile aday, kesin eşitlik bellekte.
        var phoneKey = _search.BuildPhoneKey(form.Phone);
        if (phoneKey is not null)
        {
            var candidates = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.PhoneIndex == phoneKey)
                .Select(t => new { t.Phone, t.Status })
                .ToListAsync(ct);
            var wanted = PhoneMask.LoginKey(form.Phone);
            if (candidates.Any(c => c.Status != TenantStatus.Cancelled && PhoneMask.LoginKey(c.Phone) == wanted))
                return true;
        }

        // 3) İşletme adı — ŞİFRELİ olduğu için bellekte karşılaştırılır.
        //
        // ÖLÇEK NOTU: iptal edilmemiş kurum adları belleğe çekilir. Kurum sayısı binler
        // mertebesinde kaldığı sürece kabul edilebilir; on binleri geçerse ada da blind index
        // eklenmeli (telefonda yapıldığı gibi).
        var nameKey = NameKey(form.TenantName);
        var names = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Status != TenantStatus.Cancelled)
            .Select(t => t.Name)
            .ToListAsync(ct);
        return names.Any(n => NameKey(n) == nameKey);
    }

    /// <summary>İşletme adı karşılaştırma anahtarı: Türkçe harfler çevrilir, boşluk/simge atılır.</summary>
    private static string NameKey(string? name) =>
        TenantTextHelper.NormalizeSlug(name);

    /// <summary>Boş slug bulur: "guzel-salon", çakışırsa "guzel-salon-2", "-3", …</summary>
    private async Task<string> AllocateSlugAsync(string tenantName, CancellationToken ct)
    {
        var basis = TenantTextHelper.NormalizeSlug(tenantName);
        var taken = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Slug == basis || t.Slug.StartsWith(basis + "-"))
            .Select(t => t.Slug)
            .ToListAsync(ct);
        if (!taken.Contains(basis, StringComparer.OrdinalIgnoreCase)) return basis;

        for (var i = 2; i < 1000; i++)
        {
            var candidate = $"{basis}-{i}";
            if (!taken.Contains(candidate, StringComparer.OrdinalIgnoreCase)) return candidate;
        }
        // Pratikte ulaşılmaz; yine de çakışmayan bir değer döndür (UNIQUE indeks son kapı).
        return $"{basis}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant()}";
    }

    // ----------------------------------------------------------------- adım 2

    public async Task<Result<TenantSignupVerifyEmailResponse>> VerifyEmailAsync(TenantSignupVerifyEmailRequest request, CancellationToken ct = default)
    {
        var (draft, failure) = TakeDraft(request.SignupId, SignupStage.AwaitingEmail);
        if (failure is not null) return Result<TenantSignupVerifyEmailResponse>.Failure(failure);

        var check = CheckCode(draft!, request.Code, request.SignupId);
        if (check is not null) return Result<TenantSignupVerifyEmailResponse>.Failure(check);

        // E-posta doğrulandı → telefon adımına geç ve yeni kod üret.
        var code = NewCode();
        var (channel, sent) = await SendPhoneCodeAsync(draft!.Form, code, ct);
        if (!sent)
        {
            return Result<TenantSignupVerifyEmailResponse>.Failure(Error.Unauthorized(
                "Telefonunuza doğrulama kodu gönderilemedi. Numaranızı kontrol edip tekrar deneyin."));
        }

        draft.Stage = SignupStage.AwaitingPhone;
        draft.Code = code;
        draft.Attempts = 0;
        draft.PhoneChannel = channel;
        // Süreyi tazele: 2. adım için baştan 30 dakika.
        _cache.Set(DraftKey(request.SignupId), draft, DraftLifetime);

        return Result<TenantSignupVerifyEmailResponse>.Success(new TenantSignupVerifyEmailResponse(
            PhoneMask.Mask(draft.Form.Phone),
            channel,
            _env.IsDevelopment ? code : null));
    }

    // ----------------------------------------------------------------- adım 3

    public async Task<Result<TenantSignupCompletedResponse>> VerifyPhoneAsync(TenantSignupVerifyPhoneRequest request, CancellationToken ct = default)
    {
        var (draft, failure) = TakeDraft(request.SignupId, SignupStage.AwaitingPhone);
        if (failure is not null) return Result<TenantSignupCompletedResponse>.Failure(failure);

        var check = CheckCode(draft!, request.Code, request.SignupId);
        if (check is not null) return Result<TenantSignupCompletedResponse>.Failure(check);

        // TEK KULLANIM: aynı taslakla ikinci kurum açılamaz. Kod doğrulandıktan sonra kilitle;
        // eşzamanlı iki istek aynı taslağı görüp İKİ kurum oluşturabilirdi.
        lock (draft!)
        {
            if (draft.Completed)
            {
                // İDEMPOTENS: kurum zaten açıldı. Hata dönmek yerine AYNI yanıtı veririz —
                // yanıtı kaybolan kullanıcı geçici parolasını ve oturumunu böyle geri alır.
                return draft.Result is not null
                    ? Result<TenantSignupCompletedResponse>.Success(draft.Result)
                    : Result<TenantSignupCompletedResponse>.Failure(
                        Error.Conflict("Bu kayıt zaten tamamlandı. Giriş yapabilirsiniz."));
            }
            draft.Completed = true;
        }

        try
        {
            var result = await CreateTenantAsync(draft, ct);
            if (result.IsFailure)
            {
                // Oluşturma başarısızsa kilidi aç: kullanıcı düzeltip tekrar deneyebilsin.
                draft.Completed = false;
                _cache.Set(DraftKey(request.SignupId), draft, DraftLifetime);
                return result;
            }
            // Taslak SİLİNMEZ: tamamlanmış sonucu taşır (bkz. SignupDraft.Result). Aynı istek
            // tekrar gelirse yukarıdaki idempotens kapısı bu sonucu döndürür.
            draft.Result = result.Value;
            _cache.Set(DraftKey(request.SignupId), draft, DraftLifetime);
            return result;
        }
        catch
        {
            draft.Completed = false;
            _cache.Set(DraftKey(request.SignupId), draft, DraftLifetime);
            throw;
        }
    }

    /// <summary>
    /// Kurumu, şubesini, yöneticisini ve 14 günlük denemeyi oluşturur.
    /// </summary>
    /// <remarks>
    /// <para>
    /// DENEME SAYACI HEMEN BAŞLAR: kurum sahibi zaten bu akışın sonunda giriş yapıyor, dolayısıyla
    /// "ilk girişte başlat" (platform panelinden açılan kurumların davranışı) burada bir gün
    /// kaybettirmekten başka işe yaramaz.
    /// </para>
    /// <para>
    /// Kurum kodu UNIQUE ihlali alırsa bir sonraki numarayla yeniden denenir (bkz.
    /// <see cref="TenantCodeAllocator"/>).
    /// </para>
    /// </remarks>
    private async Task<Result<TenantSignupCompletedResponse>> CreateTenantAsync(SignupDraft draft, CancellationToken ct)
    {
        var form = draft.Form;

        // MÜKERRER KONTROLÜ TEKRAR: 1. adımdan bu yana (30 dk'ya kadar) başkası aynı e-posta ya da
        // telefonla kurum açmış olabilir. Tek kontrol 1. adımda kalırsa yarış açık kalır.
        if (await IsDuplicateAsync(form, ct))
        {
            return Result<TenantSignupCompletedResponse>.Failure(Error.Conflict(DuplicateMessage));
        }

        var plan = await ResolveTrialPlanAsync(ct);
        if (plan is null)
        {
            _logger.LogError("Kurum kaydı: atanacak abonelik paketi bulunamadı. Varsayılan planları oluşturun.");
            return Result<TenantSignupCompletedResponse>.Failure(Error.Unauthorized(
                "Kayıt şu anda tamamlanamıyor. Lütfen bizimle iletişime geçin."));
        }

        var now = _clock.UtcNow;
        var tempPassword = TenantTextHelper.GenerateTempPassword();

        for (var attempt = 0; attempt < MaxCodeAttempts; attempt++)
        {
            var code = await TenantCodeAllocator.NextAsync(_db, attempt, ct);
            var tenant = new Tenant(form.TenantName, draft.Slug, plan.Name, TenantStatus.Trial);
            tenant.AssignCode(code);
            tenant.MarkSelfSignup();
            tenant.SetProfile(null, form.OwnerName);
            tenant.SetContact(form.Phone, null);
            tenant.SetProfileExtras(null, null, form.Email);
            tenant.SetPhoneIndex(_search.BuildPhoneKey(form.Phone));
            tenant.AssignSubscriptionPlan(plan);
            // Sayaç ŞİMDİ başlar (yukarıdaki nota bakın).
            tenant.StartTrial(now, TrialDays);

            var branch = tenant.AddBranch(form.BranchName, form.City, isDefault: true);
            var owner = tenant.GrantAccess(form.Email, UserRole.InstitutionOwner, null, form.OwnerName);
            // Geçici parola + ilk girişte zorunlu değiştirme: parola PDF'e basılıp saklanıyor.
            owner.SetTemporaryPassword(_passwordHasher.Hash(tempPassword));

            _db.Tenants.Add(tenant);

            // TEKİLLİĞİN DB GARANTİSİ: uygulama içindeki mükerrer kontrolü eşzamanlı iki isteği
            // birlikte geçirebilir (ikisi de "kayıtlı değil" görür). Rezervasyon satırı kurumla
            // AYNI işlemde yazılır; yarışı kaybeden taraf UNIQUE ihlali alır ve temiz reddedilir.
            _db.TenantSignupReservations.Add(new TenantSignupReservation(
                tenant.Id, form.Email, _search.BuildPhoneKey(form.Phone) ?? PhoneMask.LoginKey(form.Phone)));

            // TEK YAZMA: kurum, şube, yönetici, oturum jetonu ve denetim kaydı AYNI SaveChanges'te
            // gider. Ayrı ayrı kaydedilseydi araya giren bir hata "kurumu var ama yöneticisi yok"
            // ya da "oturumu var ama kurumu yok" gibi girilemez bir durum bırakabilirdi.
            var session = BuildSession(tenant, owner, branch, now);
            await _audit.LogAsync(tenant.Id, branch.Id, "SelfSignup", "Tenant", tenant.Id,
                $"Kurum self-servis kayıtla oluşturuldu ({code}); {TrialDays} günlük deneme başladı.", null, ct);

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (TenantCodeAllocator.IsDuplicateCodeError(ex) && attempt < MaxCodeAttempts - 1)
            {
                // Eşzamanlı bir kayıt aynı numarayı aldı. Takılan varlıkları bırak ve sıradaki
                // numarayla baştan kur — aksi hâlde EF aynı Added grafiği yeniden göndermeye çalışır.
                _db.ChangeTracker.Clear();
                continue;
            }
            catch (Exception ex) when (IsReservationConflict(ex))
            {
                // Yarışı KAYBETTİK: aynı e-posta/telefonla başka bir kayıt milisaniyeler önce
                // tamamlandı. Kod çakışmasından farklı olarak yeniden denemenin anlamı yok —
                // ikinci deneme de aynı UNIQUE kısıtına takılır.
                _db.ChangeTracker.Clear();
                return Result<TenantSignupCompletedResponse>.Failure(Error.Conflict(DuplicateMessage));
            }

            var credentials = new TenantCredentialsDto(
                tenant.Id,
                form.OwnerName,
                form.Email,
                tempPassword,
                form.TenantName,
                form.BranchName,
                MustChangePassword: true,
                CreatedAtUtc: now);

            // Hoş geldin e-postası BEST-EFFORT: gönderilemezse kayıt geri alınmaz — kullanıcı
            // zaten ekranda parolasını ve PDF'ini görüyor.
            await SendWelcomeAsync(form, code, tempPassword, ct);

            _logger.LogInformation("Yeni kurum self-servis kayıtla oluşturuldu: {Code} ({Slug}).", code, draft.Slug);

            return Result<TenantSignupCompletedResponse>.Success(new TenantSignupCompletedResponse(
                code, tenant.ToDto(), credentials, session));
        }

        return Result<TenantSignupCompletedResponse>.Failure(Error.Conflict(
            "Kayıt şu anda tamamlanamadı (kurum kodu ayrılamadı). Lütfen tekrar deneyin."));
    }

    /// <summary>
    /// Bu hata rezervasyon (e-posta/telefon) UNIQUE ihlali mi?
    /// </summary>
    /// <remarks>
    /// Sağlayıcıya özel istisna tipine bağlanmak yerine mesaj taranır (bkz.
    /// <see cref="TenantCodeAllocator.IsDuplicateCodeError"/> ile aynı gerekçe). Kurum kodu
    /// çakışmasından AYRIŞTIRILIR: kod çakışması yeniden denenir, bu denenmez.
    /// </remarks>
    private static bool IsReservationConflict(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            if (e.Message.Contains("Duplicate entry", StringComparison.OrdinalIgnoreCase)
                && (e.Message.Contains("EmailKey", StringComparison.OrdinalIgnoreCase)
                    || e.Message.Contains("PhoneKey", StringComparison.OrdinalIgnoreCase)))
                return true;
            if (e.InnerException is null) break;
        }
        return false;
    }

    /// <summary>
    /// Denemeye atanacak paket.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>EN ZAYIF PAKET DEĞİL.</b> Deneme sürümünün amacı ürünü göstermektir; en düşük
    /// <c>DisplayOrder</c>'lı paket (Başlangıç) seçilirse kullanıcı 14 gün boyunca raporları,
    /// WhatsApp'ı, adisyonu ve çok şubeyi göremez — yani denemenin satın alma kararına etkisi
    /// olacak her özelliği kapalı bulur.
    /// </para>
    /// <para>
    /// Varsayılan: <c>TenantSignup:TrialPlanKey</c> (yoksa "Premium"). Bulunamazsa en YÜKSEK
    /// sıradaki aktif pakete düşer. Paket hiç atanmazsa canlıda her özellik kapanır (feature
    /// gating plansız kurumda fail-closed çalışır) — o yüzden null dönmek kayıt akışını durdurur.
    /// </para>
    /// </remarks>
    private async Task<SubscriptionPlan?> ResolveTrialPlanAsync(CancellationToken ct)
    {
        var preferred = string.IsNullOrWhiteSpace(_trialPlanKey) ? "Premium" : _trialPlanKey!.Trim();
        var byKey = await _db.SubscriptionPlans
            .FirstOrDefaultAsync(p => p.IsActive && p.PlanKey == preferred, ct);
        if (byKey is not null) return byKey;

        return await _db.SubscriptionPlans
            .Where(p => p.IsActive)
            .OrderByDescending(p => p.DisplayOrder)
            .FirstOrDefaultAsync(ct);
    }

    /// <summary>
    /// Kurum sahibi için oturum üretir (kayıt sonunda doğrudan panele girebilsin).
    /// </summary>
    /// <remarks>
    /// Refresh token satırı çağıranın SaveChanges'iyle birlikte yazılır; burada ayrıca kaydetmez.
    /// Kendi başına kaydetseydi, sonrasında bir hata olsa bile ortada geçerli bir oturum kalırdı.
    /// </remarks>
    private LoginResponse BuildSession(Tenant tenant, TenantUser owner, Branch branch, DateTime now)
    {
        var profile = new UserProfileDto(
            owner.Id, owner.Email, owner.FullName, UserRole.InstitutionOwner,
            tenant.Id, branch.Id, Array.Empty<string>(), owner.MustChangePassword);

        var refreshToken = _tokenService.CreateRefreshToken();
        _db.RefreshTokens.Add(new RefreshToken(owner.Id, _tokenService.HashRefreshToken(refreshToken), now.AddDays(14)));

        var expiresAt = now.AddMinutes(60);
        return new LoginResponse(_tokenService.CreateAccessToken(profile, expiresAt), refreshToken, expiresAt, profile);
    }

    // ----------------------------------------------------------------- yeniden gönder

    public async Task<Result<object>> ResendAsync(string signupId, CancellationToken ct = default)
    {
        if (!_cache.TryGetValue<SignupDraft>(DraftKey(signupId), out var draft) || draft is null)
            return Result<object>.Failure(Error.Unauthorized("Kayıt oturumunuz sona ermiş. Lütfen baştan başlayın."));
        if (draft.Completed)
            return Result<object>.Failure(Error.Conflict("Bu kayıt zaten tamamlandı."));

        // MALİYET FRENİ. Her gönderim e-posta/SMS, yani para. İki kapı birden:
        //   1) iki istek arasında en az ResendCooldown,
        //   2) taslak başına en çok MaxResendsPerDraft.
        // IP ve e-posta kovaları saldırganın DEĞİŞTİREBİLDİĞİ değerlere bağlı; taslak kimliği
        // sunucu tarafından üretildiği için bu fren atlatılamaz.
        var now = _clock.UtcNow;
        lock (draft)
        {
            if (draft.Resends >= MaxResendsPerDraft)
            {
                return Result<object>.Failure(Error.Unauthorized(
                    "Kod tekrar gönderme sınırına ulaşıldı. Lütfen baştan başlayın."));
            }

            var elapsed = now - draft.LastSentAtUtc;
            if (draft.LastSentAtUtc != default && elapsed < ResendCooldown)
            {
                var wait = (int)Math.Ceiling((ResendCooldown - elapsed).TotalSeconds);
                return Result<object>.Failure(Error.Unauthorized(
                    $"Yeni kod istemek için {wait} saniye bekleyin."));
            }

            // Sayaç ve zaman GÖNDERİMDEN ÖNCE işlenir: gönderim yavaşsa aradaki pencerede
            // gelen ikinci istek de aynı frene takılsın.
            draft.Resends++;
            draft.LastSentAtUtc = now;
        }

        var code = NewCode();
        bool sent;
        if (draft.Stage == SignupStage.AwaitingEmail)
        {
            sent = await SendEmailCodeAsync(draft.Form, code, ct);
        }
        else
        {
            var (channel, ok) = await SendPhoneCodeAsync(draft.Form, code, ct);
            draft.PhoneChannel = channel;
            sent = ok;
        }

        if (!sent) return Result<object>.Failure(Error.Unauthorized("Kod gönderilemedi. Lütfen tekrar deneyin."));

        draft.Code = code;
        draft.Attempts = 0;
        _cache.Set(DraftKey(signupId), draft, DraftLifetime);

        return Result<object>.Success(new
        {
            message = "Yeni doğrulama kodu gönderildi.",
            remaining = MaxResendsPerDraft - draft.Resends,
            devCode = _env.IsDevelopment ? code : null,
        });
    }

    // ----------------------------------------------------------------- ortak

    private static string NewCode() => RandomNumberGenerator.GetInt32(100000, 1000000).ToString();

    private (SignupDraft? Draft, Error? Failure) TakeDraft(string signupId, SignupStage expected)
    {
        if (string.IsNullOrWhiteSpace(signupId) || !_cache.TryGetValue<SignupDraft>(DraftKey(signupId), out var draft) || draft is null)
            return (null, Error.Unauthorized("Kayıt oturumunuz sona ermiş. Lütfen baştan başlayın."));
        // Completed taslak BURADA elenmez: VerifyPhoneAsync onu idempotens için kullanıyor.
        // (Diğer adımlar aşağıdaki aşama kontrolüne takılır.)
        if (draft.Completed && expected != SignupStage.AwaitingPhone)
            return (null, Error.Conflict("Bu kayıt zaten tamamlandı. Giriş yapabilirsiniz."));
        if (draft.Stage != expected)
            return (null, Error.Validation("Kayıt adımları sırayla tamamlanmalı. Sayfayı yenileyip tekrar deneyin."));
        return (draft, null);
    }

    /// <summary>Kodu doğrular. Yanlışsa deneme sayacını artırır; 5 yanlışta taslak silinir.</summary>
    private Error? CheckCode(SignupDraft draft, string? code, string signupId)
    {
        lock (draft)
        {
            if (draft.Attempts >= MaxAttempts)
            {
                _cache.Remove(DraftKey(signupId));
                return Error.Unauthorized("Çok fazla yanlış deneme. Lütfen baştan başlayın.");
            }
            if (!string.Equals(draft.Code, code?.Trim(), StringComparison.Ordinal))
            {
                draft.Attempts++;
                if (draft.Attempts >= MaxAttempts) _cache.Remove(DraftKey(signupId));
                return Error.Unauthorized("Kod hatalı. Tekrar deneyin.");
            }
            return null;
        }
    }

    private async Task<bool> SendEmailCodeAsync(TenantSignupStartRequest form, string code, CancellationToken ct)
    {
        var body =
            $"<div style='font-family:sans-serif;font-size:15px;color:#2f1724'>" +
            $"<p>Merhaba {System.Net.WebUtility.HtmlEncode(form.OwnerName)},</p>" +
            $"<p><b>{System.Net.WebUtility.HtmlEncode(form.TenantName)}</b> için BeautyAsist kaydınızı tamamlamak üzeresiniz. " +
            $"E-posta doğrulama kodunuz:</p>" +
            $"<p style='font-size:30px;font-weight:700;letter-spacing:8px;color:#c85776'>{code}</p>" +
            $"<p>Kod 30 dakika geçerlidir. Bu işlemi siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.</p></div>";

        return await TrySendAsync(() => _messaging.SendEmailAsync(form.Email, "BeautyAsist kayıt doğrulama kodunuz", body, ct), "e-posta");
    }

    /// <summary>
    /// Telefon kodunu gönderir: WhatsApp kuruluysa oradan, değilse SMS. Kullanılan kanalı döner.
    /// </summary>
    private async Task<(string Channel, bool Sent)> SendPhoneCodeAsync(TenantSignupStartRequest form, string code, CancellationToken ct)
    {
        var message = $"BeautyAsist kayıt doğrulama kodunuz: {code}. Kod 30 dakika geçerlidir. Kimseyle paylaşmayın.";
        var settings = await _messaging.GetSettingsAsync(ct);
        var s = settings.Value;
        var whatsAppFirst = s is not null && s.WhatsAppEnabled && s.WhatsAppConfigured;

        if (whatsAppFirst && await TrySendAsync(() => _messaging.SendWhatsAppAsync(form.Phone, message, ct), "WhatsApp"))
            return ("whatsapp", true);
        if (await TrySendAsync(() => _messaging.SendSmsAsync(form.Phone, message, ct), "SMS"))
            return ("sms", true);
        // WhatsApp önce denenmediyse (kurulu değil) ama SMS de olmadıysa son şans WhatsApp.
        if (!whatsAppFirst && await TrySendAsync(() => _messaging.SendWhatsAppAsync(form.Phone, message, ct), "WhatsApp"))
            return ("whatsapp", true);
        return ("sms", false);
    }

    /// <summary>
    /// Gönderimi dener. <b>Simülasyon teslimat sayılmaz</b> — sağlayıcı yapılandırılmadığında
    /// PlatformMessagingService "başarılı ama simulated" döner; bunu teslimat saymak kullanıcıya
    /// "kod gönderildi" deyip hiç göndermemek olurdu. Geliştirmede simülasyon tek yoldur.
    /// </summary>
    private async Task<bool> TrySendAsync(Func<Task<MessagingTestResult>> send, string channel)
    {
        try
        {
            var result = await send();
            if (result.Success && (!result.Simulated || _env.IsDevelopment)) return true;
            _logger.LogWarning("Kurum kaydı {Channel} gönderimi başarısız: {Error}",
                channel, result.Error ?? (result.Simulated ? "sağlayıcı yapılandırılmamış (simülasyon)" : "bilinmeyen hata"));
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Kurum kaydı {Channel} gönderiminde hata.", channel);
            return false;
        }
    }

    /// <summary>Hoş geldin e-postası — kurum kodu + giriş bilgileri (best-effort).</summary>
    private async Task SendWelcomeAsync(TenantSignupStartRequest form, string tenantCode, string password, CancellationToken ct)
    {
        var body =
            $"<div style='font-family:sans-serif;font-size:15px;color:#2f1724'>" +
            $"<p>Merhaba {System.Net.WebUtility.HtmlEncode(form.OwnerName)},</p>" +
            $"<p><b>{System.Net.WebUtility.HtmlEncode(form.TenantName)}</b> için BeautyAsist hesabınız hazır. " +
            $"{TrialDays} günlük ücretsiz denemeniz başladı.</p>" +
            $"<table style='border-collapse:collapse;margin:16px 0'>" +
            $"<tr><td style='padding:4px 12px 4px 0;color:#7c6170'>Kurum kodu</td><td style='font-weight:700'>{tenantCode}</td></tr>" +
            $"<tr><td style='padding:4px 12px 4px 0;color:#7c6170'>E-posta</td><td>{System.Net.WebUtility.HtmlEncode(form.Email)}</td></tr>" +
            $"<tr><td style='padding:4px 12px 4px 0;color:#7c6170'>Geçici şifre</td><td style='font-weight:700;letter-spacing:1px'>{System.Net.WebUtility.HtmlEncode(password)}</td></tr>" +
            $"</table>" +
            $"<p>İlk girişte şifrenizi değiştirmeniz istenecek. Destek almak için <b>kurum kodunuzu</b> ({tenantCode}) belirtmeniz yeterlidir.</p></div>";

        await TrySendAsync(() => _messaging.SendEmailAsync(form.Email, $"BeautyAsist hesabınız hazır ({tenantCode})", body, ct), "hoş geldin e-postası");
    }
}

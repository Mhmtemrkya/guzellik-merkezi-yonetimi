using System.Security.Cryptography;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using GuzellikMerkezi.Application.Abstractions;
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
/// Doğrulama kodunun gönderileceği kanal.
///
/// <para>
/// <b>WhatsApp TEK KANAL DEĞİLDİR.</b> App Store 3.2.2(v) reddi tam olarak bunu söyledi: uygulama
/// müşteri girişini WhatsApp kullanıcılarıyla sınırlıyordu. Kod artık SMS ya da kayıtlı e-posta
/// adresine de gönderilebilir; WhatsApp yalnızca seçeneklerden biridir.
/// </para>
///
/// <para>
/// <c>Auto = 0</c> ESKİ İSTEMCİLER İÇİNDİR: alanı hiç göndermeyen sürümler 0'a düşer ve sunucu
/// bugünkü davranışı (önce WhatsApp) korur.
/// </para>
/// </summary>
public enum CustomerOtpChannel
{
    Auto = 0,
    WhatsApp = 1,
    Sms = 2,
    Email = 3,
}

/// <summary>Platformda hangi kanallar gerçekten çalışıyor? (İstemci yalnız çalışanları göstersin.)</summary>
public sealed record CustomerOtpChannelAvailability(bool WhatsApp, bool Sms, bool Email)
{
    public bool Any => WhatsApp || Sms || Email;
}

/// <summary>
/// Müşteri OTP girişi/kaydı — portalın TEK kimlik kapısı.
///
/// <para>
/// Eskiden <c>/customer/login</c> ve <c>/customer/register</c> uçları OTP'siz token üretiyordu; OTP
/// paralel bir "isteğe bağlı" özellikti. Telefonu bilinen bir müşterinin hesabı böylece ele
/// geçirilebiliyordu. Artık token YALNIZ buradan, kullanıcının bir iletişim kanalına gönderilen kod
/// doğrulandıktan sonra üretilir.
/// </para>
///
/// <para>
/// <b>Kimlik = ad soyad + telefon.</b> Doğum tarihi kimlikten ÇIKARILDI (App Store 5.1.1(v)):
/// randevu almak için doğum tarihi gerekmez, dolayısıyla zorunlu tutulamaz. Güvenliği taşıyan şey
/// zaten doğum tarihi değil, kodun gittiği kanalın sahipliğidir.
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

    /// <summary>
    /// Kimlik eşleşse de eşleşmese de dönen YANIT AYNIDIR — "bu numara kayıtlı mı" sorusu
    /// bu uçtan cevaplanamaz.
    /// </summary>
    private const string GenericSentMessage =
        "Bilgileriniz kayıtlarımızla eşleşiyorsa doğrulama kodunuz gönderildi. Kod 5 dakika geçerlidir.";

    private readonly GuzellikDbContext _db;
    private readonly IOtpStateStore _store;
    private readonly IPlatformMessagingService _messaging;
    private readonly IAuthService _auth;
    private readonly ISearchIndexService _search;
    private readonly IHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<CustomerOtpService> _logger;

    /// <summary>
    /// MAĞAZA İNCELEME HESABI — App Store / Play Store denetçileri için.
    /// <para>
    /// Denetçiler uygulamayı test ederken ne SMS ne WhatsApp ne de e-posta ALABİLİR; hesap açamayınca
    /// uygulama reddedilir (App Store 2.1 "Information Needed"). Bu yüzden yalnızca BU telefon
    /// numarası için kod rastgele üretilmez ve gönderilmez: sabit kod kullanılır. Denetçiye bu
    /// bilgiler mağaza panelindeki "demo hesap" alanından verilir.
    /// </para>
    /// <para>
    /// DOĞRULAMANIN GERİ KALANI AYNEN GEÇERLİDİR: kimlik eşleşmesi (ad soyad), tek kullanım, deneme
    /// freni, istek freni. Yani bu, "OTP'yi kapatmak" DEĞİLDİR — gerçek müşterilerin verisi
    /// korunmaya devam eder.
    /// </para>
    /// <para>
    /// Tanımsızsa (varsayılan) özellik tamamen KAPALIDIR. İnceleme bitince config'ten kaldırın.
    /// </para>
    /// </summary>
    private readonly string? _demoPhoneKey;
    private readonly string? _demoCode;

    public CustomerOtpService(
        GuzellikDbContext db,
        IOtpStateStore store,
        IPlatformMessagingService messaging,
        IAuthService auth,
        ISearchIndexService search,
        IHostEnvironment env,
        IConfiguration configuration,
        ILogger<CustomerOtpService> logger)
    {
        _db = db;
        _store = store;
        _messaging = messaging;
        _auth = auth;
        _search = search;
        _env = env;
        _config = configuration;
        _logger = logger;

        // Tek yapılandırma bloğu: AppReview:* (inceleme hesabı kurucusuyla aynı anahtarlar).
        // Eski CustomerOtp:StoreReview* anahtarları geriye dönük çalışmaya devam eder.
        //
        // ?? KULLANILMAZ: IConfiguration, ANAHTARI VAR AMA DEĞERİ BOŞ olan ayar için null değil ""
        // döndürür. appsettings.example.json hâlâ `"StoreReviewPhone": ""` gönderdiği için `??`
        // yeni anahtara HİÇ düşmezdi: örnekten kopyalanmış her kurulumda kısayol sessizce KAPALI
        // kalır, denetçi kod isteyip hiç alamaz ve uygulama yine 2.1'den reddedilir.
        var phone = FirstNonEmpty(configuration["CustomerOtp:StoreReviewPhone"], configuration["AppReview:CustomerPhone"]);
        var code = FirstNonEmpty(configuration["CustomerOtp:StoreReviewCode"], configuration["AppReview:CustomerOtpCode"]);

        // TEK ANAHTARLA KAPANIR. Eskiden kısayol yalnızca telefon+kod alanlarına bakıyordu:
        // inceleme bitince "AppReview:Enabled=false" yapmak SABİT KODU KAPATMIYORDU, çünkü
        // telefon/kod satırları config'te unutulmuş hâlde kalıyordu. Artık Enabled açıkça true
        // değilse kısayol devre dışıdır — bayrağı kapatmak tek başına yeterli.
        //
        // GERİYE DÖNÜK: eski kurulumlar yalnız CustomerOtp:StoreReview* kullanıyor ve Enabled
        // anahtarını hiç tanımıyor. O yapılandırmada bayrak ARANMAZ; yeni AppReview bloğu
        // kullanılıyorsa bayrak zorunludur.
        var usesNewBlock = !string.IsNullOrWhiteSpace(configuration["AppReview:CustomerPhone"])
            || !string.IsNullOrWhiteSpace(configuration["AppReview:CustomerOtpCode"]);
        var reviewEnabled = bool.TryParse(configuration["AppReview:Enabled"], out var flag) && flag;
        if (usesNewBlock && !reviewEnabled)
        {
            phone = null;
            code = null;
            _logger.LogInformation(
                "AppReview:CustomerPhone/CustomerOtpCode tanımlı ama AppReview:Enabled=false — " +
                "mağaza inceleme kısayolu KAPALI.");
        }

        // İkisi de dolu olmadan devreye girmez; yarım yapılandırma sessizce "açık" sayılmasın.
        if (!string.IsNullOrWhiteSpace(phone) && !string.IsNullOrWhiteSpace(code?.Trim()))
        {
            _demoPhoneKey = PhoneMask.LoginKey(phone);
            _demoCode = code!.Trim();
            _logger.LogWarning(
                "MAĞAZA İNCELEME HESABI AÇIK: {Phone} numarası için sabit doğrulama kodu kullanılıyor. " +
                "İnceleme bittiğinde AppReview:CustomerPhone/CustomerOtpCode ayarlarını KALDIRIN.",
                PhoneMask.Mask(phone));
        }
    }

    /// <summary>İlk DOLU değer. Boş string bir "değer" değildir — bkz. ctor'daki not.</summary>
    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    /// <summary>Bu telefon mağaza inceleme hesabı mı? (yapılandırılmadıysa her zaman false)</summary>
    private bool IsStoreReviewPhone(string phoneKey) =>
        _demoPhoneKey is not null && string.Equals(phoneKey, _demoPhoneKey, StringComparison.Ordinal);

    /// <summary>
    /// Kod kaydı. <b>Alanlar değil PROPERTY:</b> <see cref="System.Text.Json"/> alanları
    /// serileştirmez; alan olarak bırakılsalardı Redis'e yazılan kayıt geri okunduğunda her şey
    /// varsayılana döner ve hiçbir kod doğrulanamazdı. <c>internal</c>: serileştirici erişebilmeli.
    /// </summary>
    /// <summary>
    /// Doğrulama kararı — kilit ALTINDA verilir, kilit DIŞINDA uygulanır.
    /// <see cref="Entry"/> doluysa kod kabul edilmiştir ve kayıt zaten silinmiştir.
    /// </summary>
    private sealed record VerifyDecision(OtpEntry? Entry, string? Failure)
    {
        public static VerifyDecision Ok(OtpEntry entry) => new(entry, null);
        public static VerifyDecision Fail(string message) => new(null, message);
    }

    internal sealed class OtpEntry
    {
        public string Code { get; set; } = string.Empty;

        /// <summary>
        /// Kodun ÜRETİLDİĞİ kimlik (ad soyad + telefon anahtarı). Önbellek anahtarı yalnız telefondan
        /// türediği için, aynı telefonun birden çok müşteri kaydında kullanıldığı durumda A kimliği
        /// için istenen kod B kimliğiyle doğrulanabiliyordu. Kod artık kimliğine bağlıdır.
        /// </summary>
        public string Identity { get; set; } = string.Empty;

        /// <summary>
        /// Kod HANGİ kanaldan gitti? Kayıt akışında hayati: e-postaya giden kod telefon sahipliğini
        /// KANITLAMAZ, dolayısıyla o numaraya ait mevcut hesabı sahiplenmek için kullanılamaz.
        /// </summary>
        public CustomerOtpChannel Channel { get; set; } = CustomerOtpChannel.WhatsApp;

        /// <summary>E-posta kanalında kodun gittiği adres (kayıt akışında kanıt olarak taşınır).</summary>
        public string? Target { get; set; }

        /// <summary>
        /// KAYITTA İKİNCİ AŞAMA: SMS doğrulandıktan sonra e-posta kodu beklenir.
        /// </summary>
        /// <remarks>
        /// Kayıt iki kanalı da doğrular: telefon (hesabın kimliği + bildirimler) ve e-posta
        /// (bir sonraki girişin kodu oraya gidecek). E-posta doğrulanmadan hesap açılsaydı,
        /// yanlış yazılmış bir adres kullanıcıyı ilk girişte kilitlerdi.
        /// </remarks>
        public bool AwaitingEmailStage { get; set; }

        /// <summary>Kayıt akışında 2. aşamada doğrulanacak e-posta adresi.</summary>
        public string? PendingEmail { get; set; }

        /// <summary>1. aşamada doğrulanan telefon — 2. aşamada kayıt bununla açılır.</summary>
        public bool PhoneProven { get; set; }

        public int Attempts { get; set; }

        /// <summary>
        /// Kod tüketildi mi. Eşzamanlı iki DOĞRU doğrulama, silme gerçekleşmeden ikisi de kaydı
        /// okuyup iki ayrı oturum açabiliyordu; bayrak kilit altında işaretlenir.
        /// </summary>
        public bool Consumed { get; set; }
    }

    private static string CacheKey(string loginKey, CustomerOtpPurpose purpose) => $"customer-otp:{purpose}:{loginKey}";
    private static string ThrottleKey(string loginKey) => $"customer-otp-throttle:{loginKey}";

    /// <summary>Kodun bağlandığı kimlik — ad (normalize) + telefon anahtarı.</summary>
    private static string IdentityOf(string? fullName, string? phone) =>
        $"{CustomerIdentityLookup.NormalizeName(fullName)}|{PhoneMask.LoginKey(phone)}";

    // ------------------------------------------------------------------ kanal durumu

    /// <summary>
    /// Platformda hangi kanalların gerçekten yapılandırıldığı. KİMLİKTEN BAĞIMSIZDIR — bu yüzden
    /// istemciye açıkça söylenebilir ve "bu numara kayıtlı mı" sorusunu cevaplamaz.
    /// </summary>
    public async Task<CustomerOtpChannelAvailability> GetAvailableChannelsAsync(CancellationToken ct)
    {
        var settings = await _messaging.GetSettingsAsync(ct);
        if (!settings.IsSuccess || settings.Value is null)
            return new CustomerOtpChannelAvailability(false, false, false);

        var s = settings.Value;
        var available = new CustomerOtpChannelAvailability(
            WhatsApp: s.WhatsAppEnabled && s.WhatsAppConfigured,
            Sms: s.SmsEnabled && s.SmsConfigured,
            Email: s.EmailEnabled && s.EmailConfigured);

        // Geliştirme ortamında hiçbir sağlayıcı kurulu olmaz; simülasyon gerçek gönderim yerine geçer,
        // kod zaten yanıtta döner. Aksi hâlde yerel geliştirmede giriş akışı hiç çalışmazdı.
        return available.Any || !_env.IsDevelopment()
            ? available
            : new CustomerOtpChannelAvailability(true, true, true);
    }

    /// <summary>
    /// Kod üretir ve seçilen kanaldan gönderir.
    /// <para>
    /// GİRİŞ akışında kod yalnız kimlik (ad soyad + telefon) eşleşirse üretilir; KAYIT akışında kanal
    /// sahipliğini kanıtlamak için her hâlükârda üretilir. Yanıt iki durumda da AYNIDIR — hesap
    /// var/yok bilgisi sızmaz.
    /// </para>
    /// </summary>
    /// <param name="email">
    /// KAYIT akışında kodun gönderileceği e-posta.
    /// <para>
    /// GİRİŞTE ise KİMLİK DOĞRULAYICIDIR: kullanıcının yazdığı adres, müşterinin kurum
    /// kayıtlarındaki adresle eşleşmek zorundadır ve kod her hâlükârda KAYITTAKİ adrese gider.
    /// Ad + telefon gizli bilgi olmadığı için üçüncü faktör olarak bu şart aranır.
    /// </para>
    /// </param>
    public async Task<Result<object>> RequestAsync(
        CustomerLoginRequest request,
        string? email,
        CustomerOtpPurpose purpose,
        CustomerOtpChannel channel,
        CancellationToken ct)
    {
        // AKIŞ KANALINA SUNUCU KARAR VERİR (kullanıcı isteği); istemciden gelen seçim EZİLİR.
        // Seçim istemciye bırakılsaydı eski bir sürüm ya da elle kurulmuş bir istek akışın
        // kuralını atlayabilirdi. Karar kanal DURUMU bilindikten sonra veriliyor (aşağıda).
        var key = PhoneMask.LoginKey(request.Phone);
        var name = CustomerIdentityLookup.NormalizeName(request.FullName);
        if (key.Length < 10 || name.Length == 0)
            return Result<object>.Failure(Error.Validation("Ad soyad ve telefon numarası zorunludur."));

        // Telefon bazlı fren — IP'den bağımsız çalışır. Artırım ATOMİKTİR: oku-artır-yaz üç ayrı
        // adım olsaydı eşzamanlı istekler aynı değeri okuyup sınırı delerdi. Depo Redis ise sayaç
        // instance'lar arasında ORTAKTIR (aksi hâlde sınır instance sayısıyla çarpılırdı).
        var requestCount = await _store.IncrementAsync(ThrottleKey(key), RequestWindow, ct);
        if (requestCount > MaxRequestsPerWindow)
        {
            return Result<object>.Failure(Error.Unauthorized(
                "Bu numara için çok fazla kod istendi. Lütfen birkaç dakika sonra tekrar deneyin."));
        }

        // KİMLİKTEN ÖNCE kanal kontrolü: platformda hiçbir kanal yoksa bu, kullanıcının kim olduğuyla
        // ilgisi olmayan bir yapılandırma hatasıdır. Burada hata dönmek sızıntı yaratmaz — ama
        // "kod gönderildi" deyip hiç göndermemek kullanıcıyı çıkışsız bırakır.
        var availability = await GetAvailableChannelsAsync(ct);
        if (!availability.Any)
        {
            _logger.LogError("Müşteri OTP: platformda tanımlı gönderim kanalı yok (SMS/e-posta/WhatsApp kapalı).");
            return Result<object>.Failure(Error.Unauthorized(
                "Doğrulama kodu şu anda gönderilemiyor. Lütfen daha sonra tekrar deneyin ya da kurumunuzla iletişime geçin."));
        }

        // ═══ KANAL KARARI ════════════════════════════════════════════════════════════════
        //   KAYIT  → telefon (SMS/WhatsApp). Amaç numaranın gerçekten kişiye ait olduğunu
        //            kanıtlamak; hesap bu numarayla açılıyor ve randevu bildirimleri oraya gider.
        //   GİRİŞ  → e-posta. Kayıtlı kullanıcı her girişte SMS harcamaz (maliyet), üstelik
        //            e-posta kutusu telefon hattından daha kalıcı bir kimliktir.
        //
        // TELEFON KANALI HİÇ YOKSA KAYIT E-POSTAYA DÜŞER. SMS sağlayıcısı hazır değilken ve
        // WhatsApp platformda bağlı değilken telefon adımı ASLA tamamlanamaz — kayıt tümüyle
        // kapanırdı. Böyle bir durumda kod doğrudan kullanıcının yazdığı adrese gider ve telefon
        // KANITLANMAMIŞ sayılır (PhoneProven = false).
        //
        // BU BİR GÜVENLİK GEVŞEMESİ DEĞİLDİR: AuthService.CustomerRegisterAsync telefonu
        // kanıtlanmamış kaydı ayrı ele alır — o numaraya ait BAŞKA bir hesap varsa kayıt
        // reddedilir ve kullanıcıdan telefon kodu istenir. Yani e-posta yolu yalnızca YENİ hesap
        // açabilir, var olan bir hesabı asla devralamaz.
        var phoneChannelsReady = availability.Sms || availability.WhatsApp;
        var registerViaEmailOnly = purpose == CustomerOtpPurpose.Register && !phoneChannelsReady;
        channel = purpose == CustomerOtpPurpose.Register && phoneChannelsReady
            ? CustomerOtpChannel.Sms
            : CustomerOtpChannel.Email;

        // MAĞAZA İNCELEME HESABI kimlik bloğundan ÖNCE belirlenir: e-posta eşleşmesi şartı bu
        // hesaba uygulanamaz (denetçinin kurum kayıtlarındaki adresi bilmesi beklenemez ve zaten
        // hiçbir kanaldan kod almaz). Kayıt VARLIĞI şartı yine de korunur — aşağıya bakın.
        var isReview = IsStoreReviewPhone(key);

        // Kimlik eşleşmesi: girişte zorunlu, kayıtta aranmaz (kanal sahipliği kanıtlanacak).
        string? emailTarget = CustomerIdentityLookup.NormalizeEmail(email);
        if (emailTarget.Length == 0) emailTarget = null;

        // Telefonsuz kayıt yolunda e-posta TEK kanıttır; boşsa kullanıcı hiçbir kod alamaz ve
        // "kod gönderildi" diyen genel yanıt onu sessizce çıkmaza sokardı. KAYIT akışında adres
        // zaten kullanıcının kendi yazdığı değerdir — söylemek bir hesabı ele vermez.
        if (registerViaEmailOnly && emailTarget is null)
        {
            return Result<object>.Failure(Error.Validation(
                "E-posta adresi zorunludur; doğrulama kodu bu adrese gönderilecek."));
        }
        // E-posta şablonunun başlığındaki kurum adı — ancak kimlik EŞLEŞTİĞİNDE bilinir.
        // Eşleşmeyen istekte null kalır; zaten o durumda kod hiç üretilmez.
        string? tenantName = null;
        var shouldSend = purpose == CustomerOtpPurpose.Register;
        if (!shouldSend)
        {
            var submitted = emailTarget;
            var candidates = await CustomerIdentityLookup.FindByPhoneAsync(
                _db.Customers.IgnoreQueryFilters().AsNoTracking(), _search, request.Phone, ct);
            var matches = CustomerIdentityLookup.WithName(candidates, request.FullName);

            // ════════════════════════════════════════════════════════════════════════════════
            // E-POSTA BİR KİMLİK DOĞRULAYICIDIR — TESLİMAT HEDEFİ DEĞİL.
            //
            // Kod, kullanıcının YAZDIĞI adrese değil, müşterinin KURUM KAYITLARINDAKİ adresine
            // gider. Bu ayrım güvenliğin tamamıdır ve "sadeleştirme" adına asla kaldırılmamalıdır:
            // yazılan adrese gönderilseydi, bir müşterinin adını ve telefonunu bilen herkes
            // (randevu kartı, sosyal medya, sızmış liste) kendi e-postasını yazıp o hesabın
            // kodunu alır ve hesabı devralırdı. Ad + telefon GİZLİ BİLGİ DEĞİLDİR; bu yüzden
            // üçüncü faktör olarak kayıttaki adresin BİLİNMESİ şartı aranır.
            //
            // Eşleşmezse yanıt, kaydı hiç bulunmayan kullanıcınınkiyle AYNI kalır (aşağıdaki
            // GenericSentMessage + önbelleğe yazmama deseni). Farklı yanıt vermek "bu ad+telefon
            // kayıtlı ama e-posta yanlış" bilgisini sızdırır ve bu dosyanın baştan sona kaçınmak
            // için kurulduğu enumerasyon kapısını açardı.
            // ════════════════════════════════════════════════════════════════════════════════
            var matched = matches.FirstOrDefault(c =>
                !string.IsNullOrWhiteSpace(c.Email) &&
                submitted is not null &&
                string.Equals(c.Email, submitted, StringComparison.OrdinalIgnoreCase));

            // İnceleme hesabında e-posta faktörü aranmaz; ama kaydın GERÇEKTEN var olma şartı
            // (matches.Count > 0) düşmez — yoksa sabit OTP kısayolu var olmayan bir kimliğe de
            // uygulanabilirdi.
            shouldSend = matched is not null || (isReview && matches.Count > 0);
            emailTarget = matched?.Email;
            tenantName = await TenantNameAsync(matched?.TenantId, ct);
        }

        // MAĞAZA İNCELEME HESABI: denetçi hiçbir kanaldan kod alamayacağı için bu numarada kod
        // rastgele üretilmez ve gönderilmez. Kimlik eşleşmesi zorunluluğu (yukarıdaki shouldSend)
        // DEĞİŞMEZ — yani kayıt gerçekten var olmalıdır.
        string? devCode = null;
        if (shouldSend)
        {
            var code = isReview
                ? _demoCode!
                : RandomNumberGenerator.GetInt32(100000, 1000000).ToString();

            var entry = new OtpEntry
            {
                Code = code,
                Identity = IdentityOf(request.FullName, request.Phone),
                // İnceleme hesabında kod telefona "gitmiş" sayılır: denetçi hem giriş hem kayıt
                // akışını deneyebilsin.
                Channel = CustomerOtpChannel.Sms,
                Target = null,
            };

            // TELEFONSUZ KAYIT: akış e-posta aşamasında BAŞLAR ve orada biter. İki aşamalı
            // doğrulamanın (telefon → e-posta) birinci ayağı yapılandırma gereği yok; ikinci
            // ayağı tek başına yürütülür. PhoneProven bilinçli olarak FALSE kalır — telefon
            // sahipliği gerçekten kanıtlanmadı ve kayıt bunu bilerek açılmalı.
            if (registerViaEmailOnly)
            {
                entry.Channel = CustomerOtpChannel.Email;
                entry.Target = emailTarget;
                entry.AwaitingEmailStage = true;
                entry.PendingEmail = emailTarget;
                entry.PhoneProven = false;
            }

            var delivered = true;
            if (!isReview)
            {
                var (sentChannel, target) = await SendCodeAsync(
                    request.Phone, emailTarget, code, channel, availability,
                    purpose == CustomerOtpPurpose.Register ? "Müşteri Kaydı" : "Müşteri Girişi",
                    tenantName, ct);
                entry.Channel = sentChannel ?? CustomerOtpChannel.Sms;
                entry.Target = target;
                delivered = sentChannel is not null;

                if (!delivered)
                {
                    // Hiçbir kanaldan gitmedi. En olası sebep: platformda TEK kanal e-posta ve bu
                    // müşterinin kayıtlarında e-posta adresi yok.
                    //
                    // Yanıt yine GENEL kalır: aksi hâlde "kayıtlı ama e-postası yok" durumu
                    // "kayıtlı değil" durumundan ayırt edilir, enumerasyon kapısı açılırdı.
                    // Ama TESLİM EDİLMEYEN KOD ÖNBELLEĞE YAZILMAZ: kimsenin göremediği bir kodu
                    // saklamak yalnızca 6 hanelik bir kaba kuvvet hedefi bırakır. Yazmayınca
                    // doğrulama adımı "kod istenmedi" der — bu da kimliği eşleşmeyen kullanıcının
                    // gördüğü mesajın AYNISIdır, yani davranış ayırt edilemez kalır.
                    _logger.LogWarning(
                        "Müşteri OTP gönderilemedi: kullanılabilir kanal/hedef yok ({Phone}). " +
                        "Platformda SMS ya da WhatsApp kurulu değilse ve müşterinin e-postası kayıtlı " +
                        "değilse bu kullanıcı giriş YAPAMAZ.",
                        PhoneMask.Mask(request.Phone));
                }
            }

            if (delivered)
            {
                await _store.SetAsync(CacheKey(key, purpose), entry, CodeLifetime, ct);
                // Geliştirme ortamında kodu yanıtla da döndür (simülasyonda gerçek gönderim yapılmaz).
                if (_env.IsDevelopment()) devCode = code;
            }
        }

        return Result<object>.Success(new
        {
            message = GenericSentMessage,
            // Kod gelmediğinde kullanıcı ne yapacak? Bu bilgi PLATFORM YAPILANDIRMASIdır (kim
            // kayıtlı olduğuyla ilgisi yok), o yüzden herkese aynı şekilde söylenebilir.
            hint = BuildDeliveryHint(availability),
            devCode,
        });
    }

    /// <summary>
    /// "Kod gelmediyse ne yapmalıyım?" — kullanıcıya çıkış yolu gösterir.
    /// </summary>
    /// <remarks>
    /// Yalnız e-posta kurulu olan bir platformda, kurum kayıtlarında e-postası olmayan müşteriye
    /// kod GÖNDERİLEMEZ. Bunu kişiye özel söylemek hesap keşfine yol açacağı için mesaj HERKESE
    /// aynıdır; kullanıcı en azından kurumla iletişime geçmesi gerektiğini öğrenir.
    /// </remarks>
    private static string BuildDeliveryHint(CustomerOtpChannelAvailability availability) =>
        availability is { Email: true, Sms: false, WhatsApp: false }
            ? "Kod, kurumunuzun kayıtlarındaki e-posta adresinize gönderilir. Kod gelmediyse " +
              "adresiniz kayıtlı olmayabilir; lütfen kurumunuzla iletişime geçin."
            : "Kod gelmediyse numaranızı kontrol edip tekrar deneyin.";

    /// <summary>
    /// Kodu gönderir. Önce istenen kanal denenir; olmazsa kullanılabilir diğer kanallara düşülür.
    /// Gerçekten giden kanalı (ve e-posta hedefini) döner; hiçbiri gitmediyse null.
    /// </summary>
    /// <remarks>
    /// SESSİZ BAŞARISIZLIK BİLEREK: kullanıcının kurum kayıtlarında e-posta adresi yoksa hata
    /// dönmek "bu kişi kayıtlı ama e-postası yok" bilgisini sızdırırdı; bunun yerine yanıt genel
    /// kalır ve kod hiç üretilmez.
    /// <para>
    /// DİKKAT: burada telefona DÜŞÜLMEZ. Bu satırlar bir zamanlar "kod telefona gider" diyordu
    /// ama <see cref="OrderChannels"/> giriş akışında yalnız e-postayı dener — yorum kodu
    /// yalanlıyordu. Yedeklemeyi eklemek "giriş SMS harcamaz" kuralını sessizce delerdi.
    /// </para>
    /// </remarks>
    /// <param name="operation">E-postadaki "İşlem Tipi" satırı — giriş ile kayıt aynı şey değildir.</param>
    /// <param name="tenantName">Başlıkta gösterilecek kurum adı; bilinmiyorsa null.</param>
    private async Task<(CustomerOtpChannel? Channel, string? Target)> SendCodeAsync(
        string phone,
        string? emailTarget,
        string code,
        CustomerOtpChannel requested,
        CustomerOtpChannelAvailability availability,
        string operation,
        string? tenantName,
        CancellationToken ct)
    {
        var minutes = (int)CodeLifetime.TotalMinutes;
        var message = $"BeautyAsist doğrulama kodunuz: {code}. Kod {minutes} dakika geçerlidir. Kimseyle paylaşmayın.";

        foreach (var candidate in OrderChannels(requested))
        {
            var usable = candidate switch
            {
                CustomerOtpChannel.WhatsApp => availability.WhatsApp,
                CustomerOtpChannel.Sms => availability.Sms,
                CustomerOtpChannel.Email => availability.Email && !string.IsNullOrWhiteSpace(emailTarget),
                _ => false,
            };
            if (!usable) continue;

            try
            {
                var result = candidate switch
                {
                    CustomerOtpChannel.WhatsApp => await _messaging.SendWhatsAppAsync(phone, message, ct),
                    CustomerOtpChannel.Sms => await _messaging.SendSmsAsync(phone, message, ct),
                    // Markalı "DOĞRULAMA KODU BİLGİLERİ" şablonu; geçerlilik metni CodeLifetime'dan
                    // türer, elle yazılmaz (bkz. VerificationEmailTemplate).
                    _ => await _messaging.SendEmailAsync(
                        emailTarget!,
                        "BeautyAsist doğrulama kodunuz",
                        VerificationEmailTemplate.Build(new VerificationEmailContent(
                            Code: code,
                            Email: emailTarget!,
                            Validity: CodeLifetime,
                            OperationType: operation,
                            TenantName: tenantName,
                            VerificationLink: VerificationEmailTemplate.BuildLink("/randevu/giris",
                                _config["App:PublicBaseUrl"], _config["Frontend:PublicBaseUrl"], _config["WhatsApp:PublicBaseUrl"]),
                            SecurityNote: "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.")),
                        ct),
                };

                // SİMÜLASYON TESLİMAT DEĞİLDİR: sağlayıcı kurulu değilse PlatformMessagingService
                // "başarılı ama simulated" döner. Bunu teslimat saymak, kullanıcıya "kod gönderildi"
                // deyip hiç göndermemek olurdu. Geliştirmede simülasyon zaten tek yoldur.
                if (result.Success && (!result.Simulated || _env.IsDevelopment()))
                    return (candidate, candidate == CustomerOtpChannel.Email ? emailTarget : null);

                _logger.LogWarning("Müşteri OTP {Channel} kanalından gönderilemedi: {Error}",
                    candidate, result.Error ?? (result.Simulated ? "sağlayıcı yapılandırılmamış (simülasyon)" : "bilinmeyen hata"));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Müşteri OTP {Channel} kanalında hata.", candidate);
            }
        }

        return (null, null);
    }

    /// <summary>
    /// Denenecek kanallar — <b>akış sınırının DIŞINA çıkmaz</b>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// GİRİŞ yalnız e-postadır: kod telefona düşseydi "girişte sadece e-posta" kuralı sessizce
    /// delinir, kayıtlı kullanıcı her girişte SMS harcatabilirdi.
    /// </para>
    /// <para>
    /// KAYIT telefon ailesinde kalır: önce SMS, olmazsa WhatsApp. İkisi de aynı şeyi kanıtlar
    /// (numaranın sahipliği). Yedek OLMASAYDI, SMS sağlayıcısı kapalı olan bir kurulumda kayıt
    /// tamamen ölürdü — oysa WhatsApp kuruluysa akış çalışabilir.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Doğrulama e-postasının başlığındaki kurum adı. Bulunamazsa <c>null</c> döner ve satır hiç
    /// basılmaz — kod gönderimi kurum adı yüzünden ASLA düşmemeli.
    /// </summary>
    /// <remarks>
    /// <c>IgnoreQueryFilters</c> gerekmez: <c>Tenant</c> yalnız <c>!IsDeleted</c> ile süzülür,
    /// kurum kapsamı filtresi taşımaz.
    /// </remarks>
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
            _logger.LogWarning(ex, "Müşteri OTP e-postası için kurum adı okunamadı.");
            return null;
        }
    }

    /// <summary>
    /// İstenen kanal ve yedekleri.
    /// </summary>
    /// <remarks>
    /// <b>E-posta, telefon kanallarının YEDEĞİ DEĞİLDİR.</b> Telefon istendiğinde yalnız SMS ve
    /// WhatsApp denenir; sessizce e-postaya düşmek, telefon sahipliğini kanıtlaması gereken bir
    /// akışı kanıtlamayan bir akışa çevirirdi — üstelik çağıran taraf bunu fark etmeden
    /// <c>PhoneProven</c> yazardı. E-postaya geçiş kararı, sonuçlarını bilen tek yerde
    /// (<see cref="RequestAsync"/>, <c>registerViaEmailOnly</c>) AÇIKÇA verilir.
    /// </remarks>
    private static IEnumerable<CustomerOtpChannel> OrderChannels(CustomerOtpChannel requested) =>
        requested switch
        {
            CustomerOtpChannel.Email => [CustomerOtpChannel.Email],
            _ => [CustomerOtpChannel.Sms, CustomerOtpChannel.WhatsApp],
        };

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

        // TEK KULLANIM ATOMİK OLMALI. Oku → karşılaştır → sil üç ayrı adım olsaydı, aynı kodu
        // taşıyan iki eşzamanlı istek silme gerçekleşmeden ikisi de kaydı okuyup İKİ ayrı oturum
        // açabilirdi; deneme sayacı da yarışta kaybolur ve 5 deneme freni delinirdi.
        //
        // KARARIN TAMAMI depo kilidinin altındadır ve mutator SAF tutulur: ağ/DB çağrıları
        // (mesaj gönderimi, hesap açma) bilerek dışarıda bırakılır — kilit altında ağ beklemek
        // hem aynı kullanıcının diğer isteklerini kilitler hem de dağıtık kilidin ömrünü aşabilir.
        //
        // BAŞARIDA KAYIT SİLİNİR (Consumed bayrağı yerine): ikinci istek kaydı hiç bulamaz.
        // Bayrak process içi paylaşılan nesneye dayanıyordu; depoya taşınan durumda silme hem
        // daha basit hem de yeniden okumaya karşı dayanıklıdır.
        var identity = IdentityOf(request.FullName, request.Phone);
        var trimmedCode = code?.Trim();
        var decision = await _store.MutateAsync<OtpEntry, VerifyDecision>(cacheKey, CodeLifetime, current =>
        {
            if (current is null)
                return (null, VerifyDecision.Fail("Kodun süresi doldu ya da kod istenmedi. Yeni kod isteyin."));

            if (current.Attempts >= MaxAttempts)
                return (null, VerifyDecision.Fail("Çok fazla yanlış deneme. Yeni kod isteyin."));

            // Kod BU kimlik için üretilmedi (anahtar yalnız telefondan türüyor). Mesaj yanlış
            // koddan ayırt edilmez — hangi kimliğin kayıtlı olduğu sızmasın.
            var identityOk = string.Equals(current.Identity, identity, StringComparison.Ordinal);
            var codeOk = string.Equals(current.Code, trimmedCode, StringComparison.Ordinal);
            if (!identityOk || !codeOk)
            {
                current.Attempts++;
                // Fren dolduysa kaydı burada düşür: tükenmiş bir kodu saklamanın değeri yok.
                return (current.Attempts >= MaxAttempts ? null : current,
                    VerifyDecision.Fail("Kod hatalı. Tekrar deneyin."));
            }

            return (null, VerifyDecision.Ok(current));
        }, ct);

        if (decision.Entry is null)
            return Result<LoginResponse>.Failure(Error.Unauthorized(decision.Failure!));

        var entry = decision.Entry;

        if (purpose == CustomerOtpPurpose.Register)
        {
            // KVKK onayı VARSAYILAN OLARAK ÜRETİLMEZ: payload gelmediyse onay da yoktur ve
            // AuthService kaydı reddeder. Buraya "true" koymak, hiç sorulmamış bir onayı
            // uydurmak olurdu (bkz. CustomerRegisterRequest.KvkkConsent).
            var payload = registration ?? new CustomerRegisterRequest(
                request.FullName, request.Phone, null, Domain.Enums.Gender.Unspecified, entry.Target, KvkkConsent: false);

            // ---- AŞAMA 1: telefon doğrulandı, sıra E-POSTADA ----
            //
            // Kayıt İKİ kanalı da doğrular: telefon (hesabın kimliği + randevu bildirimleri) ve
            // e-posta (bir sonraki GİRİŞİN kodu oraya gidecek). E-posta doğrulanmadan hesap
            // açılsaydı, yanlış yazılmış bir adres kullanıcıyı ilk girişte kilitlerdi.
            if (!entry.AwaitingEmailStage)
            {
                var mail = CustomerIdentityLookup.NormalizeEmail(payload.Email);
                if (mail.Length == 0)
                {
                    return Result<LoginResponse>.Failure(Error.Validation(
                        "E-posta adresi zorunludur; girişte doğrulama kodu bu adrese gönderilir."));
                }

                var emailCode = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
                var sent = await SendCodeAsync(request.Phone, mail, emailCode, CustomerOtpChannel.Email,
                    await GetAvailableChannelsAsync(ct), "Müşteri Kaydı", tenantName: null, ct);
                if (sent.Channel is null)
                {
                    return Result<LoginResponse>.Failure(Error.Unauthorized(
                        "Doğrulama e-postası gönderilemedi. Adresinizi kontrol edip tekrar deneyin."));
                }

                // Aynı önbellek kaydı 2. aşamaya devreder: telefon kanıtı korunur.
                var next = new OtpEntry
                {
                    Code = emailCode,
                    Identity = entry.Identity,
                    Channel = CustomerOtpChannel.Email,
                    Target = mail,
                    AwaitingEmailStage = true,
                    PendingEmail = mail,
                    PhoneProven = true,
                };
                await _store.SetAsync(cacheKey, next, CodeLifetime, ct);

                // Akış TAMAMLANMADI: istemci ayırt edilebilir kodla "e-posta adımına geç" der.
                // Mesaj alanı maskeli adresi taşır (ekranda gösterilecek tek bilgi budur).
                return Result<LoginResponse>.Failure(
                    Error.EmailStageRequired(TenantTextHelper.MaskEmail(mail)));
            }

            // ---- AŞAMA 2: e-posta da doğrulandı → hesap açılır ----
            payload = payload with { Email = entry.PendingEmail };
            return await _auth.CustomerRegisterAsync(payload, entry.PhoneProven, entry.PendingEmail, ct);
        }

        // Kod doğru → kimlik yeniden doğrulanır, JWT üretilir.
        return await _auth.CustomerLoginAsync(request, ct);
    }
}

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
    private readonly IMemoryCache _cache;
    private readonly IPlatformMessagingService _messaging;
    private readonly IAuthService _auth;
    private readonly ISearchIndexService _search;
    private readonly IHostEnvironment _env;
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
        IMemoryCache cache,
        IPlatformMessagingService messaging,
        IAuthService auth,
        ISearchIndexService search,
        IHostEnvironment env,
        IConfiguration configuration,
        ILogger<CustomerOtpService> logger)
    {
        _db = db;
        _cache = cache;
        _messaging = messaging;
        _auth = auth;
        _search = search;
        _env = env;
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

    private sealed class OtpEntry
    {
        public string Code = string.Empty;

        /// <summary>
        /// Kodun ÜRETİLDİĞİ kimlik (ad soyad + telefon anahtarı). Önbellek anahtarı yalnız telefondan
        /// türediği için, aynı telefonun birden çok müşteri kaydında kullanıldığı durumda A kimliği
        /// için istenen kod B kimliğiyle doğrulanabiliyordu. Kod artık kimliğine bağlıdır.
        /// </summary>
        public string Identity = string.Empty;

        /// <summary>
        /// Kod HANGİ kanaldan gitti? Kayıt akışında hayati: e-postaya giden kod telefon sahipliğini
        /// KANITLAMAZ, dolayısıyla o numaraya ait mevcut hesabı sahiplenmek için kullanılamaz.
        /// </summary>
        public CustomerOtpChannel Channel = CustomerOtpChannel.WhatsApp;

        /// <summary>E-posta kanalında kodun gittiği adres (kayıt akışında kanıt olarak taşınır).</summary>
        public string? Target;

        public int Attempts;

        /// <summary>
        /// Kod tüketildi mi. Eşzamanlı iki DOĞRU doğrulama, silme gerçekleşmeden ikisi de kaydı
        /// okuyup iki ayrı oturum açabiliyordu; bayrak kilit altında işaretlenir.
        /// </summary>
        public bool Consumed;
    }

    private sealed class RequestCounter
    {
        public int Count;
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
    /// KAYIT akışında kodun gönderileceği e-posta. GİRİŞTE kullanılmaz: giriş, kodu müşterinin
    /// kurum kayıtlarındaki adrese gönderir (kullanıcıdan adres istemek hem gereksiz sürtünme
    /// yaratır hem de yanlış adres yazıldığında sessiz başarısızlığa döner).
    /// </param>
    public async Task<Result<object>> RequestAsync(
        CustomerLoginRequest request,
        string? email,
        CustomerOtpPurpose purpose,
        CustomerOtpChannel channel,
        CancellationToken ct)
    {
        var key = PhoneMask.LoginKey(request.Phone);
        var name = CustomerIdentityLookup.NormalizeName(request.FullName);
        if (key.Length < 10 || name.Length == 0)
            return Result<object>.Failure(Error.Validation("Ad soyad ve telefon numarası zorunludur."));

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

        // Kimlik eşleşmesi: girişte zorunlu, kayıtta aranmaz (kanal sahipliği kanıtlanacak).
        string? emailTarget = CustomerIdentityLookup.NormalizeEmail(email);
        if (emailTarget.Length == 0) emailTarget = null;
        var shouldSend = purpose == CustomerOtpPurpose.Register;
        if (!shouldSend)
        {
            var candidates = await CustomerIdentityLookup.FindByPhoneAsync(
                _db.Customers.IgnoreQueryFilters().AsNoTracking(), _search, request.Phone, ct);
            var matches = CustomerIdentityLookup.WithName(candidates, request.FullName);
            shouldSend = matches.Count > 0;
            // Girişte e-posta hedefi KAYITTAN gelir (kullanıcı adres yazmaz).
            emailTarget = matches
                .Select(c => c.Email)
                .FirstOrDefault(e => !string.IsNullOrWhiteSpace(e));
        }

        // MAĞAZA İNCELEME HESABI: denetçi hiçbir kanaldan kod alamayacağı için bu numarada kod
        // rastgele üretilmez ve gönderilmez. Kimlik eşleşmesi zorunluluğu (yukarıdaki shouldSend)
        // DEĞİŞMEZ — yani kayıt gerçekten var olmalıdır.
        var isReview = IsStoreReviewPhone(key);

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

            var delivered = true;
            if (!isReview)
            {
                var (sentChannel, target) = await SendCodeAsync(
                    request.Phone, emailTarget, code, channel, availability, ct);
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
                _cache.Set(CacheKey(key, purpose), entry, CodeLifetime);
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
    /// SESSİZ YEDEKLEME BİLEREK: kullanıcı "e-posta" seçtiği hâlde kurum kayıtlarında adresi yoksa,
    /// hata dönmek "bu kişi kayıtlı ama e-postası yok" bilgisini sızdırırdı. Bunun yerine kod
    /// telefona gider; kullanıcı kodu yine alır.
    /// </remarks>
    private async Task<(CustomerOtpChannel? Channel, string? Target)> SendCodeAsync(
        string phone,
        string? emailTarget,
        string code,
        CustomerOtpChannel requested,
        CustomerOtpChannelAvailability availability,
        CancellationToken ct)
    {
        var message = $"BeautyAsist doğrulama kodunuz: {code}. Kod 5 dakika geçerlidir. Kimseyle paylaşmayın.";

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
                    _ => await _messaging.SendEmailAsync(
                        emailTarget!,
                        "BeautyAsist doğrulama kodunuz",
                        $"<div style='font-family:sans-serif;font-size:15px'>" +
                        $"<p>Merhaba,</p><p>BeautyAsist doğrulama kodunuz:</p>" +
                        $"<p style='font-size:28px;font-weight:700;letter-spacing:6px'>{code}</p>" +
                        $"<p>Kod 5 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p></div>",
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

    /// <summary>İstenen kanal önce, kalanlar yedek. Auto = eski istemci davranışı (önce WhatsApp).</summary>
    private static IEnumerable<CustomerOtpChannel> OrderChannels(CustomerOtpChannel requested)
    {
        var order = new List<CustomerOtpChannel>();
        if (requested is CustomerOtpChannel.WhatsApp or CustomerOtpChannel.Sms or CustomerOtpChannel.Email)
            order.Add(requested);
        foreach (var c in new[] { CustomerOtpChannel.WhatsApp, CustomerOtpChannel.Sms, CustomerOtpChannel.Email })
            if (!order.Contains(c)) order.Add(c);
        return order;
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

        // TEK KULLANIM ATOMİK OLMALI. Oku → karşılaştır → sil üç ayrı adımdı: aynı kodu taşıyan iki
        // eşzamanlı istek, silme gerçekleşmeden ikisi de kaydı okuyup İKİ ayrı oturum açabiliyordu.
        // Deneme sayacı da yarışta kaybolabiliyor, 5 deneme freni delinebiliyordu. Karar kilit
        // altında verilir; ağ/DB çağrıları kilidin DIŞINDA kalır.
        var identity = IdentityOf(request.FullName, request.Phone);
        string? failure = null;
        lock (entry)
        {
            if (entry.Consumed)
                failure = "Bu kod zaten kullanıldı. Yeni kod isteyin.";
            else if (entry.Attempts >= MaxAttempts)
                failure = "Çok fazla yanlış deneme. Yeni kod isteyin.";
            else if (!string.Equals(entry.Identity, identity, StringComparison.Ordinal))
            {
                // Kod BU kimlik için üretilmedi (anahtar yalnız telefondan türüyor). Mesaj yanlış
                // koddan ayırt edilmez — hangi kimliğin kayıtlı olduğu sızmasın.
                entry.Attempts++;
                failure = "Kod hatalı. Tekrar deneyin.";
            }
            else if (!string.Equals(entry.Code, code?.Trim(), StringComparison.Ordinal))
            {
                entry.Attempts++;
                failure = "Kod hatalı. Tekrar deneyin.";
            }
            else
            {
                entry.Consumed = true;
            }
        }

        if (failure is not null)
        {
            if (entry.Attempts >= MaxAttempts) _cache.Remove(cacheKey);
            return Result<LoginResponse>.Failure(Error.Unauthorized(failure));
        }

        // Kod tüketildi: aynı kod ikinci kez kullanılamaz.
        _cache.Remove(cacheKey);

        if (purpose == CustomerOtpPurpose.Register)
        {
            // KVKK onayı VARSAYILAN OLARAK ÜRETİLMEZ: payload gelmediyse onay da yoktur ve
            // AuthService kaydı reddeder. Buraya "true" koymak, hiç sorulmamış bir onayı
            // uydurmak olurdu (bkz. CustomerRegisterRequest.KvkkConsent).
            var payload = registration ?? new CustomerRegisterRequest(
                request.FullName, request.Phone, null, Domain.Enums.Gender.Unspecified, entry.Target, KvkkConsent: false);

            // DOĞRULANAN ADRES KAZANIR.
            //
            // Kod A adresine gönderilip doğrulama isteğinde e-posta alanı B yazılabiliyordu:
            // sahipliği kanıtlanan adres A iken müşteri kaydına B yazılıyordu. Bu, hem başkasının
            // adresini birinin hesabına iliştirmeye hem de "e-postası doğrulanmış" görünen sahte
            // bir kayda yol açar. Kod e-postaya gittiyse kayda YALNIZ o adres yazılır.
            if (entry.Channel == CustomerOtpChannel.Email && !string.IsNullOrWhiteSpace(entry.Target))
            {
                payload = payload with { Email = entry.Target };
            }

            // HANGİ KANAL KANITLANDI? Telefona giden kod telefon sahipliğini, e-postaya giden kod
            // yalnızca e-posta sahipliğini kanıtlar. Kayıt akışı bu ayrımı bilmek zorundadır:
            // e-posta kanıtıyla başkasının numarasına ait hesap sahiplenilemez (bkz. AuthService).
            var phoneVerified = entry.Channel is CustomerOtpChannel.WhatsApp or CustomerOtpChannel.Sms;
            var verifiedEmail = entry.Channel == CustomerOtpChannel.Email ? entry.Target : null;
            return await _auth.CustomerRegisterAsync(payload, phoneVerified, verifiedEmail, ct);
        }

        // Kod doğru → kimlik yeniden doğrulanır, JWT üretilir.
        return await _auth.CustomerLoginAsync(request, ct);
    }
}

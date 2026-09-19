using System.Text.RegularExpressions;
using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DOĞRULAMA KODUNUN İKİ FAZLI TÜKETİMİ — önce sahiplen (claim), sonra tüket.
///
/// <para>
/// Kod, doğru bulunduğu anda kilidin altında SİLİNİYORDU. Silmeden sonra gelen her adım
/// (doğrulama e-postasının gönderimi, hesabın açılması, oturumun üretilmesi) başarısız olabilir
/// ve olduğunda kullanıcının elindeki DOĞRU kod geri dönülemez biçimde yok oluyordu: geçici bir
/// SMTP arızası ya da düzeltilebilir bir doğrulama hatası, telefon başına 10 dakikada 3 istek
/// sınırıyla birleşince hesabı bir süreliğine tamamen erişilemez kılabiliyordu.
/// </para>
///
/// <para>
/// Yeni sözleşme: doğru kod önce SAHİPLENİLİR, ancak akış gerçekten başarıyla bittiğinde
/// TÜKETİLİR. Bu dosya sözleşmenin dört ayağını da sabitler — kod hatada YAŞAR, başarıda ÖLÜR,
/// eşzamanlı iki istekte YALNIZ BİR oturum açar, ve hata toleransı kodun ömrünü UZATMAZ.
/// </para>
/// </summary>
public sealed class CustomerOtpClaimTests
{
    private const string Phone = "+90 555 321 65 87";
    private const string Name = "Deneme Musteri";
    private const string Mail = "deneme.musteri@example.com";

    /// <summary>
    /// İleri alınabilen saat. Paylaşılan <c>FixedClock</c> sabittir; süre aşımı onunla sınanamaz.
    /// </summary>
    private sealed class MovableClock : IDateTimeProvider
    {
        public DateTime UtcNow { get; private set; } = DateTime.UtcNow;
        public void Advance(TimeSpan by) => UtcNow += by;
    }

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static async Task SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Claim QA", $"claim-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, Name, Phone, Mail);
        customer.UpdateProfile(null, Gender.Female, true, null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
    }

    /// <summary>SMS ve e-posta kurulu bir platform: kod telefona gider, kayıtta e-posta kullanılır.</summary>
    private static IPlatformMessagingService NewMessaging()
    {
        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.GetSettingsAsync(Arg.Any<CancellationToken>())
            .Returns(Result<PlatformIntegrationSettingsDto>.Success(new PlatformIntegrationSettingsDto(
                SmsEnabled: true, SmsProvider: "Netgsm", HasSmsApiKey: true, HasSmsApiSecret: true,
                SmsSender: "BEAUTY", SmsApiUrl: null, SmsConfigured: true,
                EmailEnabled: true, EmailFromAddress: "no-reply@beautyasist.app", EmailFromName: "BeautyAsist",
                SmtpHost: "smtp.example.com", SmtpPort: 587, SmtpUsername: "u", HasSmtpPassword: true,
                SmtpUseSsl: true, EmailConfigured: true,
                WhatsAppEnabled: false, WhatsAppProvider: "Meta", WhatsAppPhoneNumberId: null,
                HasWhatsAppAccessToken: false, WhatsAppBusinessAccountId: null, WhatsAppConfigured: false,
                HasWhatsAppAppSecret: false, WhatsAppVerifyToken: null)));

        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "id", null));
        messaging.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "id", null));
        return messaging;
    }

    private static CustomerOtpService NewService(
        GuzellikDbContext db,
        IPlatformMessagingService messaging,
        IAuthService auth,
        IDateTimeProvider? clock = null)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production"); // devCode sızıntısı olmasın

        return new CustomerOtpService(
            db,
            new GuzellikMerkezi.Infrastructure.Services.MemoryOtpStateStore(new MemoryCache(new MemoryCacheOptions())),
            messaging,
            auth,
            TestSearchIndex.Create(),
            env,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
            NullLogger<CustomerOtpService>.Instance,
            clock);
    }

    private static CustomerLoginRequest Login() => new(Name, Phone);

    private static string SmsCode(IPlatformMessagingService messaging) =>
        Regex.Match(
            (string)messaging.ReceivedCalls()
                .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendSmsAsync))
                .Select(c => c.GetArguments()[1]!)
                .Last(),
            @"(\d{6})").Groups[1].Value;

    private static string MailCode(IPlatformMessagingService messaging) =>
        Regex.Match(
            (string)messaging.ReceivedCalls()
                .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
                .Select(c => c.GetArguments()[2]!)
                .Last(),
            @">(\d{6})<").Groups[1].Value;

    private static Result<LoginResponse> Fail(string message) =>
        Result<LoginResponse>.Failure(Error.Validation(message));

    // ------------------------------------------------------------------------- giriş akışı

    /// <summary>
    /// GİRİŞ SON ADIMDA PATLARSA KOD YAŞAR.
    /// </summary>
    /// <remarks>
    /// Eski davranışta kod, <c>CustomerLoginAsync</c> çağrılmadan ÖNCE siliniyordu; çağrı geçici
    /// bir hatayla dönünce kullanıcı elindeki DOĞRU kodla ikinci kez deneyemiyor, "kod istenmedi"
    /// cevabı alıyordu. Bu test tam olarak o senaryoyu yürütür: aynı kod ikinci denemede geçer.
    /// </remarks>
    [Fact]
    public async Task GirisSonAdimdaPatlarsa_AyniKodTekrarKullanilabilir()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        var auth = Substitute.For<IAuthService>();
        auth.CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(
                _ => Fail("Geçici hata."),
                _ => Result<LoginResponse>.Success(StoreReviewOtpTests.SampleLogin()));

        await using var db = NewDb(options);
        var service = NewService(db, messaging, auth);

        // GİRİŞ KODU E-POSTADAN GİDER (akış kuralı: kod kullanıcının yazdığına değil KAYITTAKİ
        // adrese gönderilir). Telefon kanalı kayıt akışının birinci ayağına aittir.
        await service.RequestAsync(Login(), Mail, CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);
        var code = MailCode(messaging);

        var first = await service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None);
        Assert.True(first.IsFailure);

        // ASIL İDDİA: kod HÂLÂ geçerli. Eski kodda burası "Kodun süresi doldu ya da kod
        // istenmedi." ile düşerdi ve kullanıcı yeni kod istemek zorunda kalırdı.
        var second = await service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None);
        Assert.True(second.IsSuccess);
        await auth.Received(2).CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// BAŞARIDA KOD ÖLÜR — tek kullanımlık olma sözleşmesi claim'e rağmen korunur.
    /// </summary>
    [Fact]
    public async Task GirisBasariliOlunca_KodTuketilir()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();
        var auth = StoreReviewOtpTests.NewAuth();

        await using var db = NewDb(options);
        var service = NewService(db, messaging, auth);

        // GİRİŞ KODU E-POSTADAN GİDER (akış kuralı: kod kullanıcının yazdığına değil KAYITTAKİ
        // adrese gönderilir). Telefon kanalı kayıt akışının birinci ayağına aittir.
        await service.RequestAsync(Login(), Mail, CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);
        var code = MailCode(messaging);

        var ok = await service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None);
        Assert.True(ok.IsSuccess);

        var replay = await service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None);
        Assert.True(replay.IsFailure);
        await auth.Received(1).CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// AYNI KODLA İKİ EŞZAMANLI İSTEK TEK OTURUM AÇAR.
    /// </summary>
    /// <remarks>
    /// Bu, değişikliğin asıl RİSKİDİR: kod artık doğrulama anında silinmediği için çift oturum
    /// koruması yalnızca claim'den gelir. <c>MemoryOtpStateStore</c> anahtar başına gerçek bir
    /// <c>SemaphoreSlim</c> ile serileştirdiği için test karşılıklı dışlamayı GERÇEKTEN sınar
    /// (üretimde Redis deposu aynı sözleşmeyi dağıtık kilitle sağlar).
    ///
    /// <para>Sahte giriş bilerek yavaşlatılır: iki isteğin pencereleri örtüşmezse test yarışı hiç
    /// kurmamış, dolayısıyla hiçbir şey kanıtlamamış olurdu.</para>
    /// </remarks>
    [Fact]
    public async Task AyniKodlaIkiEszamanliIstek_TekOturumAcar()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        var auth = Substitute.For<IAuthService>();
        auth.CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(async _ =>
            {
                await Task.Delay(200);
                return Result<LoginResponse>.Success(StoreReviewOtpTests.SampleLogin());
            });

        await using var db = NewDb(options);
        var service = NewService(db, messaging, auth);

        // GİRİŞ KODU E-POSTADAN GİDER (akış kuralı: kod kullanıcının yazdığına değil KAYITTAKİ
        // adrese gönderilir). Telefon kanalı kayıt akışının birinci ayağına aittir.
        await service.RequestAsync(Login(), Mail, CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);
        var code = MailCode(messaging);

        var results = await Task.WhenAll(
            service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None),
            service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None));

        Assert.Equal(1, results.Count(r => r.IsSuccess));
        await auth.Received(1).CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// HATA TOLERANSI KODUN ÖMRÜNÜ UZATMAZ.
    /// </summary>
    /// <remarks>
    /// Kayıt artık her başarısız denemede depoya GERİ YAZILIYOR ve depo her yazımda TTL'i
    /// tazeliyor. Yalnız TTL'e güvenilseydi ardı ardına başarısız denemelerle aynı kod süresiz
    /// yaşatılabilirdi. Gerçek ömür <c>IssuedAtUtc</c> üzerinden sabittir; bu test saati ileri
    /// alarak onu sınar.
    /// </remarks>
    [Fact]
    public async Task BasarisizDenemeler_KodunOmrunuUzatmaz()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();
        var clock = new MovableClock();

        var auth = Substitute.For<IAuthService>();
        auth.CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ => Fail("Geçici hata."));

        await using var db = NewDb(options);
        var service = NewService(db, messaging, auth, clock);

        // GİRİŞ KODU E-POSTADAN GİDER (akış kuralı: kod kullanıcının yazdığına değil KAYITTAKİ
        // adrese gönderilir). Telefon kanalı kayıt akışının birinci ayağına aittir.
        await service.RequestAsync(Login(), Mail, CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);
        var code = MailCode(messaging);

        // Her biri kaydı geri yazan (ve depo TTL'ini tazeleyen) üç başarısız deneme: toplam 6 dakika.
        for (var i = 0; i < 3; i++)
        {
            var attempt = await service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None);
            Assert.True(attempt.IsFailure);
            clock.Advance(TimeSpan.FromMinutes(2));
        }

        // Giriş artık BAŞARILI dönse bile kodun ömrü dolmuştur: doğrulama oraya hiç ulaşmaz.
        auth.CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ => Result<LoginResponse>.Success(StoreReviewOtpTests.SampleLogin()));

        var expired = await service.VerifyAsync(Login(), code, CustomerOtpPurpose.Login, null, CancellationToken.None);
        Assert.True(expired.IsFailure);
        Assert.Contains("süresi doldu", expired.Error.Message);
        await auth.Received(3).CustomerLoginAsync(Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>());
    }

    // ------------------------------------------------------------------------ kayıt akışı

    /// <summary>
    /// DENETİMİN İŞARET ETTİĞİ ASIL YOL: doğrulama e-postası gönderilemezse TELEFON KANITI
    /// çöpe gitmez.
    /// </summary>
    /// <remarks>
    /// SMS kodu doğru girilmiş, telefon kanıtlanmıştır; sıradaki adım e-posta göndermektir. SMTP
    /// geçici olarak düştüğünde eski kod SMS kaydını çoktan silmiş oluyor ve kullanıcı kayda
    /// sıfırdan başlamak zorunda kalıyordu — üstelik istek sınırı yüzünden hemen de değil.
    /// </remarks>
    [Fact]
    public async Task KayitEpostasiGonderilemezse_SmsKoduYasar()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        // İlk gönderim başarısız (SMTP düşük), ikincisi başarılı.
        messaging.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(
                new MessagingTestResult(false, false, null, "smtp down"),
                new MessagingTestResult(true, false, "id", null));

        var auth = StoreReviewOtpTests.NewAuth();
        await using var db = NewDb(options);
        var service = NewService(db, messaging, auth);

        const string newPhone = "+90 555 909 80 70";
        const string newMail = "yeni.kayit@example.com";
        var payload = new CustomerRegisterRequest(
            "Yeni Kayit", newPhone, null, Gender.Unspecified, newMail, KvkkConsent: true);
        var request = new CustomerLoginRequest("Yeni Kayit", newPhone);

        await service.RequestAsync(request, newMail, CustomerOtpPurpose.Register, CustomerOtpChannel.Sms, CancellationToken.None);
        var smsCode = SmsCode(messaging);

        var failed = await service.VerifyAsync(request, smsCode, CustomerOtpPurpose.Register, payload, CancellationToken.None);
        Assert.True(failed.IsFailure);

        // ASIL İDDİA: aynı SMS kodu hâlâ geçerli ve akış e-posta aşamasına ilerleyebiliyor.
        var retried = await service.VerifyAsync(request, smsCode, CustomerOtpPurpose.Register, payload, CancellationToken.None);
        Assert.True(retried.IsFailure);
        Assert.Equal("CustomerEmailStage", retried.Error.Code);
    }

    /// <summary>
    /// KAYIT SON ADIMDA PATLARSA E-POSTA KODU YAŞAR — iki aşamalı akışın ikinci ayağı.
    /// </summary>
    [Fact]
    public async Task KayitSonAdimdaPatlarsa_EpostaKoduTekrarKullanilabilir()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        var auth = Substitute.For<IAuthService>();
        auth.CustomerRegisterAsync(Arg.Any<CustomerRegisterRequest>(), Arg.Any<bool>(), Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(
                _ => Fail("Geçici hata."),
                _ => Result<LoginResponse>.Success(StoreReviewOtpTests.SampleLogin()));

        await using var db = NewDb(options);
        var service = NewService(db, messaging, auth);

        const string newPhone = "+90 555 606 50 40";
        const string newMail = "ikinci.asama@example.com";
        var payload = new CustomerRegisterRequest(
            "Ikinci Asama", newPhone, null, Gender.Unspecified, newMail, KvkkConsent: true);
        var request = new CustomerLoginRequest("Ikinci Asama", newPhone);

        await service.RequestAsync(request, newMail, CustomerOtpPurpose.Register, CustomerOtpChannel.Sms, CancellationToken.None);
        var stage1 = await service.VerifyAsync(request, SmsCode(messaging), CustomerOtpPurpose.Register, payload, CancellationToken.None);
        Assert.Equal("CustomerEmailStage", stage1.Error.Code);

        var mailCode = MailCode(messaging);

        var failed = await service.VerifyAsync(request, mailCode, CustomerOtpPurpose.Register, payload, CancellationToken.None);
        Assert.True(failed.IsFailure);

        // Telefon kanıtı da e-posta kodu da korunmuştur: kullanıcı sıfırdan başlamaz.
        var second = await service.VerifyAsync(request, mailCode, CustomerOtpPurpose.Register, payload, CancellationToken.None);
        Assert.True(second.IsSuccess);
        await auth.Received(2).CustomerRegisterAsync(
            Arg.Any<CustomerRegisterRequest>(), true, newMail, Arg.Any<CancellationToken>());
    }
}

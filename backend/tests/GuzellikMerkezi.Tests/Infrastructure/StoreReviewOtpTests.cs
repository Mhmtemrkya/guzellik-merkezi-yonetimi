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
/// MÜŞTERİ DOĞRULAMA KODU (OTP) — kanallar, kimlik ve mağaza inceleme hesabı.
///
/// <para>
/// Bu dosya App Store'un üç reddini de kilitler:
/// <list type="bullet">
///   <item><b>3.2.2(v)</b> — kod artık yalnız WhatsApp'a gitmez; SMS/e-posta da kanaldır.</item>
///   <item><b>5.1.1(v)</b> — kimlikte doğum tarihi YOK; doğum tarihi boş olan müşteri de girebilir.</item>
///   <item><b>2.1</b> — denetçi hiçbir kanaldan kod alamadığı için yapılandırılmış TEK numarada
///         sabit kod kullanılır; kısayolun gerçek müşterilere SIZMADIĞI da burada sabitlenir.</item>
/// </list>
/// </para>
/// </summary>
public sealed class StoreReviewOtpTests
{
    private const string ReviewPhone = "+90 555 000 11 22";
    private const string ReviewCode = "424242";
    private const string RealPhone = "+90 555 777 88 99";
    private const string RealEmail = "gercek.musteri@example.com";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    /// <param name="configured">false → mağaza hesabı hiç yapılandırılmamış (varsayılan durum).</param>
    private static CustomerOtpService NewService(
        GuzellikDbContext db,
        IPlatformMessagingService messaging,
        bool configured = true,
        IAuthService? auth = null,
        Dictionary<string, string?>? config = null)
    {
        var settings = config ?? (configured
            ? new Dictionary<string, string?>
            {
                ["CustomerOtp:StoreReviewPhone"] = ReviewPhone,
                ["CustomerOtp:StoreReviewCode"] = ReviewCode,
            }
            : new Dictionary<string, string?>());

        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production"); // devCode sızıntısı olmasın

        return new CustomerOtpService(
            db,
            new MemoryCache(new MemoryCacheOptions()),
            messaging,
            auth ?? Substitute.For<IAuthService>(),
            TestSearchIndex.Create(),
            env,
            new ConfigurationBuilder().AddInMemoryCollection(settings).Build(),
            NullLogger<CustomerOtpService>.Instance);
    }

    /// <summary>
    /// Platform mesajlaşma sahtesi. Hangi kanalların "kurulu" olduğu ayarlanabilir: gerçek serviste
    /// kurulu olmayan kanal <i>simülasyon</i> döner ve bu TESLİMAT SAYILMAZ.
    /// </summary>
    private static IPlatformMessagingService NewMessaging(
        bool whatsApp = true, bool sms = false, bool email = false)
    {
        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.GetSettingsAsync(Arg.Any<CancellationToken>())
            .Returns(Result<PlatformIntegrationSettingsDto>.Success(new PlatformIntegrationSettingsDto(
                SmsEnabled: sms, SmsProvider: "Netgsm", HasSmsApiKey: sms, HasSmsApiSecret: sms,
                SmsSender: "BEAUTY", SmsApiUrl: null, SmsConfigured: sms,
                EmailEnabled: email, EmailFromAddress: "no-reply@beautyasist.app", EmailFromName: "BeautyAsist",
                SmtpHost: "smtp.example.com", SmtpPort: 587, SmtpUsername: "u", HasSmtpPassword: email,
                SmtpUseSsl: true, EmailConfigured: email,
                WhatsAppEnabled: whatsApp, WhatsAppProvider: "Meta", WhatsAppPhoneNumberId: "1",
                HasWhatsAppAccessToken: whatsApp, WhatsAppBusinessAccountId: "1", WhatsAppConfigured: whatsApp,
                HasWhatsAppAppSecret: whatsApp, WhatsAppVerifyToken: null)));

        // Kurulu kanal gerçek gönderim (Simulated:false), kurulu olmayan simülasyon döner.
        messaging.SendWhatsAppAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, !whatsApp, "id", null));
        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, !sms, "id", null));
        messaging.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, !email, "id", null));
        return messaging;
    }

    /// <summary>
    /// İki müşteri: biri inceleme numarası (doğum tarihi BOŞ), biri gerçek müşteri (e-postası var).
    /// Doğum tarihinin boş olması bilinçli: eski kod aday kümesini <c>BirthDate == …</c> ile
    /// daralttığı için böyle bir müşteri hiç kod alamıyordu.
    /// </summary>
    private static async Task SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Mağaza QA", $"magaza-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var reviewer = new Customer(tenant.Id, branch.Id, "Denetci Hesap", ReviewPhone, null);
        var real = new Customer(tenant.Id, branch.Id, "Gercek Musteri", RealPhone, RealEmail);
        real.UpdateProfile(null, Gender.Female, true, null);
        db.Customers.AddRange(reviewer, real);
        await db.SaveChangesAsync();
    }

    private static CustomerLoginRequest Login(string fullName, string phone) => new(fullName, phone);

    // ---------------------------------------------------------------- inceleme hesabı

    /// <summary>İnceleme numarasında hiçbir kanaldan gönderim YAPILMAZ (denetçi kodu alamaz zaten).</summary>
    [Fact]
    public async Task StoreReviewPhone_DoesNotSendAnyMessage()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var result = await NewService(db, messaging).RequestAsync(
            Login("Denetci Hesap", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        Assert.True(result.IsSuccess);
        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.DidNotReceive().SendSmsAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.DidNotReceive().SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------------- SIZINTI YOK

    /// <summary>
    /// ASIL İDDİA: gerçek müşteri için davranış DEĞİŞMEZ — kod üretilir ve gönderilir.
    /// Kısayol yalnızca yapılandırılmış numaraya aittir.
    /// </summary>
    [Fact]
    public async Task RealCustomer_StillReceivesCode()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var result = await NewService(db, messaging).RequestAsync(
            Login("Gercek Musteri", RealPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        Assert.True(result.IsSuccess);
        await messaging.Received(1).SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Gerçek müşteriye giden mesaj SABİT inceleme kodunu ASLA içermemeli.</summary>
    [Fact]
    public async Task RealCustomer_CodeIsNotTheStoreReviewCode()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        await NewService(db, messaging).RequestAsync(
            Login("Gercek Musteri", RealPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(),
            // m null olamaz (NSubstitute eşleştiricisi çağrıdaki gerçek argümanı verir) ama
            // derleyici bunu bilemez; CI --warnaserror ile derlendiği için açıkça korunur.
            Arg.Is<string>(m => m != null && m.Contains(ReviewCode)),
            Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------------- kapalıyken

    /// <summary>
    /// Yapılandırılmamışsa (varsayılan) özellik TAMAMEN kapalıdır: inceleme numarası da
    /// normal müşteri gibi davranır ve kod gönderilir.
    /// </summary>
    [Fact]
    public async Task NotConfigured_ReviewPhoneBehavesLikeAnyCustomer()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        await NewService(db, messaging, configured: false).RequestAsync(
            Login("Denetci Hesap", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        await messaging.Received(1).SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------------- kimlik hâlâ zorunlu

    /// <summary>
    /// İnceleme numarası OLSA BİLE kimlik eşleşmesi aranır: yanlış adla istenen kod
    /// üretilmez (numara "her şeyi açan anahtar" değildir).
    /// </summary>
    [Fact]
    public async Task StoreReviewPhone_WithWrongName_DoesNotIssueCode()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        await service.RequestAsync(
            Login("Baska Isim", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        // Kod hiç üretilmediği için doğrulama da başarısız olmalı.
        var verify = await service.VerifyAsync(
            Login("Baska Isim", ReviewPhone), ReviewCode,
            CustomerOtpPurpose.Login, null, CancellationToken.None);

        Assert.True(verify.IsFailure);
    }

    /// <summary>
    /// BOŞ STRING BİR DEĞER DEĞİLDİR. <c>appsettings.example.json</c> eski anahtarları
    /// <c>""</c> olarak taşır; <c>configuration["eski"] ?? configuration["yeni"]</c> yazılırsa
    /// <c>??</c> asla yeni anahtara düşmez ve kısayol SESSİZCE kapalı kalır — denetçi kod
    /// isteyip hiç alamaz, uygulama yine 2.1'den reddedilir.
    /// </summary>
    [Fact]
    public async Task StoreReviewShortcut_WorksWhenLegacyKeysAreEmptyStrings()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var auth = Substitute.For<IAuthService>();
        var service = NewService(db, messaging, auth: auth, config: new Dictionary<string, string?>
        {
            // Örnek dosyadan kopyalanmış hâli: eski anahtarlar VAR ama BOŞ.
            ["CustomerOtp:StoreReviewPhone"] = "",
            ["CustomerOtp:StoreReviewCode"] = "",
            ["AppReview:CustomerPhone"] = ReviewPhone,
            ["AppReview:CustomerOtpCode"] = ReviewCode,
        });

        await service.RequestAsync(
            Login("Denetci Hesap", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        // Kısayol devrede: gönderim YAPILMAZ ve SABİT kod doğrulanabilir.
        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        await service.VerifyAsync(
            Login("Denetci Hesap", ReviewPhone), ReviewCode,
            CustomerOtpPurpose.Login, null, CancellationToken.None);

        // KOD KABUL EDİLDİ: yalnız bu durumda giriş çağrısına ulaşılır (yanlış kod erken döner).
        await auth.Received(1).CustomerLoginAsync(
            Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// TESLİM EDİLMEYEN KOD ÖNBELLEĞE YAZILMAZ.
    ///
    /// <para>
    /// Gerçekçi senaryo: platformda TEK kanal e-posta (SMTP) ve müşterinin kurum kayıtlarında
    /// e-posta adresi yok. Kod hiçbir yere gitmez. Bu kodu saklamak, kimsenin göremediği 6 hanelik
    /// bir kaba kuvvet hedefi bırakmak olurdu. Yazılmayınca doğrulama adımı "kod istenmedi" der —
    /// bu da kimliği eşleşmeyen kullanıcının gördüğü davranışın AYNISIdır (enumerasyon yok).
    /// </para>
    /// </summary>
    [Fact]
    public async Task UndeliverableCode_IsNotCached()
    {
        var options = NewOptions();
        await SeedAsync(options);
        // Yalnız e-posta kurulu; "Denetci Hesap" kaydının e-postası YOK.
        var messaging = NewMessaging(whatsApp: false, sms: false, email: true);
        var auth = Substitute.For<IAuthService>();

        await using var db = NewDb(options);
        var service = NewService(db, messaging, configured: false, auth: auth);

        var request = await service.RequestAsync(
            Login("Denetci Hesap", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Email, CancellationToken.None);

        // Yanıt GENEL kalır (hesap keşfi engellenir) ama kod saklanmaz.
        Assert.True(request.IsSuccess);
        await messaging.DidNotReceive().SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        // Doğru kodu bilse bile (bilemez) doğrulama "kod istenmedi" ile reddeder; giriş çağrılmaz.
        var verify = await service.VerifyAsync(
            Login("Denetci Hesap", ReviewPhone), "123456",
            CustomerOtpPurpose.Login, null, CancellationToken.None);

        Assert.True(verify.IsFailure);
        await auth.DidNotReceive().CustomerLoginAsync(
            Arg.Any<CustomerLoginRequest>(), Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------- 3.2.2(v) çoklu kanal

    /// <summary>
    /// APP STORE 3.2.2(v): kod WhatsApp'a mahkûm değildir. E-posta kanalı seçildiğinde kod
    /// müşterinin KAYITLI adresine e-posta ile gider, WhatsApp hiç kullanılmaz.
    /// </summary>
    [Fact]
    public async Task EmailChannel_SendsEmailToAddressOnRecord()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging(whatsApp: true, email: true);

        await using var db = NewDb(options);
        var result = await NewService(db, messaging).RequestAsync(
            Login("Gercek Musteri", RealPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Email, CancellationToken.None);

        Assert.True(result.IsSuccess);
        await messaging.Received(1).SendEmailAsync(
            RealEmail, Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// SMS kanalı: platformda SMS kuruluysa kod SMS ile gider (Netgsm/Twilio devreye girdiğinde
    /// hiçbir kod değişikliği gerekmemeli).
    /// </summary>
    [Fact]
    public async Task SmsChannel_SendsSms()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging(whatsApp: true, sms: true);

        await using var db = NewDb(options);
        await NewService(db, messaging).RequestAsync(
            Login("Gercek Musteri", RealPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Sms, CancellationToken.None);

        await messaging.Received(1).SendSmsAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// SESSİZ YEDEKLEME: kullanıcı e-posta seçti ama kurum kayıtlarında adresi yok. Hata dönmek
    /// "bu kişi kayıtlı ama e-postası yok" bilgisini sızdırırdı; bunun yerine kod telefona gider
    /// ve yanıt yine GENEL kalır.
    /// </summary>
    [Fact]
    public async Task EmailChannel_WithoutAddressOnRecord_FallsBackToPhone_AndStaysGeneric()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging(whatsApp: true, email: true);

        await using var db = NewDb(options);
        // "Denetci Hesap" kaydının e-postası yok (bkz. SeedAsync) ve inceleme kısayolu kapalı.
        var result = await NewService(db, messaging, configured: false).RequestAsync(
            Login("Denetci Hesap", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Email, CancellationToken.None);

        Assert.True(result.IsSuccess);
        await messaging.DidNotReceive().SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await messaging.Received(1).SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// SİMÜLASYON TESLİMAT DEĞİLDİR: platformda hiçbir kanal kurulu değilse kullanıcıya
    /// "kod gönderildi" DENMEZ. Yoksa herkes çıkışsız bir kod ekranında kalırdı.
    /// </summary>
    [Fact]
    public async Task NoConfiguredChannel_FailsInsteadOfPretendingToSend()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging(whatsApp: false, sms: false, email: false);

        await using var db = NewDb(options);
        var result = await NewService(db, messaging).RequestAsync(
            Login("Gercek Musteri", RealPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    // ---------------------------------------------------------- 5.1.1(v) doğum tarihi yok

    /// <summary>
    /// APP STORE 5.1.1(v): doğum tarihi kimlikten çıktı. Doğum tarihi HİÇ girilmemiş bir müşteri de
    /// kod alabilmeli — eski kod aday kümesini <c>BirthDate == …</c> ile daralttığı için bu müşteri
    /// hiçbir zaman eşleşemiyordu.
    /// </summary>
    [Fact]
    public async Task CustomerWithoutBirthDate_CanStillReceiveCode()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var result = await NewService(db, messaging, configured: false).RequestAsync(
            Login("Denetci Hesap", ReviewPhone), null,
            CustomerOtpPurpose.Login, CustomerOtpChannel.Auto, CancellationToken.None);

        Assert.True(result.IsSuccess);
        await messaging.Received(1).SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------- kanıtlanan kanal doğru taşınır

    /// <summary>
    /// KAYIT AKIŞININ GÜVENLİK ÇEKİRDEĞİ: kod e-postaya gittiyse <c>phoneVerified=false</c> ve
    /// kanıtlanan adres taşınmalıdır. Yanlış taşınırsa e-posta kanıtı telefon kanıtı sayılır ve
    /// başkasının numarasına ait hesap sahiplenilebilir.
    /// </summary>
    [Fact]
    public async Task Register_ViaEmailChannel_PassesEmailProof_NotPhoneProof()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging(whatsApp: true, email: true);
        var auth = Substitute.For<IAuthService>();

        await using var db = NewDb(options);
        var service = NewService(db, messaging, configured: false, auth: auth);

        const string newPhone = "+90 555 123 45 67";
        const string newEmail = "yeni.kullanici@example.com";
        await service.RequestAsync(
            Login("Yeni Kullanici", newPhone), newEmail,
            CustomerOtpPurpose.Register, CustomerOtpChannel.Email, CancellationToken.None);

        // Gönderilen kodu mesaj gövdesinden çıkar (test, üretilen rastgele kodu başka türlü bilemez).
        // Gövdedeki diğer sayılara (font-size vb.) takılmamak için kod etiket arasında aranır.
        var body = messaging.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
            .Select(c => (string)c.GetArguments()[2]!)
            .Single();
        var code = System.Text.RegularExpressions.Regex.Match(body, @">(\d{6})<").Groups[1].Value;
        Assert.Equal(6, code.Length);

        await service.VerifyAsync(
            Login("Yeni Kullanici", newPhone), code,
            CustomerOtpPurpose.Register,
            new CustomerRegisterRequest("Yeni Kullanici", newPhone, null, Gender.Unspecified, newEmail),
            CancellationToken.None);

        await auth.Received(1).CustomerRegisterAsync(
            Arg.Any<CustomerRegisterRequest>(),
            false,                       // telefon KANITLANMADI
            newEmail,                    // kanıtlanan adres taşındı
            Arg.Any<CancellationToken>());
    }
}

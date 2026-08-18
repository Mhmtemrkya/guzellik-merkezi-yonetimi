using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.TenantSignup;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// SELF-SERVİS KURUM KAYDI — iki faktörlü akış, mükerrer kayıt kapısı ve kurum kodu.
/// </summary>
public sealed class TenantSignupTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private sealed class DevEnvironment : IAppEnvironment
    {
        public bool IsDevelopment => false; // devCode sızmasın; kodu mesajdan okuyacağız
    }

    /// <summary>E-posta + WhatsApp kurulu bir platform (ikisi de gerçek gönderim döner).</summary>
    private static IPlatformMessagingService NewMessaging(bool email = true, bool whatsApp = true, bool sms = true)
    {
        var m = Substitute.For<IPlatformMessagingService>();
        m.GetSettingsAsync(Arg.Any<CancellationToken>())
            .Returns(Result<PlatformIntegrationSettingsDto>.Success(new PlatformIntegrationSettingsDto(
                SmsEnabled: sms, SmsProvider: "Netgsm", HasSmsApiKey: sms, HasSmsApiSecret: sms,
                SmsSender: "BEAUTY", SmsApiUrl: null, SmsConfigured: sms,
                EmailEnabled: email, EmailFromAddress: "no-reply@beautyasist.app", EmailFromName: "BeautyAsist",
                SmtpHost: "smtp.example.com", SmtpPort: 587, SmtpUsername: "u", HasSmtpPassword: email,
                SmtpUseSsl: true, EmailConfigured: email,
                WhatsAppEnabled: whatsApp, WhatsAppProvider: "Meta", WhatsAppPhoneNumberId: "1",
                HasWhatsAppAccessToken: whatsApp, WhatsAppBusinessAccountId: "1", WhatsAppConfigured: whatsApp,
                HasWhatsAppAppSecret: whatsApp, WhatsAppVerifyToken: null)));

        m.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, !email, "id", null));
        m.SendWhatsAppAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, !whatsApp, "id", null));
        m.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, !sms, "id", null));
        return m;
    }

    private static TenantSignupService NewService(
        GuzellikDbContext db, IPlatformMessagingService messaging, IMemoryCache? cache = null,
        string? trialPlanKey = null) =>
        new(db,
            cache ?? new MemoryCache(new MemoryCacheOptions()),
            messaging,
            new PlainPasswordHasher(),
            new StubTokenService(),
            TestSearchIndex.Create(),
            new FixedClock(),
            new DevEnvironment(),
            new NoopAuditLogger(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["TenantSignup:TrialPlanKey"] = trialPlanKey,
            }).Build(),
            NullLogger<TenantSignupService>.Instance);

    /// <summary>Denemeye atanacak aktif paket olmadan kurum oluşturulamaz (feature gating fail-closed).</summary>
    private static async Task SeedPlanAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        db.SubscriptionPlans.Add(new SubscriptionPlan(
            "Starter", "Başlangıç", 599m, 1, 3, 300, 200, 0, "excel.customers", "Deneme paketi", 1));
        await db.SaveChangesAsync();
    }

    private static TenantSignupStartRequest Form(
        string tenantName = "Güzel Salon",
        string email = "sahip@ornek.com",
        string phone = "0555 111 22 33") =>
        new(tenantName, "Ayşe Yılmaz", email, phone, "Merkez", "İstanbul");

    /// <summary>Gönderilen mesajdan 6 haneli kodu ayıklar (testin kodu başka türlü bilmesi mümkün değil).</summary>
    private static string CodeFromEmail(IPlatformMessagingService m) =>
        System.Text.RegularExpressions.Regex.Match(
            m.ReceivedCalls()
                .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
                .Select(c => (string)c.GetArguments()[2]!)
                .Last(),
            @"letter-spacing:8px[^>]*>(\d{6})<").Groups[1].Value;

    private static string CodeFromPhone(IPlatformMessagingService m, string method) =>
        System.Text.RegularExpressions.Regex.Match(
            m.ReceivedCalls()
                .Where(c => c.GetMethodInfo().Name == method)
                .Select(c => (string)c.GetArguments()[1]!)
                .Last(),
            @"(\d{6})").Groups[1].Value;

    // ------------------------------------------------------------------ mutlu yol

    /// <summary>
    /// TAM AKIŞ: bilgiler → e-posta kodu → telefon kodu → kurum oluşur, kod atanır, deneme başlar.
    /// </summary>
    [Fact]
    public async Task FullFlow_CreatesTenantWithCodeAndTrial()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        var start = await service.StartAsync(Form());
        Assert.True(start.IsSuccess);
        Assert.Contains("•", start.Value!.MaskedEmail); // adres maskeli döner

        var emailCode = CodeFromEmail(messaging);
        var step2 = await service.VerifyEmailAsync(new TenantSignupVerifyEmailRequest(start.Value.SignupId, emailCode));
        Assert.True(step2.IsSuccess);
        // WhatsApp kurulu → ikinci faktör oradan gitti.
        Assert.Equal("whatsapp", step2.Value!.Channel);

        var phoneCode = CodeFromPhone(messaging, nameof(IPlatformMessagingService.SendWhatsAppAsync));
        var done = await service.VerifyPhoneAsync(new TenantSignupVerifyPhoneRequest(start.Value.SignupId, phoneCode));
        Assert.True(done.IsSuccess);

        Assert.Equal("BA-01", done.Value!.TenantCode);
        Assert.Equal(TenantStatus.Trial, done.Value.Tenant.Status);
        Assert.True(done.Value.Credentials.MustChangePassword);
        Assert.False(string.IsNullOrWhiteSpace(done.Value.Credentials.InitialPassword));
        // Oturum döner: kullanıcı ayrıca giriş yapmak zorunda değil.
        Assert.False(string.IsNullOrWhiteSpace(done.Value.Session.AccessToken));

        await using var verify = NewDb(options);
        var tenant = await verify.Tenants.IgnoreQueryFilters().Include(t => t.Branches).Include(t => t.Users)
            .SingleAsync();
        Assert.Equal("BA-01", tenant.Code);
        Assert.True(tenant.IsSelfSignup);
        Assert.NotNull(tenant.TrialEndsAtUtc);   // sayaç HEMEN başlar
        Assert.NotNull(tenant.PhoneIndex);       // mükerrer kontrolü için blind index
        Assert.Single(tenant.Branches);
        Assert.Single(tenant.Users);
        Assert.Equal(UserRole.InstitutionOwner, tenant.Users.First().Role);
    }

    /// <summary>Kodlar sırayla verilir: ikinci kurum BA-02 olur.</summary>
    [Fact]
    public async Task SecondTenant_GetsNextCode()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using (var seed = NewDb(options))
        {
            var existing = new Tenant("Önceki Kurum", "onceki-kurum", "Başlangıç", TenantStatus.Active);
            existing.AssignCode("BA-01");
            seed.Tenants.Add(existing);
            await seed.SaveChangesAsync();
        }

        var messaging = NewMessaging();
        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        var code = await CompleteAsync(service, messaging, Form());
        Assert.Equal("BA-02", code);
    }

    /// <summary>
    /// SİLİNEN KURUMUN KODU YENİDEN DAĞITILMAZ. Aksi hâlde eski destek kayıtları yanlış kurumu
    /// gösterirdi. (Silinmiş kurum satırı yok; kodun rezerve kaldığını gösteren şey en büyük
    /// numaranın korunmasıdır — bu test iptal edilmiş kurum üzerinden doğrular.)
    /// </summary>
    [Fact]
    public async Task CancelledTenantCode_IsNotReused()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using (var seed = NewDb(options))
        {
            var cancelled = new Tenant("İptal Kurum", "iptal-kurum", "Başlangıç", TenantStatus.Active);
            cancelled.AssignCode("BA-05");
            cancelled.Cancel();
            seed.Tenants.Add(cancelled);
            await seed.SaveChangesAsync();
        }

        var messaging = NewMessaging();
        await using var db = NewDb(options);
        var code = await CompleteAsync(NewService(db, messaging), messaging, Form());
        Assert.Equal("BA-06", code);
    }

    // ------------------------------------------------------------------ mükerrer

    /// <summary>Aynı e-postayla ikinci kurum açılamaz.</summary>
    [Fact]
    public async Task DuplicateEmail_IsRejected()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using (var seed = NewDb(options))
        {
            var t = new Tenant("Mevcut", "mevcut", "Başlangıç", TenantStatus.Active);
            t.GrantAccess("sahip@ornek.com", UserRole.InstitutionOwner, null, "Sahip");
            seed.Tenants.Add(t);
            await seed.SaveChangesAsync();
        }

        await using var db = NewDb(options);
        var result = await NewService(db, NewMessaging()).StartAsync(Form(email: "sahip@ornek.com"));

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
    }

    /// <summary>
    /// Aynı TELEFONLA ikinci kurum açılamaz. Telefon şifreli olduğu için bu kontrol yalnızca
    /// blind index sayesinde çalışır — SQL eşitliği ciphertext'te asla eşleşmez.
    /// </summary>
    [Fact]
    public async Task DuplicatePhone_IsRejected_ViaBlindIndex()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var search = TestSearchIndex.Create();
        await using (var seed = NewDb(options))
        {
            var t = new Tenant("Mevcut", "mevcut", "Başlangıç", TenantStatus.Active);
            t.SetContact("+90 555 111 22 33", null);
            t.SetPhoneIndex(search.BuildPhoneKey("+90 555 111 22 33"));
            seed.Tenants.Add(t);
            await seed.SaveChangesAsync();
        }

        await using var db = NewDb(options);
        // Aynı numara BAŞKA biçimde yazıldı (0555… vs +90 555…) — normalizasyon yakalamalı.
        var result = await NewService(db, NewMessaging()).StartAsync(Form(phone: "0555 111 22 33"));

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
    }

    /// <summary>Aynı işletme adıyla ikinci kurum açılamaz (ad şifreli → bellekte karşılaştırılır).</summary>
    [Fact]
    public async Task DuplicateTenantName_IsRejected()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using (var seed = NewDb(options))
        {
            seed.Tenants.Add(new Tenant("Güzel Salon", "guzel-salon", "Başlangıç", TenantStatus.Active));
            await seed.SaveChangesAsync();
        }

        await using var db = NewDb(options);
        // Farklı yazım (büyük harf + fazla boşluk) yine aynı ada işaret eder.
        var result = await NewService(db, NewMessaging()).StartAsync(Form(tenantName: "GÜZEL   SALON"));

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
    }

    /// <summary>Aynı taslakla İKİ kurum açılamaz (kod tek kullanımlık).</summary>
    [Fact]
    public async Task SameDraft_IsIdempotent_AndCreatesOnlyOneTenant()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();
        var cache = new MemoryCache(new MemoryCacheOptions());

        await using var db = NewDb(options);
        var service = NewService(db, messaging, cache);

        var start = await service.StartAsync(Form());
        var emailCode = CodeFromEmail(messaging);
        await service.VerifyEmailAsync(new TenantSignupVerifyEmailRequest(start.Value!.SignupId, emailCode));
        var phoneCode = CodeFromPhone(messaging, nameof(IPlatformMessagingService.SendWhatsAppAsync));

        var first = await service.VerifyPhoneAsync(new TenantSignupVerifyPhoneRequest(start.Value.SignupId, phoneCode));
        Assert.True(first.IsSuccess);

        // İDEMPOTENS: ikinci istek hata değil, AYNI yanıtı döndürür. Yanıtı kaybolan kullanıcı
        // geçici parolasını ve oturumunu böyle geri alır — aksi hâlde hesabı açılmış ama
        // giriş bilgisini hiç öğrenememiş olurdu.
        var second = await service.VerifyPhoneAsync(new TenantSignupVerifyPhoneRequest(start.Value.SignupId, phoneCode));
        Assert.True(second.IsSuccess);
        Assert.Equal(first.Value!.TenantCode, second.Value!.TenantCode);
        Assert.Equal(first.Value.Credentials.InitialPassword, second.Value.Credentials.InitialPassword);

        // AMA İKİNCİ KURUM AÇILMAZ.
        await using var verify = NewDb(options);
        Assert.Equal(1, await verify.Tenants.IgnoreQueryFilters().CountAsync());
    }

    // ------------------------------------------------------------------ tekillik + fren

    /// <summary>
    /// TEKİLLİĞİN DB GARANTİSİ: kayıt tamamlanınca rezervasyon satırı yazılır.
    /// </summary>
    /// <remarks>
    /// Uygulama içindeki "önce sor, sonra yaz" kontrolü eşzamanlı iki isteği birlikte
    /// geçirebiliyordu. Son söz veritabanındaki UNIQUE kısıttadır; bu test satırın gerçekten
    /// yazıldığını (yani kısıtın devrede olduğunu) sabitler.
    ///
    /// NOT: <c>tenant_users.Email</c>'e global UNIQUE KONULMADI — aynı e-postanın birden çok
    /// kurumda bulunması desteklenen bir özelliktir (bkz. MultiTenantLoginTests). Kısıt yalnız
    /// self-servis kayıt yoluna özeldir.
    /// </remarks>
    [Fact]
    public async Task Signup_WritesUniquenessReservation()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        await CompleteAsync(NewService(db, messaging), messaging, Form());

        await using var verify = NewDb(options);
        var reservation = await verify.TenantSignupReservations.SingleAsync();
        Assert.Equal("sahip@ornek.com", reservation.EmailKey);
        Assert.False(string.IsNullOrWhiteSpace(reservation.PhoneKey));
    }

    /// <summary>
    /// MÜKERRER MESAJI TEK VE GENELDİR — hangi alanın çakıştığı söylenmez.
    /// </summary>
    /// <remarks>
    /// "E-posta kayıtlı" / "telefon kayıtlı" / "işletme adı alınmış" diye ayrı mesajlar dönmek,
    /// anonim bir uçtan "bu kişi ya da işletme sistemde var mı?" sorusunu cevaplanabilir hâle
    /// getiriyordu. Üç durumda da AYNI metin dönmeli.
    /// </remarks>
    [Fact]
    public async Task DuplicateMessages_AreIdentical_AcrossFields()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using (var seed = NewDb(options))
        {
            var t = new Tenant("Güzel Salon", "guzel-salon", "Başlangıç", TenantStatus.Active);
            t.SetContact("+90 555 111 22 33", null);
            t.SetPhoneIndex(TestSearchIndex.Create().BuildPhoneKey("+90 555 111 22 33"));
            t.GrantAccess("sahip@ornek.com", UserRole.InstitutionOwner, null, "Sahip");
            seed.Tenants.Add(t);
            await seed.SaveChangesAsync();
        }

        await using var db = NewDb(options);
        var service = NewService(db, NewMessaging());

        var byEmail = await service.StartAsync(Form(tenantName: "Bambaska Ad", email: "sahip@ornek.com", phone: "0532 000 00 00"));
        var byPhone = await service.StartAsync(Form(tenantName: "Baska Ad Daha", email: "yeni@ornek.com", phone: "0555 111 22 33"));
        var byName = await service.StartAsync(Form(tenantName: "Güzel Salon", email: "bir@ornek.com", phone: "0533 000 00 00"));

        Assert.True(byEmail.IsFailure && byPhone.IsFailure && byName.IsFailure);
        Assert.Equal(byEmail.Error.Message, byPhone.Error.Message);
        Assert.Equal(byEmail.Error.Message, byName.Error.Message);
    }

    /// <summary>
    /// RESEND MALİYET FRENİ: arka arkaya istenen kod bekleme süresine takılır.
    /// </summary>
    /// <remarks>
    /// Her gönderim e-posta/SMS, yani para. Frensiz bir "tekrar gönder" ucu, taslak elinde olan
    /// birinin sınırsız gönderim tetiklemesine izin verirdi; IP/e-posta kovaları saldırganın
    /// değiştirebildiği değerlere bağlı olduğu için tek başına yetmiyor.
    /// </remarks>
    [Fact]
    public async Task Resend_IsRateLimited()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        var start = await service.StartAsync(Form());
        // İlk gönderim cooldown saatini başlattı → hemen ardından gelen istek reddedilir.
        var immediate = await service.ResendAsync(start.Value!.SignupId);

        Assert.True(immediate.IsFailure);
        // Yalnız İLK gönderim yapıldı; ikinci bir e-posta çıkmadı.
        await messaging.Received(1).SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ------------------------------------------------------------------ deneme paketi

    /// <summary>
    /// DENEMEDE EN ZAYIF PAKET VERİLMEZ.
    ///
    /// <para>
    /// Deneme sürümünün işi ürünü göstermek. En düşük <c>DisplayOrder</c>'lı paket (Başlangıç)
    /// atanırsa kullanıcı 14 gün boyunca rapor, WhatsApp, adisyon ve çok şubeyi göremez — yani
    /// satın alma kararını etkileyecek her özelliği kapalı bulur. Varsayılan tam pakettir.
    /// </para>
    /// </summary>
    [Fact]
    public async Task TrialPlan_IsTheFullPlan_NotTheWeakestOne()
    {
        var options = NewOptions();
        await using (var seed = NewDb(options))
        {
            seed.SubscriptionPlans.AddRange(
                new SubscriptionPlan("Starter", "Başlangıç", 599m, 1, 3, 300, 200, 0, "excel.customers", null, 1),
                new SubscriptionPlan("Premium", "Premium", 2990m, 6, 25, 8000, 5000, 2500, "excel.customers,reports.finance", null, 3));
            await seed.SaveChangesAsync();
        }

        var messaging = NewMessaging();
        await using var db = NewDb(options);
        await CompleteAsync(NewService(db, messaging), messaging, Form());

        await using var verify = NewDb(options);
        var tenant = await verify.Tenants.IgnoreQueryFilters().Include(t => t.SubscriptionPlan).SingleAsync();
        Assert.Equal("Premium", tenant.SubscriptionPlan!.PlanKey);
    }

    /// <summary>Yapılandırmayla başka bir paket seçilebilir (kurulumdan kuruluma değişebilir).</summary>
    [Fact]
    public async Task TrialPlan_CanBeOverriddenByConfiguration()
    {
        var options = NewOptions();
        await using (var seed = NewDb(options))
        {
            seed.SubscriptionPlans.AddRange(
                new SubscriptionPlan("Starter", "Başlangıç", 599m, 1, 3, 300, 200, 0, "excel.customers", null, 1),
                new SubscriptionPlan("Premium", "Premium", 2990m, 6, 25, 8000, 5000, 2500, "reports.finance", null, 3));
            await seed.SaveChangesAsync();
        }

        var messaging = NewMessaging();
        await using var db = NewDb(options);
        await CompleteAsync(NewService(db, messaging, trialPlanKey: "Starter"), messaging, Form());

        await using var verify = NewDb(options);
        var tenant = await verify.Tenants.IgnoreQueryFilters().Include(t => t.SubscriptionPlan).SingleAsync();
        Assert.Equal("Starter", tenant.SubscriptionPlan!.PlanKey);
    }

    // ------------------------------------------------------------------ zorunlu alanlar + kanallar

    [Theory]
    [InlineData("", "Ayşe Yılmaz", "a@b.com", "05551112233", "Merkez", "İstanbul")] // işletme adı
    [InlineData("Salon", "Ayşe", "a@b.com", "05551112233", "Merkez", "İstanbul")]   // soyadı eksik
    [InlineData("Salon", "Ayşe Yılmaz", "gecersiz", "05551112233", "Merkez", "İstanbul")] // e-posta
    [InlineData("Salon", "Ayşe Yılmaz", "a@b.com", "123", "Merkez", "İstanbul")]    // telefon
    [InlineData("Salon", "Ayşe Yılmaz", "a@b.com", "05551112233", "", "İstanbul")]  // şube
    [InlineData("Salon", "Ayşe Yılmaz", "a@b.com", "05551112233", "Merkez", "")]    // şehir
    public async Task AllFieldsAreRequired(string name, string owner, string email, string phone, string branch, string city)
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using var db = NewDb(options);

        var result = await NewService(db, NewMessaging())
            .StartAsync(new TenantSignupStartRequest(name, owner, email, phone, branch, city));

        Assert.True(result.IsFailure);
        Assert.Equal("Validation", result.Error.Code);
    }

    /// <summary>
    /// WhatsApp kurulu DEĞİLSE ikinci faktör SMS'ten gider — kayıt WhatsApp'a mahkûm değildir
    /// (App Store 3.2.2(v) ile aynı ilke).
    /// </summary>
    [Fact]
    public async Task WithoutWhatsApp_SecondFactorGoesBySms()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging(whatsApp: false, sms: true);

        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        var start = await service.StartAsync(Form());
        var step2 = await service.VerifyEmailAsync(
            new TenantSignupVerifyEmailRequest(start.Value!.SignupId, CodeFromEmail(messaging)));

        Assert.True(step2.IsSuccess);
        Assert.Equal("sms", step2.Value!.Channel);
        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// Kanal yoksa kayıt HİÇ BAŞLAMAZ. "Kod gönderildi" deyip göndermemek, kullanıcıyı üç adım
    /// doldurttuktan sonra çıkışsız bırakırdı.
    /// </summary>
    [Fact]
    public async Task WithoutEmailChannel_SignupIsRefusedUpFront()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        await using var db = NewDb(options);
        var service = NewService(db, NewMessaging(email: false));

        var readiness = await service.GetReadinessAsync();
        Assert.False(readiness.Value!.CanSignup);

        var result = await service.StartAsync(Form());
        Assert.True(result.IsFailure);
    }

    /// <summary>Yanlış kod 5 denemede taslağı düşürür.</summary>
    [Fact]
    public async Task WrongCode_LocksDraftAfterFiveAttempts()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();
        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        var start = await service.StartAsync(Form());
        for (var i = 0; i < 5; i++)
        {
            var attempt = await service.VerifyEmailAsync(new TenantSignupVerifyEmailRequest(start.Value!.SignupId, "000000"));
            Assert.True(attempt.IsFailure);
        }

        // Taslak düştü: DOĞRU kod bile artık çalışmaz.
        var afterLock = await service.VerifyEmailAsync(
            new TenantSignupVerifyEmailRequest(start.Value!.SignupId, CodeFromEmail(messaging)));
        Assert.True(afterLock.IsFailure);
    }

    /// <summary>Adımlar sırayla: e-posta doğrulanmadan telefon adımına geçilemez.</summary>
    [Fact]
    public async Task CannotSkipEmailVerification()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();
        await using var db = NewDb(options);
        var service = NewService(db, messaging);

        var start = await service.StartAsync(Form());
        var result = await service.VerifyPhoneAsync(
            new TenantSignupVerifyPhoneRequest(start.Value!.SignupId, CodeFromEmail(messaging)));

        Assert.True(result.IsFailure);
        await using var verify = NewDb(options);
        Assert.Equal(0, await verify.Tenants.IgnoreQueryFilters().CountAsync());
    }

    /// <summary>Yarım kalan kayıt veritabanına HİÇ yazılmaz (kod tüketilmez, ad kilitlenmez).</summary>
    [Fact]
    public async Task AbandonedSignup_WritesNothingToDatabase()
    {
        var options = NewOptions();
        await SeedPlanAsync(options);
        var messaging = NewMessaging();
        await using var db = NewDb(options);

        var start = await NewService(db, messaging).StartAsync(Form());
        Assert.True(start.IsSuccess);

        await using var verify = NewDb(options);
        Assert.Equal(0, await verify.Tenants.IgnoreQueryFilters().CountAsync());
        Assert.Equal(0, await verify.TenantUsers.IgnoreQueryFilters().CountAsync());
    }

    // ------------------------------------------------------------------ yardımcı

    private static async Task<string> CompleteAsync(
        TenantSignupService service, IPlatformMessagingService messaging, TenantSignupStartRequest form)
    {
        var start = await service.StartAsync(form);
        Assert.True(start.IsSuccess);
        var step2 = await service.VerifyEmailAsync(
            new TenantSignupVerifyEmailRequest(start.Value!.SignupId, CodeFromEmail(messaging)));
        Assert.True(step2.IsSuccess);
        var method = step2.Value!.Channel == "whatsapp"
            ? nameof(IPlatformMessagingService.SendWhatsAppAsync)
            : nameof(IPlatformMessagingService.SendSmsAsync);
        var done = await service.VerifyPhoneAsync(
            new TenantSignupVerifyPhoneRequest(start.Value.SignupId, CodeFromPhone(messaging, method)));
        Assert.True(done.IsSuccess);
        return done.Value!.TenantCode;
    }
}

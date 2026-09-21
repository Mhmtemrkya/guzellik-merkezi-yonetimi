using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// PANEL GİRİŞİNDE İKİNCİ FAKTÖR — parola + e-postaya gelen kod.
///
/// <para>
/// Parola tek başına yetmiyordu: panel müşteri kişisel verisi, tahsilat ve kasa içeriyor.
/// Bu testler oturumun kod doğrulanmadan ASLA teslim edilmediğini sabitler.
/// </para>
/// </summary>
public sealed class PanelLoginOtpTests
{
    private static readonly UserProfileDto Profile = new(
        Guid.CreateVersion7(), "yonetici@ornek.test", "Deniz Kaya", UserRole.InstitutionOwner,
        Guid.CreateVersion7(), Guid.CreateVersion7(), Array.Empty<string>(), false);

    private static readonly LoginResponse Session =
        new("access-token", "refresh-token", DateTime.UtcNow.AddMinutes(60), Profile);

    private static IPlatformMessagingService NewMessaging(bool emailWorks = true)
    {
        var m = Substitute.For<IPlatformMessagingService>();
        m.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(emailWorks, !emailWorks, "id", emailWorks ? null : "smtp down"));
        return m;
    }

    private static PanelLoginOtpService NewService(
        IAuthService auth,
        IPlatformMessagingService messaging,
        string? seedTenantName = null,
        Dictionary<string, string?>? settings = null)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production"); // devCode sızmasın

        // Servis e-posta şablonunun başlığına kurum adını yazıyor; adı DB'den okuyor.
        var db = new GuzellikDbContext(
            new DbContextOptionsBuilder<GuzellikDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options,
            null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

        if (seedTenantName is not null)
        {
            // NOT: bağlamda IEncryptionService null olduğu için Tenant.Name burada DÜZ metindir.
            // Test SORGUYU ve bağlantıyı kanıtlar; şifre çözücü dönüşümü değil. O yol
            // WhatsAppService'te aynı projeksiyonla (Select(t => t.Name)) canlıda kullanılıyor.
            var tenant = new Tenant(seedTenantName, "seed-salon", "Başlangıç");
            typeof(Entity).GetProperty(nameof(Entity.Id))!.SetValue(tenant, Profile.TenantId!.Value);
            db.Tenants.Add(tenant);
            db.SaveChanges();
        }

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();

        return new PanelLoginOtpService(auth, new GuzellikMerkezi.Infrastructure.Services.MemoryOtpStateStore(new MemoryCache(new MemoryCacheOptions())), messaging, db, config, env,
            NullLogger<PanelLoginOtpService>.Instance);
    }

    private static IAuthService NewAuth(bool passwordOk = true, UserRole? role = null)
    {
        var session = role is null ? Session : Session with { User = Profile with { Role = role.Value } };
        var auth = Substitute.For<IAuthService>();
        auth.LoginAsync(Arg.Any<LoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(passwordOk
                ? Result<LoginResponse>.Success(session)
                : Result<LoginResponse>.Failure(Error.Unauthorized("E-posta, rol veya parola hatalı.")));
        return auth;
    }

    private static string LastEmailBody(IPlatformMessagingService messaging) =>
        (string)messaging.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
            .Select(c => c.GetArguments()[2]!)
            .Last();

    private static LoginRequest Request() =>
        new("yonetici@ornek.test", "parola", UserRole.InstitutionOwner, Guid.CreateVersion7(), Guid.CreateVersion7());

    /// <summary>Doğru parola OTURUM DEĞİL, meydan okuma döndürür; kod e-postaya gider.</summary>
    [Fact]
    public async Task CorrectPassword_ReturnsChallenge_NotSession()
    {
        var messaging = NewMessaging();
        var result = await NewService(NewAuth(), messaging).StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(string.IsNullOrWhiteSpace(result.Value!.ChallengeId));
        Assert.Contains("•", result.Value.MaskedEmail);
        Assert.Null(result.Value.DevCode); // canlıda kod sızmaz
        await messaging.Received(1).SendEmailAsync(
            "yonetici@ornek.test", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// Gövde markalı şablondur ve alanları BU AKIŞTAN gelir: geçerlilik
    /// <c>ChallengeLifetime</c>'dan (10 dk) türer, işlem tipi kullanıcının ROLÜNÜ söyler.
    /// </summary>
    /// <remarks>
    /// Rol körü "Yönetici Girişi" yazmak yanlış olurdu: bu uç personel girişine de hizmet eder.
    /// </remarks>
    [Fact]
    public async Task Email_MarkaliSablonla_AkisinKendiDegerleriniTasir()
    {
        var messaging = NewMessaging();
        await NewService(NewAuth(), messaging).StartAsync(Request(), CancellationToken.None);

        var body = LastEmailBody(messaging);

        Assert.Contains("DOĞRULAMA KODU BİLGİLERİ", body, StringComparison.Ordinal);
        Assert.Contains("10 Dakika", body, StringComparison.Ordinal);   // ChallengeLifetime
        Assert.Contains("Yönetici Girişi", body, StringComparison.Ordinal); // InstitutionOwner
        Assert.Contains("yonetici@ornek.test", body, StringComparison.Ordinal);
        Assert.Contains("parolanızı hemen değiştirin", body, StringComparison.Ordinal);
    }

    /// <summary>
    /// İŞLEM TİPİ ROLE GÖRE DEĞİŞİR. Personele "Yönetici Girişi" yazmak kullanıcıya yanlış bilgi
    /// vermek olurdu; bu uç tek bir rolün değil panelin TAMAMININ giriş kapısıdır.
    /// </summary>
    [Theory]
    [InlineData(UserRole.InstitutionOwner, "Yönetici Girişi")]
    [InlineData(UserRole.BranchManager, "Şube Yöneticisi Girişi")]
    [InlineData(UserRole.Staff, "Personel Girişi")]
    public async Task Email_IslemTipi_RoleGoreYazilir(UserRole role, string expected)
    {
        var messaging = NewMessaging();
        await NewService(NewAuth(role: role), messaging).StartAsync(Request(), CancellationToken.None);

        Assert.Contains(expected, LastEmailBody(messaging), StringComparison.Ordinal);
    }

    /// <summary>
    /// KURUM ADI VE BAĞLANTI GERÇEKTEN GÖVDEYE GİRER. İkisi de "bulunamazsa sessizce atla"
    /// mantığıyla çalışıyor; bir regresyon onları hiç kimseye hissettirmeden düşürebilirdi —
    /// oysa kurum adı tasarımın başlık satırının ta kendisi.
    /// </summary>
    [Fact]
    public async Task Email_KurumAdiniVeBaglantiyi_Tasir()
    {
        var messaging = NewMessaging();
        var service = NewService(NewAuth(), messaging,
            seedTenantName: "Burcu Bozkır Beauty",
            settings: new Dictionary<string, string?>
            {
                // BOŞ anahtar bilerek ilk sırada: `??` zinciri burada takılırdı.
                ["App:PublicBaseUrl"] = "",
                ["Frontend:PublicBaseUrl"] = "https://beautyasist.com",
            });

        await service.StartAsync(Request(), CancellationToken.None);
        var body = LastEmailBody(messaging);

        Assert.Contains("Burcu Bozkır Beauty", body, StringComparison.Ordinal);
        Assert.Contains("https://beautyasist.com/login", body, StringComparison.Ordinal);
    }

    /// <summary>Kurum bulunamazsa ya da taban adres yoksa GÖNDERİM DÜŞMEZ; satırlar basılmaz.</summary>
    [Fact]
    public async Task Email_KurumVeBaglantiYoksa_GonderimDusmez()
    {
        var messaging = NewMessaging();
        var result = await NewService(NewAuth(), messaging).StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var body = LastEmailBody(messaging);
        Assert.DoesNotContain("Doğrulama Bağlantısı", body, StringComparison.Ordinal);
        // Kod yine de METİN olarak gövdededir — kayıp satırlar onu etkilemez.
        Assert.Matches(@">\d{6}<", body);
    }

    /// <summary>Yanlış parolada KOD GÖNDERİLMEZ — e-posta bombardımanı yolu açılmasın.</summary>
    [Fact]
    public async Task WrongPassword_SendsNoCode()
    {
        var messaging = NewMessaging();
        var result = await NewService(NewAuth(passwordOk: false), messaging).StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        await messaging.DidNotReceive().SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// FAIL-CLOSED: kod gönderilemezse oturum TESLİM EDİLMEZ.
    /// "Gönderemedik, buyur gir" demek ikinci faktörü tamamen kaldırmak olurdu.
    /// </summary>
    [Fact]
    public async Task EmailFailure_RefusesLogin()
    {
        var result = await NewService(NewAuth(), NewMessaging(emailWorks: false))
            .StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    /// <summary>
    /// Apple inceleme hesabının <c>.test</c> adresi gerçek posta alamaz. İnceleme modu açıkken,
    /// yalnız yapılandırılmış yönetici + kurum eşleşmesine sabit kod ekranda gösterilir; SMTP'ye
    /// gidilmez. Parola, rol, kurum ve cihaz kontrolleri yine LoginAsync içinde eksiksiz çalışır.
    /// </summary>
    [Fact]
    public async Task AppReviewOwner_ExactIdentity_UsesConfiguredCodeWithoutEmail()
    {
        const string reviewCode = "731946";
        var messaging = NewMessaging(emailWorks: false);
        var settings = new Dictionary<string, string?>
        {
            ["AppReview:Enabled"] = "true",
            ["AppReview:OwnerEmail"] = Profile.Email,
            ["AppReview:OwnerTenantId"] = Profile.TenantId!.Value.ToString(),
            ["AppReview:OwnerOtpCode"] = reviewCode,
        };
        var service = NewService(NewAuth(), messaging, settings: settings);

        var start = await service.StartAsync(Request(), CancellationToken.None);

        Assert.True(start.IsSuccess);
        Assert.Equal(reviewCode, start.Value!.DevCode);
        await messaging.DidNotReceive().SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        var verified = await service.VerifyAsync(start.Value.ChallengeId, reviewCode, CancellationToken.None);
        Assert.True(verified.IsSuccess);
        Assert.Equal("access-token", verified.Value!.AccessToken);
    }

    /// <summary>
    /// İnceleme kısa yolu yalnız tam kimliğe aittir: mod kapalıysa, kurum yanlışsa, rol yanlışsa
    /// veya kod biçimi geçersizse normal fail-closed e-posta yolu değişmeden kalır.
    /// </summary>
    [Theory]
    [InlineData(false, false, false, false, false)]
    [InlineData(true, true, false, false, false)]
    [InlineData(true, false, true, false, false)]
    [InlineData(true, false, false, true, false)]
    [InlineData(true, false, false, false, true)]
    public async Task AppReviewOwner_NonExactConfiguration_DoesNotBypassEmail(
        bool enabled, bool wrongEmail, bool wrongTenant, bool wrongRole, bool invalidCode)
    {
        var settings = new Dictionary<string, string?>
        {
            ["AppReview:Enabled"] = enabled.ToString(),
            ["AppReview:OwnerEmail"] = wrongEmail ? "someone-else@beautyasist.test" : Profile.Email,
            ["AppReview:OwnerTenantId"] = (wrongTenant ? Guid.CreateVersion7() : Profile.TenantId!.Value).ToString(),
            ["AppReview:OwnerOtpCode"] = invalidCode ? "abc" : "731946",
        };
        var auth = NewAuth(role: wrongRole ? UserRole.Staff : UserRole.InstitutionOwner);
        var messaging = NewMessaging(emailWorks: false);

        var result = await NewService(auth, messaging, settings: settings)
            .StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        await messaging.Received(1).SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Yanlış kod oturumu açmaz; doğru kod açar ve kod TEK KULLANIMLIKTIR.</summary>
    [Fact]
    public async Task Verify_RejectsWrongCode_AcceptsRightCodeOnce()
    {
        var messaging = NewMessaging();
        var service = NewService(NewAuth(), messaging);
        var start = await service.StartAsync(Request(), CancellationToken.None);

        var body = messaging.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
            .Select(c => (string)c.GetArguments()[2]!)
            .Single();
        var code = System.Text.RegularExpressions.Regex.Match(body, @">(\d{6})<").Groups[1].Value;

        Assert.True((await service.VerifyAsync(start.Value!.ChallengeId, "000000", CancellationToken.None)).IsFailure);

        var ok = await service.VerifyAsync(start.Value.ChallengeId, code, CancellationToken.None);
        Assert.True(ok.IsSuccess);
        Assert.Equal("access-token", ok.Value!.AccessToken);

        // Aynı kod ikinci kez kullanılamaz.
        Assert.True((await service.VerifyAsync(start.Value.ChallengeId, code, CancellationToken.None)).IsFailure);
    }

    /// <summary>5 yanlış denemede meydan okuma düşer; doğru kod bile artık çalışmaz.</summary>
    [Fact]
    public async Task Verify_LocksAfterFiveWrongAttempts()
    {
        var messaging = NewMessaging();
        var service = NewService(NewAuth(), messaging);
        var start = await service.StartAsync(Request(), CancellationToken.None);

        var body = messaging.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
            .Select(c => (string)c.GetArguments()[2]!)
            .Single();
        var code = System.Text.RegularExpressions.Regex.Match(body, @">(\d{6})<").Groups[1].Value;

        for (var i = 0; i < 5; i++)
            Assert.True((await service.VerifyAsync(start.Value!.ChallengeId, "000000", CancellationToken.None)).IsFailure);

        Assert.True((await service.VerifyAsync(start.Value!.ChallengeId, code, CancellationToken.None)).IsFailure);
    }

    /// <summary>Bilinmeyen/süresi dolmuş meydan okuma reddedilir.</summary>
    [Fact]
    public async Task Verify_UnknownChallenge_IsRejected()
    {
        var result = await NewService(NewAuth(), NewMessaging())
            .VerifyAsync("bilinmeyen", "123456", CancellationToken.None);

        Assert.True(result.IsFailure);
    }
}

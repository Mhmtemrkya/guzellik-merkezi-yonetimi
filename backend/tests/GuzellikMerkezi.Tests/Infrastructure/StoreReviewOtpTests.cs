using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Application.Abstractions;
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
/// MAĞAZA İNCELEME HESABI (App Store / Play Store denetçileri).
///
/// <para>
/// Denetçiler uygulamayı test ederken WhatsApp'a doğrulama kodu ALAMAZ. Bu yüzden
/// YAPILANDIRILMIŞ TEK bir telefon için kod sabittir ve gönderilmez.
/// </para>
///
/// <para>
/// Bu testlerin ASIL AMACI kısayolun SIZMADIĞINI sabitlemek: gerçek müşteriler için kod
/// rastgele üretilmeye ve WhatsApp'a gitmeye devam etmelidir. Doğrulama tümden kaldırılsaydı
/// ad + telefon + doğum tarihi bilen herkes o müşterinin randevu/iletişim geçmişine erişirdi.
/// </para>
/// </summary>
public sealed class StoreReviewOtpTests
{
    private const string ReviewPhone = "+90 555 000 11 22";
    private const string ReviewCode = "424242";
    private const string RealPhone = "+90 555 777 88 99";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    /// <param name="configured">false → mağaza hesabı hiç yapılandırılmamış (varsayılan durum).</param>
    private static CustomerOtpService NewService(
        GuzellikDbContext db, IPlatformMessagingService messaging, bool configured = true)
    {
        var settings = configured
            ? new Dictionary<string, string?>
            {
                ["CustomerOtp:StoreReviewPhone"] = ReviewPhone,
                ["CustomerOtp:StoreReviewCode"] = ReviewCode,
            }
            : new Dictionary<string, string?>();

        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production"); // devCode sızıntısı olmasın

        return new CustomerOtpService(
            db,
            new MemoryCache(new MemoryCacheOptions()),
            messaging,
            Substitute.For<IAuthService>(),
            env,
            new ConfigurationBuilder().AddInMemoryCollection(settings).Build(),
            NullLogger<CustomerOtpService>.Instance);
    }

    private static IPlatformMessagingService NewMessaging()
    {
        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.SendWhatsAppAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, true, null, null));
        return messaging;
    }

    private static readonly DateOnly Birth = new(1993, 4, 12);

    /// <summary>İki müşteri: biri inceleme numarası, biri gerçek müşteri.</summary>
    private static async Task SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Mağaza QA", $"magaza-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var reviewer = new Customer(tenant.Id, branch.Id, "Denetci Hesap", ReviewPhone, null);
        reviewer.UpdateProfile(Birth, Gender.Unspecified, true, null);
        var real = new Customer(tenant.Id, branch.Id, "Gercek Musteri", RealPhone, null);
        real.UpdateProfile(Birth, Gender.Female, true, null);
        db.Customers.AddRange(reviewer, real);
        await db.SaveChangesAsync();
    }

    private static CustomerLoginRequest Login(string fullName, string phone) =>
        new(fullName, phone, Birth);

    // ---------------------------------------------------------------- inceleme hesabı

    /// <summary>İnceleme numarasında WhatsApp gönderimi YAPILMAZ (denetçi kodu alamaz zaten).</summary>
    [Fact]
    public async Task StoreReviewPhone_DoesNotSendWhatsApp()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var result = await NewService(db, messaging)
            .RequestAsync(Login("Denetci Hesap", ReviewPhone), CustomerOtpPurpose.Login, CancellationToken.None);

        Assert.True(result.IsSuccess);
        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------------- SIZINTI YOK

    /// <summary>
    /// ASIL İDDİA: gerçek müşteri için davranış DEĞİŞMEZ — kod üretilir ve WhatsApp'a gider.
    /// Kısayol yalnızca yapılandırılmış numaraya aittir.
    /// </summary>
    [Fact]
    public async Task RealCustomer_StillReceivesWhatsAppCode()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        var result = await NewService(db, messaging)
            .RequestAsync(Login("Gercek Musteri", RealPhone), CustomerOtpPurpose.Login, CancellationToken.None);

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
        await NewService(db, messaging)
            .RequestAsync(Login("Gercek Musteri", RealPhone), CustomerOtpPurpose.Login, CancellationToken.None);

        await messaging.DidNotReceive().SendWhatsAppAsync(
            Arg.Any<string>(),
            Arg.Is<string>(m => m.Contains(ReviewCode)),
            Arg.Any<CancellationToken>());
    }

    // ---------------------------------------------------------------- kapalıyken

    /// <summary>
    /// Yapılandırılmamışsa (varsayılan) özellik TAMAMEN kapalıdır: inceleme numarası da
    /// normal müşteri gibi davranır ve kod WhatsApp'a gider.
    /// </summary>
    [Fact]
    public async Task NotConfigured_ReviewPhoneBehavesLikeAnyCustomer()
    {
        var options = NewOptions();
        await SeedAsync(options);
        var messaging = NewMessaging();

        await using var db = NewDb(options);
        await NewService(db, messaging, configured: false)
            .RequestAsync(Login("Denetci Hesap", ReviewPhone), CustomerOtpPurpose.Login, CancellationToken.None);

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
            Login("Baska Isim", ReviewPhone), CustomerOtpPurpose.Login, CancellationToken.None);

        // Kod hiç üretilmediği için doğrulama da başarısız olmalı.
        var verify = await service.VerifyAsync(
            Login("Baska Isim", ReviewPhone), ReviewCode,
            CustomerOtpPurpose.Login, null, CancellationToken.None);

        Assert.True(verify.IsFailure);
    }
}

using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Maydanoz'da giriş, hesap ve satın alma (bağlayıcı). Panel girişiyle aynı kilit; süresi dolmuş kurumun sahibi
/// de girer (satın almak için); elle askıya alınmış/iptal kurum giremez; BeautyAsist oturumu verilmez.
/// </summary>
public sealed class ConnectorAccountServiceTests
{
    private static readonly DateTime Now = new(2026, 11, 18, 9, 0, 0, DateTimeKind.Utc);

    private readonly DbContextOptions<GuzellikDbContext> _options = new DbContextOptionsBuilder<GuzellikDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options;

    private readonly IPlatformMessagingService _messaging = Substitute.For<IPlatformMessagingService>();

    private readonly IBillingService _billing = Substitute.For<IBillingService>();

    private readonly IWhatsAppBillingService _credits = Substitute.For<IWhatsAppBillingService>();

    private readonly GuzellikMerkezi.Infrastructure.Services.MemoryOtpStateStore _store = new(new MemoryCache(new MemoryCacheOptions()));

    public ConnectorAccountServiceTests()
    {
        _messaging.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "id", null));
        _billing.GetQuoteAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), BillingPeriod.Monthly, Arg.Any<CancellationToken>())
            .Returns(Result<SubscriptionQuote>.Success(Quote(1000m, 2)));
        _billing.GetQuoteAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), BillingPeriod.Yearly, Arg.Any<CancellationToken>())
            .Returns(Result<SubscriptionQuote>.Failure(Error.Conflict("yok")));
    }

    private static SubscriptionQuote Quote(decimal net, int branches) =>
        new("BeautyAsist", BillingPeriod.Monthly, [], net, 20m, net * 0.2m, net * 1.2m, branches, 0, 0);

    private GuzellikDbContext NewDb() => new(_options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private ConnectorAccountService NewService(GuzellikDbContext db)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production");
        return new ConnectorAccountService(db, new PlainPasswordHasher(), _store, _messaging, _billing, new FixedClock(Now), env,
            NullLogger<ConnectorAccountService>.Instance, _credits);
    }

    private async Task<Tenant> SeedAsync(string name, string email = "sahip@ornek.com", string password = "Parola123!", Action<Tenant>? shape = null)
    {
        await using var db = NewDb();
        var plan = await db.SubscriptionPlans.FirstOrDefaultAsync();
        if (plan is null)
        {
            plan = new SubscriptionPlan("BeautyAsist", "BeautyAsist", 1000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10000m);
            db.SubscriptionPlans.Add(plan);
        }

        var tenant = new Tenant(name, name.ToLowerInvariant().Replace(' ', '-'), "BeautyAsist");
        tenant.AssignCode("BA-" + (await db.Tenants.CountAsync() + 1).ToString("00"));
        tenant.AssignSubscriptionPlan(plan);
        tenant.SetContact("0555 111 22 33", "1234567890");
        tenant.SetProfileExtras("Salon Ltd.", "Konak", email);
        tenant.AddBranch("Merkez", "İzmir", isDefault: true);
        var owner = tenant.GrantAccess(email, UserRole.InstitutionOwner, null, "Ayşe Yılmaz");
        owner.SetPasswordHash(password);
        shape?.Invoke(tenant);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return tenant;
    }

    private string LastCode() =>
        System.Text.RegularExpressions.Regex.Match(
            (string)_messaging.ReceivedCalls().Last(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync)).GetArguments()[2]!,
            @"letter-spacing:8px[^>]*>(\d{6})<").Groups[1].Value;

    [Fact]
    public async Task Login_SendsAnEmailCode_AndOnlyTheRightCodeReturnsTheIdentity()
    {
        var tenant = await SeedAsync("Güzel Salon");
        await using var db = NewDb();
        var service = NewService(db);

        var login = await service.LoginAsync(new ConnectorAccountLoginRequest("SAHIP@ornek.com ", "Parola123!"), default);
        Assert.Equal(ConnectorAccountLoginDto.StepCode, login.Value!.Step);
        Assert.Null(login.Value.DevCode);
        var code = LastCode();

        Assert.Contains("hatalı", (await service.VerifyAsync(new ConnectorAccountVerifyRequest(login.Value.ChallengeId, "000000"), default)).Error.Message);
        var identity = await service.VerifyAsync(new ConnectorAccountVerifyRequest(login.Value.ChallengeId, code), default);
        Assert.Equal((tenant.Id, "sahip@ornek.com", "Güzel Salon", "BA-01"), (identity.Value!.TenantId, identity.Value.Email, identity.Value.TenantName, identity.Value.TenantCode));
        Assert.Contains("sona ermiş", (await service.VerifyAsync(new ConnectorAccountVerifyRequest(login.Value.ChallengeId, code), default)).Error.Message);
        Assert.Contains("sona ermiş", (await service.VerifyAsync(new ConnectorAccountVerifyRequest(null, code), default)).Error.Message);

        // Beş yanlış kodda meydan okuma düşer.
        var again = await service.LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "Parola123!"), default);
        for (var i = 0; i < 4; i++) await service.VerifyAsync(new ConnectorAccountVerifyRequest(again.Value!.ChallengeId, "111111"), default);
        Assert.Contains("Çok fazla", (await service.VerifyAsync(new ConnectorAccountVerifyRequest(again.Value!.ChallengeId, "111111"), default)).Error.Message);
    }

    [Fact]
    public async Task Login_WrongPasswordsLockTheAccount_AndMissingFieldsAreRefused()
    {
        await SeedAsync("Güzel Salon");
        await using var db = NewDb();
        var service = NewService(db);
        Assert.Equal("Validation", (await service.LoginAsync(new ConnectorAccountLoginRequest(null, null), default)).Error.Code);
        Assert.Contains("hatalı", (await service.LoginAsync(new ConnectorAccountLoginRequest("yok@ornek.com", "x"), default)).Error.Message);
        for (var i = 0; i < 7; i++)
        {
            Assert.Contains("hatalı", (await service.LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "yanlis"), default)).Error.Message);
        }

        Assert.Contains("kilitlendi", (await service.LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "yanlis"), default)).Error.Message);
        // Kilitliyken doğru parola da işe yaramaz.
        Assert.Contains("kilitlendi", (await service.LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "Parola123!"), default)).Error.Message);
    }

    [Fact]
    public async Task Login_ListsTenants_AdmitsExpired_AndShutsOutSuspendedOrCancelled()
    {
        var first = await SeedAsync("Birinci Salon");
        var expired = await SeedAsync("İkinci Salon", shape: t => { t.StartTrial(Now.AddDays(-30)); t.Suspend(); });
        await SeedAsync("Kapalı Salon", shape: t => t.Suspend());
        await SeedAsync("İptal Salon", shape: t => t.Cancel());
        await using var db = NewDb();
        var service = NewService(db);

        var choose = await service.LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "Parola123!"), default);
        Assert.Equal(ConnectorAccountLoginDto.StepTenant, choose.Value!.Step);
        Assert.Equal(
            [(first.Id, "trial"), (expired.Id, "expired")],
            choose.Value.Tenants!.Select(t => (t.TenantId, t.Status)).ToArray());

        var picked = await service.LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "Parola123!", expired.Id), default);
        Assert.Equal(ConnectorAccountLoginDto.StepCode, picked.Value!.Step);

        var closed = await SeedAsync("Yalnız Kapalı", email: "kapali@ornek.com", shape: t => t.Suspend());
        Assert.Contains("kapalı", (await service.LoginAsync(new ConnectorAccountLoginRequest("kapali@ornek.com", "Parola123!"), default)).Error.Message);
        Assert.NotEqual(Guid.Empty, closed.Id);
    }

    [Fact]
    public async Task Login_WhenTheCodeCannotBeSent_NoChallengeIsGiven()
    {
        await SeedAsync("Güzel Salon");
        _messaging.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, true, null, null));
        await using var db = NewDb();
        Assert.Contains("gönderilemedi", (await NewService(db).LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "Parola123!"), default)).Error.Message);

        _messaging.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns<MessagingTestResult>(_ => throw new InvalidOperationException("smtp"));
        Assert.Contains("gönderilemedi", (await NewService(db).LoginAsync(new ConnectorAccountLoginRequest("sahip@ornek.com", "Parola123!"), default)).Error.Message);
    }

    [Fact]
    public async Task Account_ReturnsStatusContactAndThisTenantsPrices()
    {
        var tenant = await SeedAsync("Güzel Salon");
        await using var db = NewDb();
        var account = (await NewService(db).AccountAsync(tenant.Id, default)).Value!;
        Assert.Equal(("BA-01", "trial", false, "BeautyAsist", 1, "Ayşe Yılmaz", "sahip@ornek.com", "İzmir", "Konak", "1234567890"),
            (account.Code, account.Status, account.TrialStarted, account.PlanName, account.Branches, account.OwnerName, account.Email, account.City, account.TaxOffice, account.TaxNumber));
        Assert.Equal(new ConnectorPriceDto(100000, 20000, 120000, 2), account.Monthly);
        Assert.Null(account.Yearly);
        Assert.Equal("NotFound", (await NewService(db).AccountAsync(Guid.NewGuid(), default)).Error.Code);
    }

    [Fact]
    public async Task Credits_ShowEachChannelsBalancePriceAndPackages()
    {
        var tenant = await SeedAsync("Güzel Salon");
        await using var db = NewDb();
        var service = NewService(db);
        CreditPackageDto Package(string name, CreditChannel channel, bool active = true) =>
            new(Guid.NewGuid(), name, null, 300m, 1000m, 1, active, 1000, channel);
        var wallet = new MessagingWalletDto(
            tenant.Id, 30m, 0m, 30m, 30m, 0m, 50m, false, 0, 500, 0, 0, 0, 0, 0m, null, false, false, 1m, 6m, 1m, 30, 1000,
            0.15m, true, [Package("WA 500", CreditChannel.WhatsApp), Package("SMS 1000", CreditChannel.Sms), Package("Eski SMS", CreditChannel.Sms, active: false)],
            PayOnMaydanoz: true, SmsBalanceCredits: 1000m, SmsAvailableCredits: 1000m, SmsCreditUnitPriceTry: 0.40m);
        _credits.GetWalletAsync(tenant.Id, Arg.Any<CancellationToken>()).Returns(Result<MessagingWalletDto>.Success(wallet));

        var credits = (await service.CreditsAsync(tenant.Id, default)).Value!;
        Assert.Equal((30m, 15L, "WA 500"), (credits.WhatsApp.Available, credits.WhatsApp.UnitPriceKurus, Assert.Single(credits.WhatsApp.Packages).Name));
        Assert.Equal((1000m, 40L, "SMS 1000", 30000L), (credits.Sms.Available, credits.Sms.UnitPriceKurus, Assert.Single(credits.Sms.Packages).Name, credits.Sms.Packages[0].PriceKurus));
        Assert.Equal("NotFound", (await service.CreditsAsync(Guid.NewGuid(), default)).Error.Code);
        _credits.GetWalletAsync(tenant.Id, Arg.Any<CancellationToken>()).Returns(Result<MessagingWalletDto>.Failure(Error.Conflict("olmaz")));
        Assert.Equal("Conflict", (await service.CreditsAsync(tenant.Id, default)).Error.Code);
    }

    [Fact]
    public async Task CreditCheckout_StartsTheMaydanozPayment_OnTheChosenChannel()
    {
        var tenant = await SeedAsync("Güzel Salon");
        var suspended = await SeedAsync("Kapalı Salon", email: "k@ornek.com", shape: t => t.Suspend());
        await using var db = NewDb();
        var service = NewService(db);
        const string back = "https://maydanozasist.com/hesabim?odeme=kredi";
        _credits.StartCreditCheckoutAsync(tenant.Id, Arg.Is<TopUpRequest>(r => r!.Channel == CreditChannel.Sms && r.Credits == 500), back, null, Arg.Any<CancellationToken>())
            .Returns(Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(new string('c', 32), null, "https://maydanozasist.com/odeme/asist/beauty/" + new string('c', 32), 200m)));

        var started = await service.CreditCheckoutAsync(tenant.Id, new ConnectorAccountCreditCheckoutRequest("Sms", null, 500, back), default);
        Assert.Equal((new string('c', 32), 20000L), (started.Value!.Reference, started.Value.AmountKurus));

        foreach (var bad in new ConnectorAccountCreditCheckoutRequest[]
                 {
                     new("fax", null, 500, back), new(null, null, 500, back), new("sms", null, null, back), new("sms", null, 0, back),
                     new("sms", null, 5, "http://maydanozasist.com"), new("sms", null, 5, "kötü"), new("sms", null, 5, "https://u:p@maydanozasist.com"),
                 })
        {
            Assert.Equal("Validation", (await service.CreditCheckoutAsync(tenant.Id, bad, default)).Error.Code);
        }
        Assert.Equal("NotFound", (await service.CreditCheckoutAsync(suspended.Id, new("whatsapp", Guid.NewGuid(), null, back), default)).Error.Code);
        Assert.Equal("NotFound", (await service.CreditCheckoutAsync(Guid.NewGuid(), new("whatsapp", Guid.NewGuid(), null, back), default)).Error.Code);

        var package = Guid.NewGuid();
        _credits.StartCreditCheckoutAsync(tenant.Id, Arg.Is<TopUpRequest>(r => r!.CreditPackageId == package && r.Channel == CreditChannel.WhatsApp), back, null, Arg.Any<CancellationToken>())
            .Returns(Result<CheckoutStartedDto>.Success(new CheckoutStartedDto("tok", "<form/>", null, 75m)));
        Assert.Equal("Conflict", (await service.CreditCheckoutAsync(tenant.Id, new("WhatsApp", package, null, back), default)).Error.Code);
        _credits.StartCreditCheckoutAsync(tenant.Id, Arg.Is<TopUpRequest>(r => r!.CreditPackageId == package), back, null, Arg.Any<CancellationToken>())
            .Returns(Result<CheckoutStartedDto>.Failure(Error.Validation("Bu paket SMS kredisi paketi.")));
        Assert.Equal("Validation", (await service.CreditCheckoutAsync(tenant.Id, new("WhatsApp", package, null, back), default)).Error.Code);
    }

    [Fact]
    public async Task Checkout_StartsTheMaydanozPayment_ForThisTenantOnly()
    {
        var tenant = await SeedAsync("Güzel Salon");
        var suspended = await SeedAsync("Kapalı Salon", email: "k@ornek.com", shape: t => t.Suspend());
        await using var db = NewDb();
        var service = NewService(db);
        const string back = "https://maydanozasist.com/hesabim";
        _billing.StartCheckoutAsync(tenant.Id, Arg.Any<Guid>(), BillingPeriod.Yearly, back, Arg.Any<CancellationToken>())
            .Returns(Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(new string('a', 32), null, "https://maydanozasist.com/odeme/asist/beauty/" + new string('a', 32), 12000m)));

        var started = await service.CheckoutAsync(tenant.Id, new ConnectorAccountCheckoutRequest("yearly", back), default);
        Assert.Equal((new string('a', 32), 1200000L), (started.Value!.Reference, started.Value.AmountKurus));

        Assert.Equal("Validation", (await service.CheckoutAsync(tenant.Id, new ConnectorAccountCheckoutRequest("weekly", back), default)).Error.Code);
        Assert.Equal("Validation", (await service.CheckoutAsync(tenant.Id, new ConnectorAccountCheckoutRequest("monthly", "http://maydanozasist.com"), default)).Error.Code);
        Assert.Equal("NotFound", (await service.CheckoutAsync(suspended.Id, new ConnectorAccountCheckoutRequest("monthly", back), default)).Error.Code);
        Assert.Equal("NotFound", (await service.CheckoutAsync(Guid.NewGuid(), new ConnectorAccountCheckoutRequest("monthly", back), default)).Error.Code);

        _billing.StartCheckoutAsync(tenant.Id, Arg.Any<Guid>(), BillingPeriod.Monthly, back, Arg.Any<CancellationToken>())
            .Returns(Result<CheckoutStartedDto>.Success(new CheckoutStartedDto("tok", "<form/>", null, 1200m)));
        Assert.Equal("Conflict", (await service.CheckoutAsync(tenant.Id, new ConnectorAccountCheckoutRequest("monthly", back), default)).Error.Code);
        _billing.StartCheckoutAsync(tenant.Id, Arg.Any<Guid>(), BillingPeriod.Monthly, back, Arg.Any<CancellationToken>())
            .Returns(Result<CheckoutStartedDto>.Failure(Error.Validation("olmaz")));
        Assert.Equal("Validation", (await service.CheckoutAsync(tenant.Id, new ConnectorAccountCheckoutRequest("monthly", back), default)).Error.Code);
    }

    [Fact]
    public void Status_SeparatesExpiryFromManualSuspension()
    {
        Tenant Make(Action<Tenant> shape)
        {
            var t = new Tenant("S", "s", "BeautyAsist");
            shape(t);
            return t;
        }

        Assert.Equal("trial", ConnectorAccountService.StatusOf(Make(_ => { }), Now));
        Assert.Equal("expired", ConnectorAccountService.StatusOf(Make(t => t.StartTrial(Now.AddDays(-20))), Now));
        Assert.Equal("cancelled", ConnectorAccountService.StatusOf(Make(t => t.Cancel()), Now));
        Assert.Equal("suspended", ConnectorAccountService.StatusOf(Make(t => t.Suspend()), Now));
        var plan = new SubscriptionPlan("BeautyAsist", "BeautyAsist", 1000m, -1, -1, -1, -1, 0);
        Assert.Equal("active", ConnectorAccountService.StatusOf(Make(t => t.StartSubscription(plan, BillingPeriod.Monthly, Now)), Now));
        Assert.Equal("expired", ConnectorAccountService.StatusOf(Make(t => t.StartSubscription(plan, BillingPeriod.Monthly, Now.AddMonths(-2))), Now));
        Assert.Equal("expired", ConnectorAccountService.StatusOf(Make(t => { t.StartSubscription(plan, BillingPeriod.Monthly, Now.AddMonths(-2)); t.Suspend(); }), Now));
    }
}

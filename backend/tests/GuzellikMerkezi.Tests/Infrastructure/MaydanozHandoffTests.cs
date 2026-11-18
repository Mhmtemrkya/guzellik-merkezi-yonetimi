using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
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
/// MAYDANOZ'A OTURUMLU GEÇİŞ (kullanıcı isteği 18 Kas 2026: "Maydanoz'un satın alma sayfasında form boş oluyor, giriş yapmamış
/// olabiliyor"). Değişmezler: (1) jeton yalnız kurum yetkilisine ve yalnız bu kurumun Maydanoz ödeme sayfası adresine eklenir;
/// (2) yalnız özeti saklanır; (3) tek kullanımlıktır, süresi dolar; (4) bozdururken kimlik veritabanından yeniden doğrulanır
/// (etkin yetkili, kapalı / askıda olmayan kurum) ve jetonun bağlı olduğu ödeme kaydı döner.
/// </summary>
public sealed class MaydanozHandoffTests
{
    private const string Site = "https://maydanozasist.com";

    private static readonly string Ref = new('c', 32);

    private static readonly DateTime Now = DateTime.UtcNow;

    private readonly DbContextOptions<GuzellikDbContext> _options = new DbContextOptionsBuilder<GuzellikDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options;

    private GuzellikDbContext NewDb() => new(_options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static IConfiguration Config(string? site = Site) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [PaymentGatewayResolver.MaydanozSiteUrlKey] = site }).Build();

    private static MaydanozHandoffService Handoffs(GuzellikDbContext db, string? site = Site) => new(db, Config(site));

    private ConnectorAccountService Accounts(GuzellikDbContext db, DateTime? now = null)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production");
        return new ConnectorAccountService(db, new PlainPasswordHasher(),
            new GuzellikMerkezi.Infrastructure.Services.MemoryOtpStateStore(new MemoryCache(new MemoryCacheOptions())),
            Substitute.For<IPlatformMessagingService>(), Substitute.For<IBillingService>(), new FixedClock(now ?? Now), env,
            NullLogger<ConnectorAccountService>.Instance, Substitute.For<IWhatsAppBillingService>());
    }

    private sealed record Seed(Guid TenantId, Guid OwnerId, Guid ManagerId, Guid OtherTenantId);

    private async Task<Seed> SeedAsync(string ownerEmail = "sahip@ornek.com")
    {
        await using var db = NewDb();
        var tenant = new Tenant("Işıl Güzellik", $"isil-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
        tenant.AssignCode("BA-12");
        var branch = tenant.AddBranch("Merkez", "İzmir", true);
        var owner = tenant.GrantAccess(ownerEmail, UserRole.InstitutionOwner, null, "Ayşe Yılmaz");
        var manager = tenant.GrantAccess("sube@ornek.com", UserRole.BranchManager, branch.Id, "Şube Yöneticisi");
        var other = new Tenant("Başka Kurum", $"baska-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
        other.AddBranch("Merkez", "İzmir", true);
        db.Tenants.AddRange(tenant, other);
        db.ExternalCheckouts.Add(new ExternalCheckout(Ref, "conv-handoff", ExternalCheckout.KindCredit, tenant.Id, 120m, "Kredi", "https://api.example/cb", Now));
        db.ExternalCheckouts.Add(new ExternalCheckout(new string('d', 32), "conv-other", ExternalCheckout.KindCredit, other.Id, 120m, "Kredi", "https://api.example/cb", Now));
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, owner.Id, manager.Id, other.Id);
    }

    private static Result<CheckoutStartedDto> Started(string reference = "", string? url = null) =>
        Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(reference, null, url ?? $"{Site}/odeme/asist/beauty/{(reference.Length > 0 ? reference : Ref)}", 120m));

    private static string TokenOf(Result<CheckoutStartedDto> result)
    {
        var url = result.Value!.RedirectUrl!;
        Assert.Contains($"#{MaydanozHandoffService.Fragment}=", url);
        return url[(url.IndexOf('=', url.IndexOf('#')) + 1)..];
    }

    [Fact]
    public async Task TheOwner_GetsAOneTimeToken_BoundToThisCheckout()
    {
        var seed = await SeedAsync();
        string token;
        await using (var db = NewDb())
        {
            var owner = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId) { UserId = seed.OwnerId };
            var result = await Handoffs(db).AttachAsync(Started(), owner, seed.TenantId, CancellationToken.None);
            Assert.StartsWith($"{Site}/odeme/asist/beauty/{Ref}#giris=", result.Value!.RedirectUrl);
            token = TokenOf(result);
            Assert.Equal(43, token.Length);
            var stored = await db.MaydanozHandoffs.SingleAsync();
            Assert.Equal((seed.TenantId, seed.OwnerId, Ref), (stored.TenantId, stored.UserId, stored.CheckoutRef));
            Assert.NotEqual(token, stored.TokenHash);
            Assert.Equal(MaydanozHandoffService.Hash(token), stored.TokenHash);
            Assert.Equal(MaydanozHandoff.Lifetime, stored.ExpiresAtUtc - stored.CreatedAtUtc);
        }

        await using (var db = NewDb())
        {
            var redeemed = await Accounts(db).HandoffAsync(new ConnectorAccountHandoffRequest($" {token} "), CancellationToken.None);
            Assert.True(redeemed.IsSuccess, redeemed.IsFailure ? redeemed.Error.Message : null);
            Assert.Equal((seed.TenantId, seed.OwnerId, "sahip@ornek.com", "Işıl Güzellik", "BA-12", Ref),
                (redeemed.Value!.TenantId, redeemed.Value.UserId, redeemed.Value.Email, redeemed.Value.TenantName, redeemed.Value.TenantCode, redeemed.Value.Reference));
        }

        // Tek kullanım: ikinci bozdurma reddedilir.
        await using (var db = NewDb())
        {
            Assert.Equal("Unauthorized", (await Accounts(db).HandoffAsync(new ConnectorAccountHandoffRequest(token), CancellationToken.None)).Error.Code);
        }
    }

    [Fact]
    public async Task NoToken_ForOtherRoles_OtherTenants_OtherSites_OrFailedStarts()
    {
        var seed = await SeedAsync();
        await using var db = NewDb();
        var handoffs = Handoffs(db);
        var owner = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId) { UserId = seed.OwnerId };

        var failed = Result<CheckoutStartedDto>.Failure(Error.Conflict("yok"));
        Assert.Same(failed, await handoffs.AttachAsync(failed, owner, seed.TenantId, CancellationToken.None));
        var noRedirect = Result<CheckoutStartedDto>.Success(new CheckoutStartedDto("x", "<form/>", null, 1m));
        Assert.Same(noRedirect, await handoffs.AttachAsync(noRedirect, owner, seed.TenantId, CancellationToken.None));

        foreach (var (user, tenantId, started) in new (TestCurrentUser, Guid, Result<CheckoutStartedDto>)[]
                 {
                     (new TestCurrentUser(UserRole.BranchManager, seed.TenantId) { UserId = seed.ManagerId }, seed.TenantId, Started()),
                     (new TestCurrentUser(UserRole.PlatformAdmin) { UserId = seed.OwnerId }, seed.TenantId, Started()),
                     (new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId) { UserId = null }, seed.TenantId, Started()),
                     (owner, seed.TenantId, Started(url: $"https://kotu.example/odeme/asist/beauty/{Ref}")),
                     (owner, seed.TenantId, Started(url: $"{Site}/odeme/asist/beauty/{Ref}?x=1")),
                     (owner, seed.TenantId, Started(url: $"{Site}/hesabim")),
                     (owner, seed.TenantId, Started(new string('d', 32))),
                     (new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId) { UserId = seed.ManagerId }, seed.TenantId, Started()),
                 })
        {
            var result = await handoffs.AttachAsync(started, user, tenantId, CancellationToken.None);
            Assert.DoesNotContain("#giris=", result.Value!.RedirectUrl);
        }

        // Maydanoz sitesi yapılandırılmamış: jeton yok.
        Assert.DoesNotContain("#", (await Handoffs(db, site: null).AttachAsync(Started(), owner, seed.TenantId, CancellationToken.None)).Value!.RedirectUrl);
        Assert.Empty(await db.MaydanozHandoffs.ToListAsync());

        Assert.Equal(Ref, MaydanozHandoffService.ReferenceOf($"{Site}/odeme/asist/doctor/{Ref}", Site));
        Assert.Null(MaydanozHandoffService.ReferenceOf("not a url", Site));
        Assert.Null(MaydanozHandoffService.ReferenceOf($"http://maydanozasist.com/odeme/asist/beauty/{Ref}", Site));
        Assert.Null(MaydanozHandoffService.ReferenceOf($"{Site}/odeme/asist/beauty/{Ref}#x", Site));
    }

    [Fact]
    public async Task AMultiTenantOwner_GetsTheTokenOfThisTenantsOwnerRow_ByEmail()
    {
        // Çoklu kurum yetkilisi: oturumdaki kullanıcı kimliği başka kurumun satırı; e-postası bu kurumun yetkilisiyle aynı.
        var seed = await SeedAsync(ownerEmail: "test@qa.test");
        await using var db = NewDb();
        var elsewhere = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId) { UserId = Guid.NewGuid() };
        TokenOf(await Handoffs(db).AttachAsync(Started(), elsewhere, seed.TenantId, CancellationToken.None));
        Assert.Equal(seed.OwnerId, (await db.MaydanozHandoffs.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Redeeming_RefusesMalformedUnknownExpiredNonOwnerAndSuspended()
    {
        var seed = await SeedAsync();
        await using (var db = NewDb())
        {
            var accounts = Accounts(db);
            foreach (var token in new string?[] { null, "kisa", new string('x', 200), new string('x', 43) })
            {
                Assert.Equal("Unauthorized", (await accounts.HandoffAsync(new ConnectorAccountHandoffRequest(token), CancellationToken.None)).Error.Code);
            }

            db.MaydanozHandoffs.Add(new MaydanozHandoff(MaydanozHandoffService.Hash(new string('e', 43)), seed.TenantId, seed.OwnerId, Ref, Now.AddHours(-1)));
            db.MaydanozHandoffs.Add(new MaydanozHandoff(MaydanozHandoffService.Hash(new string('m', 43)), seed.TenantId, seed.ManagerId, Ref, Now));
            db.MaydanozHandoffs.Add(new MaydanozHandoff(MaydanozHandoffService.Hash(new string('s', 43)), seed.TenantId, seed.OwnerId, Ref, Now));
            await db.SaveChangesAsync();

            // Süresi doldu.
            var expired = await accounts.HandoffAsync(new ConnectorAccountHandoffRequest(new string('e', 43)), CancellationToken.None);
            Assert.Contains("süresi doldu", expired.Error.Message);
            // Kurum yetkilisi değil.
            Assert.Equal("Hesap bulunamadı.", (await accounts.HandoffAsync(new ConnectorAccountHandoffRequest(new string('m', 43)), CancellationToken.None)).Error.Message);
        }

        // Askıdaki kurum.
        await using (var db = NewDb())
        {
            (await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == seed.TenantId)).Suspend();
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb())
        {
            Assert.Equal("Hesap bulunamadı.", (await Accounts(db).HandoffAsync(new ConnectorAccountHandoffRequest(new string('s', 43)), CancellationToken.None)).Error.Message);
        }
    }
}

/// <summary>
/// Canlının yolu (ham SQL) GERÇEK MySQL'de: tek kullanım koşullu UPDATE ile sağlanır — aynı jetonla EŞZAMANLI iki bozdurmadan
/// yalnız biri kazanır; süresi geçmiş jeton bozdurulamaz ve tüketilmiş sayılmaz; bir günden eski satırlar yeni jetonda silinir.
/// </summary>
public sealed class MaydanozHandoffMySqlTests
{
    private const string Site = "https://maydanozasist.com";

    private static ConnectorAccountService Accounts(GuzellikDbContext db, DateTime now)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production");
        return new ConnectorAccountService(db, new PlainPasswordHasher(),
            new GuzellikMerkezi.Infrastructure.Services.MemoryOtpStateStore(new MemoryCache(new MemoryCacheOptions())),
            Substitute.For<IPlatformMessagingService>(), Substitute.For<IBillingService>(), new FixedClock(now), env,
            NullLogger<ConnectorAccountService>.Instance, Substitute.For<IWhatsAppBillingService>());
    }

    private static async Task<string> IssueAsync(MySqlTestDatabase database, Guid tenantId, Guid ownerId, string reference)
    {
        await using var db = database.NewContext();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [PaymentGatewayResolver.MaydanozSiteUrlKey] = Site }).Build();
        var owner = new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = ownerId };
        var started = Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(reference, null, $"{Site}/odeme/asist/beauty/{reference}", 120m));
        var url = (await new MaydanozHandoffService(db, config).AttachAsync(started, owner, tenantId, CancellationToken.None)).Value!.RedirectUrl!;
        Assert.Contains("#giris=", url);
        return url[(url.IndexOf("#giris=", StringComparison.Ordinal) + "#giris=".Length)..];
    }

    [MySqlFact]
    public async Task OnMySql_ATokenIsRedeemedOnce_EvenConcurrently_AndOldRowsArePurged()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var reference = new string('c', 32);
        var now = DateTime.UtcNow;
        Guid tenantId, ownerId;
        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Işıl Güzellik", $"isil-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
            tenant.AssignCode("BA-12");
            tenant.AddBranch("Merkez", "İzmir", true);
            var owner = tenant.GrantAccess("sahip@ornek.com", UserRole.InstitutionOwner, null, "Ayşe Yılmaz");
            db.Tenants.Add(tenant);
            db.ExternalCheckouts.Add(new ExternalCheckout(reference, "conv-handoff", ExternalCheckout.KindCredit, tenant.Id, 120m, "Kredi", "https://api.example/cb", now));
            // Üç gün önce verilmiş, hiç kullanılmamış jeton: yeni jeton verilirken silinir.
            db.MaydanozHandoffs.Add(new MaydanozHandoff(new string('0', 64), tenant.Id, owner.Id, reference, now.AddDays(-3)));
            await db.SaveChangesAsync();
            (tenantId, ownerId) = (tenant.Id, owner.Id);
        }

        var token = await IssueAsync(database, tenantId, ownerId, reference);
        await using (var check = database.NewContext())
        {
            Assert.Equal(MaydanozHandoffService.Hash(token), (await check.MaydanozHandoffs.SingleAsync()).TokenHash);
        }

        // Aynı jetonla eşzamanlı iki bozdurma (iki ayrı bağlantı): yalnız biri oturum açar.
        var attempts = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            await using var db = database.NewContext();
            return await Accounts(db, DateTime.UtcNow).HandoffAsync(new ConnectorAccountHandoffRequest(token), CancellationToken.None);
        }));
        Assert.Single(attempts, attempt => attempt.IsSuccess);
        Assert.Single(attempts, attempt => attempt.IsFailure && attempt.Error.Code == "Unauthorized");
        Assert.Equal(reference, attempts.Single(attempt => attempt.IsSuccess).Value!.Reference);

        // Süresi geçmiş jeton: bozdurulamaz, tüketilmiş de sayılmaz.
        var late = await IssueAsync(database, tenantId, ownerId, reference);
        await using (var db = database.NewContext())
        {
            var refused = await Accounts(db, DateTime.UtcNow.Add(MaydanozHandoff.Lifetime).AddMinutes(1))
                .HandoffAsync(new ConnectorAccountHandoffRequest(late), CancellationToken.None);
            Assert.Equal("Unauthorized", refused.Error.Code);
        }

        await using (var check = database.NewContext())
        {
            var rows = await check.MaydanozHandoffs.AsNoTracking().ToListAsync();
            Assert.Equal(2, rows.Count);
            Assert.NotNull(rows.Single(row => row.TokenHash == MaydanozHandoffService.Hash(token)).ConsumedAtUtc);
            Assert.Null(rows.Single(row => row.TokenHash == MaydanozHandoffService.Hash(late)).ConsumedAtUtc);
        }
    }
}

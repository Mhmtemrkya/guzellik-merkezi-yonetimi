using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AccountDeletion;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// HESAP SİLME — "Hesabımı sil".
///
/// <para>
/// İki farklı anlam test edilir: KURUM silme (bekleme süreli, geri alınabilir) ve MÜŞTERİ
/// silme (anında, satır silinmez — anonimleştirilir).
/// </para>
/// </summary>
public sealed class AccountDeletionTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ICurrentUser user) =>
        new(options, null, user, null, null, TestSearchIndex.Create());

    /// <summary>Müşteri kimliği taşıyabilen oturum (portal müşterisi testleri için).</summary>
    private sealed class PortalUser : ICurrentUser
    {
        public PortalUser(Guid customerId) => CustomerId = customerId;
        public Guid? UserId => null;
        public string? Email => null;
        public UserRole? Role => UserRole.Customer;
        public Guid? TenantId => null;
        public Guid? BranchId => null;
        public Guid? CustomerId { get; }
        public bool IsAuthenticated => true;
        public bool IsPlatformAdmin => false;
        public string? IpAddress => "127.0.0.1";
        public string? DeviceId => null;
        public string? DeviceInfoJson => null;
        public IReadOnlyCollection<string> Permissions => [];
    }

    private static AccountDeletionService NewService(GuzellikDbContext db, ICurrentUser user, int graceDays = 30) =>
        new(db, user, new PlainPasswordHasher(), new NoopAuditLogger(), new FixedClock(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AccountDeletion:TenantGraceDays"] = graceDays.ToString(),
            }).Build(),
            NullLogger<AccountDeletionService>.Instance);

    /// <summary>Kurum + yöneticisi kurar; yöneticinin parolası "Parola123!".</summary>
    private static async Task<(Guid TenantId, Guid UserId, string Code)> SeedTenantAsync(
        DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options, new TestCurrentUser());
        var tenant = new Tenant("Güzel Salon", "guzel-salon", "Premium");
        tenant.AssignCode("BA-01");
        tenant.AddBranch("Merkez", "İstanbul", isDefault: true);
        var owner = tenant.GrantAccess("sahip@ornek.com", UserRole.InstitutionOwner, null, "Ayşe Yılmaz");
        owner.SetPasswordHash(new PlainPasswordHasher().Hash("Parola123!"));
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return (tenant.Id, owner.Id, "BA-01");
    }

    // ================================================================= KURUM

    /// <summary>
    /// Talep ANINDA SİLMEZ: tarih ileri atılır, kurum durumu DEĞİŞMEZ.
    /// </summary>
    /// <remarks>
    /// Durumu hemen askıya almak, "fikrimi değiştirdim" diyen kullanıcıyı vazgeçemez hâle
    /// getirirdi — bekleme süresinin var olma sebebi tam olarak budur.
    /// </remarks>
    [Fact]
    public async Task KurumSilmeTalebi_AnindaSilmez_DurumDegismez()
    {
        var options = NewOptions();
        var (tenantId, userId, code) = await SeedTenantAsync(options);

        await using var db = NewDb(options, new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId });
        var result = await NewService(db, new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId })
            .RequestTenantDeletionAsync(new RequestTenantDeletionRequest("Parola123!", code, "Başka ürüne geçiyoruz"));

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.Pending);
        Assert.Equal(30, result.Value.GraceDays);
        Assert.NotNull(result.Value.ScheduledAtUtc);

        await using var verify = NewDb(options, new TestCurrentUser());
        var tenant = await verify.Tenants.IgnoreQueryFilters().SingleAsync();
        Assert.True(tenant.IsDeletionPending);
        // KURUM DURMAYA DEVAM EDER: panel çalışır, veri dışa aktarılabilir.
        Assert.NotEqual(TenantStatus.Cancelled, tenant.Status);
        Assert.Equal("Başka ürüne geçiyoruz", tenant.DeletionReason);
    }

    /// <summary>Parola yanlışsa talep alınmaz — açık kalmış bir oturum tek tıkla kurumu silemez.</summary>
    [Fact]
    public async Task YanlisParola_TalebiReddeder()
    {
        var options = NewOptions();
        var (tenantId, userId, code) = await SeedTenantAsync(options);
        var user = new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId };

        await using var db = NewDb(options, user);
        var result = await NewService(db, user)
            .RequestTenantDeletionAsync(new RequestTenantDeletionRequest("yanlis", code, null));

        Assert.True(result.IsFailure);
        await using var verify = NewDb(options, new TestCurrentUser());
        Assert.False((await verify.Tenants.IgnoreQueryFilters().SingleAsync()).IsDeletionPending);
    }

    /// <summary>Onay metni (kurum kodu) yanlışsa talep alınmaz — refleksle basılamaz.</summary>
    [Fact]
    public async Task YanlisOnayMetni_TalebiReddeder()
    {
        var options = NewOptions();
        var (tenantId, userId, _) = await SeedTenantAsync(options);
        var user = new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId };

        await using var db = NewDb(options, user);
        var result = await NewService(db, user)
            .RequestTenantDeletionAsync(new RequestTenantDeletionRequest("Parola123!", "SIL", null));

        Assert.True(result.IsFailure);
    }

    /// <summary>
    /// YALNIZ KURUM YÖNETİCİSİ. Personel hesabı kişinin değil KURUMUN açtığı bir erişimdir.
    /// </summary>
    [Fact]
    public async Task Personel_KurumuSilemez()
    {
        var options = NewOptions();
        var (tenantId, userId, code) = await SeedTenantAsync(options);
        var staff = new TestCurrentUser(UserRole.Staff, tenantId) { UserId = userId };

        await using var db = NewDb(options, staff);
        var result = await NewService(db, staff)
            .RequestTenantDeletionAsync(new RequestTenantDeletionRequest("Parola123!", code, null));

        Assert.True(result.IsFailure);
        Assert.Equal("Forbidden", result.Error.Code);
    }

    /// <summary>
    /// TEKRAR TALEP SİLME GÜNÜNÜ ÖTELEMEZ — aksi hâlde düğmeye her basış tarihi ileri atar ve
    /// talep hiç olgunlaşmazdı.
    /// </summary>
    [Fact]
    public async Task TekrarTalep_SilmeTarihiniOtelemez()
    {
        var options = NewOptions();
        var (tenantId, userId, code) = await SeedTenantAsync(options);
        var user = new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId };

        await using var db = NewDb(options, user);
        var service = NewService(db, user);
        var first = await service.RequestTenantDeletionAsync(new RequestTenantDeletionRequest("Parola123!", code, null));
        var second = await service.RequestTenantDeletionAsync(new RequestTenantDeletionRequest("Parola123!", code, null));

        Assert.True(second.IsSuccess);
        Assert.Equal(first.Value!.ScheduledAtUtc, second.Value!.ScheduledAtUtc);
    }

    /// <summary>Talep geri alınabilir — bekleme süresinin var olma sebebi.</summary>
    [Fact]
    public async Task TalepGeriAlinabilir()
    {
        var options = NewOptions();
        var (tenantId, userId, code) = await SeedTenantAsync(options);
        var user = new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId };

        await using var db = NewDb(options, user);
        var service = NewService(db, user);
        await service.RequestTenantDeletionAsync(new RequestTenantDeletionRequest("Parola123!", code, null));

        var cancelled = await service.CancelTenantDeletionAsync();
        Assert.True(cancelled.IsSuccess);
        Assert.False(cancelled.Value!.Pending);

        await using var verify = NewDb(options, new TestCurrentUser());
        Assert.False((await verify.Tenants.IgnoreQueryFilters().SingleAsync()).IsDeletionPending);
    }

    // ================================================================= MÜŞTERİ

    /// <summary>
    /// MÜŞTERİ SATIRI SİLİNMEZ, ANONİMLEŞTİRİLİR.
    /// </summary>
    /// <remarks>
    /// Satır randevu, adisyon, cari hesap ve tahsilatın bağlandığı düğümdür; silinmesi kapanmış
    /// kasaları ve tahsilat defterini dayanaksız bırakırdı. Silinen şey KİŞİYE AİT OLANDIR.
    /// </remarks>
    [Fact]
    public async Task MusteriSilme_SatiriSilmez_Anonimlestirir()
    {
        var options = NewOptions();
        Guid customerId;
        Guid tenantId;

        await using (var seed = NewDb(options, new TestCurrentUser()))
        {
            var tenant = new Tenant("Güzel Salon", "guzel-salon", "Premium");
            var branch = tenant.AddBranch("Merkez", "İstanbul", isDefault: true);
            seed.Tenants.Add(tenant);
            await seed.SaveChangesAsync();
            tenantId = tenant.Id;

            var customer = new Customer(tenant.Id, branch.Id, "Ayşe Yılmaz", "05551112233", "ayse@ornek.com");
            customer.UpdateProfile(new DateOnly(1990, 5, 3), Gender.Female, kvkkConsent: true, notes: "VIP müşteri");
            seed.Customers.Add(customer);
            seed.RefreshTokens.Add(RefreshToken.ForCustomer(customer.Id, "hash", DateTime.UtcNow.AddDays(30)));
            await seed.SaveChangesAsync();
            customerId = customer.Id;
        }

        var portal = new PortalUser(customerId);
        await using var db = NewDb(options, portal);
        var result = await NewService(db, portal)
            .DeleteMyCustomerAccountAsync(new DeleteCustomerAccountRequest("SİL", "Artık kullanmıyorum"));

        Assert.True(result.IsSuccess);

        await using var verify = NewDb(options, new TestCurrentUser());
        var saved = await verify.Customers.IgnoreQueryFilters().SingleAsync();

        // SATIR DURUYOR — muhasebe bağları kopmadı.
        Assert.Equal(customerId, saved.Id);
        Assert.Equal(tenantId, saved.TenantId);

        // KİŞİSEL VERİ GİTTİ.
        Assert.Equal(Customer.AnonymizedName, saved.FullName);
        Assert.Equal(string.Empty, saved.Phone);
        Assert.Null(saved.Email);
        Assert.Null(saved.BirthDate);
        Assert.Null(saved.Notes);
        Assert.False(saved.KvkkConsent);
        Assert.NotNull(saved.AnonymizedAtUtc);

        // OTURUMLAR KAPANDI: kimliği silinmiş hesabın jetonu yaşamaya devam etmemeli.
        Assert.All(await verify.RefreshTokens.IgnoreQueryFilters().ToListAsync(), t => Assert.NotNull(t.RevokedAtUtc));
    }

    /// <summary>Onay metni yanlışsa müşteri hesabı silinmez (parola yok; tek kanıt bu metindir).</summary>
    [Fact]
    public async Task MusteriSilme_OnayMetniYanlissa_Reddeder()
    {
        var options = NewOptions();
        Guid customerId;

        await using (var seed = NewDb(options, new TestCurrentUser()))
        {
            var tenant = new Tenant("Güzel Salon", "guzel-salon", "Premium");
            var branch = tenant.AddBranch("Merkez", "İstanbul", isDefault: true);
            seed.Tenants.Add(tenant);
            await seed.SaveChangesAsync();
            var customer = new Customer(tenant.Id, branch.Id, "Ayşe Yılmaz", "05551112233", "ayse@ornek.com");
            seed.Customers.Add(customer);
            await seed.SaveChangesAsync();
            customerId = customer.Id;
        }

        var portal = new PortalUser(customerId);
        await using var db = NewDb(options, portal);
        var result = await NewService(db, portal)
            .DeleteMyCustomerAccountAsync(new DeleteCustomerAccountRequest("evet", null));

        Assert.True(result.IsFailure);
        await using var verify = NewDb(options, new TestCurrentUser());
        Assert.Null((await verify.Customers.IgnoreQueryFilters().SingleAsync()).AnonymizedAtUtc);
    }

    /// <summary>Anonimleştirme İDEMPOTENTTİR: ikinci çağrı hiçbir şeyi değiştirmez.</summary>
    [Fact]
    public void Anonimlestirme_Idempotenttir()
    {
        var customer = new Customer(Guid.CreateVersion7(), Guid.CreateVersion7(), "Ayşe", "05551112233", "a@b.com");
        var first = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

        customer.Anonymize(first);
        customer.Anonymize(first.AddDays(1));

        Assert.Equal(first, customer.AnonymizedAtUtc);
    }
}

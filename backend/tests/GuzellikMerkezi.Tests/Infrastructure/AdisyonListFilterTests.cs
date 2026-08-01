using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ADİSYON LİSTESİ MÜŞTERİYE GÖRE SÜZÜLEBİLMELİ.
///
/// Müşteri geçmişi panelleri eskiden tüm kurumun adisyonlarını çekip istemcide süzüyordu:
/// kalabalık kurumda ilk sayfaya girmeyen adisyonlar sessizce kayboluyor, müşterinin geçmişi
/// eksik görünüyordu. Sunucu süzgeci bu sınıf hatayı bitirir.
/// </summary>
public sealed class AdisyonListFilterTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AdisyonService NewService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerA, Guid CustomerB);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Adisyon QA", $"adisyon-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var a = new Customer(tenant.Id, branch.Id, "A MÜŞTERİ", "0555 111 22 33", null);
        var b = new Customer(tenant.Id, branch.Id, "B MÜŞTERİ", "0555 444 55 66", null);
        db.Customers.AddRange(a, b);
        await db.SaveChangesAsync();

        // A'nın iki, B'nin bir adisyonu.
        db.Adisyonlar.AddRange(
            new Adisyon(tenant.Id, branch.Id, a.Id, null, null),
            new Adisyon(tenant.Id, branch.Id, a.Id, null, null),
            new Adisyon(tenant.Id, branch.Id, b.Id, null, null));
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, a.Id, b.Id);
    }

    [Fact]
    public async Task ListAsync_WithCustomerId_ReturnsOnlyThatCustomer()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).ListAsync(seed.TenantId, new PageRequest(1, 50), seed.CustomerA);

        Assert.True(result.IsSuccess);
        // Toplam sayaç da süzgeci görmeli — sayfalama yanlış sayfa sayısı üretmesin.
        Assert.Equal(2, result.Value!.TotalCount);
        Assert.All(result.Value.Items, x => Assert.Equal(seed.CustomerA, x.CustomerId));
    }

    [Fact]
    public async Task ListAsync_WithoutCustomerId_ReturnsAll()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).ListAsync(seed.TenantId, new PageRequest(1, 50));

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value!.TotalCount);
    }
}

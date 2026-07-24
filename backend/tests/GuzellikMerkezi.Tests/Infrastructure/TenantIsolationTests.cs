using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Çok kiracılı sistemin en kritik güvenlik sınırı: EF global query filter. Bir kurumun verisi
/// başka kuruma, şube kapsamlı kullanıcıya başka şubenin verisi ASLA görünmemeli.
/// Bu davranış tek bir <c>HasQueryFilter</c> ifadesine dayanıyor — regresyonu testsiz yakalanamaz.
/// </summary>
public sealed class TenantIsolationTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private sealed record Fixture(
        DbContextOptions<GuzellikDbContext> Options,
        Guid TenantA, Guid BranchA1, Guid BranchA2,
        Guid TenantB, Guid BranchB1);

    private static async Task<Fixture> SeedAsync()
    {
        var options = NewOptions();
        await using var db = new GuzellikDbContext(options);

        var a = new Tenant("Kurum A", "kurum-a", "Premium", TenantStatus.Active);
        var a1 = a.AddBranch("A Merkez", "İstanbul", true);
        var a2 = a.AddBranch("A Şube", "Ankara", false);
        var b = new Tenant("Kurum B", "kurum-b", "Premium", TenantStatus.Active);
        var b1 = b.AddBranch("B Merkez", "İzmir", true);

        db.Tenants.AddRange(a, b);
        db.Customers.AddRange(
            new Customer(a.Id, a1.Id, "A1 Müşteri", "05550000001"),
            new Customer(a.Id, a2.Id, "A2 Müşteri", "05550000002"),
            new Customer(b.Id, b1.Id, "B1 Müşteri", "05550000003"));
        await db.SaveChangesAsync();

        return new Fixture(options, a.Id, a1.Id, a2.Id, b.Id, b1.Id);
    }

    [Fact]
    public async Task Tenant_CannotSeeAnotherTenantsCustomers()
    {
        var f = await SeedAsync();

        await using var db = new GuzellikDbContext(f.Options, new TestTenantContext(f.TenantA));
        var names = await db.Customers.Select(x => x.FullName).ToListAsync();

        Assert.Equal(2, names.Count);
        Assert.DoesNotContain("B1 Müşteri", names);
    }

    [Fact]
    public async Task BranchScope_LimitsRowsToSelectedBranch()
    {
        var f = await SeedAsync();

        await using var db = new GuzellikDbContext(f.Options, new TestTenantContext(f.TenantA, f.BranchA1));
        var name = await db.Customers.Select(x => x.FullName).SingleAsync();

        Assert.Equal("A1 Müşteri", name);
    }

    [Fact]
    public async Task NoBranchSelected_ShowsWholeTenant()
    {
        // "Tüm şubeler" seçimi: şube filtresi devre dışı, kurum filtresi hâlâ geçerli.
        var f = await SeedAsync();

        await using var db = new GuzellikDbContext(f.Options, new TestTenantContext(f.TenantA, branchId: null));
        Assert.Equal(2, await db.Customers.CountAsync());
    }

    [Fact]
    public async Task PlatformAdmin_SeesAllTenants()
    {
        var f = await SeedAsync();

        await using var db = new GuzellikDbContext(f.Options, new TestTenantContext(null, null, isPlatformAdmin: true));
        Assert.Equal(3, await db.Customers.CountAsync());
    }

    [Fact]
    public async Task SoftDeletedRows_AreHidden()
    {
        var f = await SeedAsync();

        await using (var db = new GuzellikDbContext(f.Options, new TestTenantContext(f.TenantA)))
        {
            var customer = await db.Customers.FirstAsync(x => x.BranchId == f.BranchA1);
            db.Customers.Remove(customer); // ApplyAuditInfo bunu soft-delete'e çevirir
            await db.SaveChangesAsync();
        }

        await using (var db = new GuzellikDbContext(f.Options, new TestTenantContext(f.TenantA)))
        {
            Assert.Equal(1, await db.Customers.CountAsync());
            // Kayıt gerçekten silinmedi, yalnızca gizlendi.
            Assert.Equal(2, await db.Customers.IgnoreQueryFilters().CountAsync(x => x.TenantId == f.TenantA));
        }
    }
}

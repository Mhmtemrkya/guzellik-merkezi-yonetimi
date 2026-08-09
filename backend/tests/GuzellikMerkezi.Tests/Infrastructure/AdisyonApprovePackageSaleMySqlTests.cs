using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// PAKET SATIŞI ONAYI — GERÇEK VERİTABANINDA.
///
/// <para>
/// CANLI 500: "Satış kaydedildi ancak cariye işlenemedi." Paket kalemli bir fiş onaylanınca
/// <c>AdisyonService</c> paket içindeki hizmetlerin fiyatlarını okumak için
/// <c>package.Items.Select(...).Contains(x.Id)</c> yazıyordu. Bu, BELLEKTEKİ bir koleksiyonun
/// sorgu ağacına gömülmesidir; MySql.EntityFrameworkCore bunu çeviremez ve
/// <c>InvalidOperationException</c> atar → onay 500'e düşer, satış cariye HİÇ işlenmez.
/// </para>
///
/// <para>
/// InMemory sağlayıcı bu ifadeyi istemcide değerlendirdiği için hata YALNIZ gerçek MySQL/MariaDB'de
/// görünür — mevcut paket onayı testleri InMemory olduğu için kusur 519/519 yeşil kapıdan geçti.
/// </para>
/// </summary>
public sealed class AdisyonApprovePackageSaleMySqlTests
{
    private static AdisyonService NewService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid PackageId, Guid ServiceAId, Guid ServiceBId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Paket Onay", $"paket-onay-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "PAKET MÜŞTERİSİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        // İki hizmetli paket: fiyat sözlüğü birden çok kimlikle kurulur (tek elemanlı
        // koleksiyon bazı çevirilerde kazara çalışabilir; kusur çok elemanlıda kesindir).
        var serviceA = new ServiceDefinition(tenant.Id, branch.Id, "Lazer Göğüs", 45, 1500m, "Lazer");
        var serviceB = new ServiceDefinition(tenant.Id, branch.Id, "Lazer Sırt", 45, 2500m, "Lazer");
        db.ServiceDefinitions.Add(serviceA);
        db.ServiceDefinitions.Add(serviceB);
        await db.SaveChangesAsync();

        var package = new ServicePackage(tenant.Id, branch.Id, "Göğüs-Sırt Tam 6 Seans", 20000m, 0m, 0);
        package.ReplaceItems([(serviceA.Id, 6, 1500m), (serviceB.Id, 6, 2500m)]);
        db.ServicePackages.Add(package);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, package.Id, serviceA.Id, serviceB.Id);
    }

    /// <summary>
    /// PAKET SATIŞI ONAYI PATLAMAMALI ve seanslar SATIŞ ANINDAKİ fiyatla açılmalı.
    /// Regresyon: onay <c>InvalidOperationException</c> ile 500 veriyordu.
    /// </summary>
    [MySqlFact]
    public async Task Approve_PackageSale_OpensSessions_WithFrozenPrices()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        Guid adisyonId;
        await using (var db = database.NewContext())
        {
            var service = NewService(db);
            var created = await service.CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, null, null, ForceNew: true));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;

            var item = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.PackageSale, seed.PackageId, "Göğüs-Sırt Tam 6 Seans", 1, 20000m, null, false));
            Assert.True(item.IsSuccess, item.IsFailure ? item.Error.Message : null);
        }

        await using (var db = database.NewContext())
        {
            var approved = await NewService(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        await using var check = database.NewContext();
        var sessions = await check.CustomerPackageSessions
            .Where(s => s.TenantId == seed.TenantId)
            .ToListAsync();

        Assert.Equal(2, sessions.Count);
        Assert.All(sessions, s => Assert.Equal(6, s.TotalSessions));
        Assert.All(sessions, s => Assert.Equal(seed.PackageId, s.ServicePackageId));

        // DONMUŞ FİYAT: paketteki her hizmet kendi katalog fiyatıyla kaydedilir.
        Assert.Equal(1500m, sessions.Single(s => s.ServiceDefinitionId == seed.ServiceAId).UnitPriceAtSale);
        Assert.Equal(2500m, sessions.Single(s => s.ServiceDefinitionId == seed.ServiceBId).UnitPriceAtSale);

        // Satış cariye İŞLENMİŞ olmalı — 500'ün canlıdaki belirtisi tam olarak bunun eksikliğiydi.
        var account = await check.CustomerAccounts.SingleAsync(a => a.TenantId == seed.TenantId);
        Assert.Equal(20000m, account.TotalAmount);
    }
}

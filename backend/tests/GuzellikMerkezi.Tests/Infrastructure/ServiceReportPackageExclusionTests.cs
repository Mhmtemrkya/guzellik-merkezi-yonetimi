using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// PANO "HİZMET RAPORU" YALNIZ TEKİL HİZMET SATIŞLARINI SAYAR.
///
/// Paket satışı, içindeki HER hizmet için de bir <see cref="CustomerPackageSession"/> satırı açar
/// (bkz. <c>AdisyonService</c> paket onay bloğu). Hizmet Raporu bu satırları süzmediği için
/// paketten gelen seanslar ayrıca "satılmış hizmet" gibi sayılıyordu: aynı satış hem Paket hem
/// Hizmet raporunda görünüyor, cirosu iki kez okunuyordu. Paket raporu ters yönde AYNI süzgeci
/// zaten uyguluyordu (<c>ServicePackageId != Guid.Empty</c>) — iki rapor artık aynı kümeyi
/// paylaşmıyor.
///
/// Ayrım TEK ALANDIR: pakete bağlı seansta <c>ServicePackageId</c> doludur, tekil hizmet
/// satışında <see cref="Guid.Empty"/>'dir.
/// </summary>
public sealed class ServiceReportPackageExclusionTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static CustomerAccountService NewAccounts(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(Guid TenantId, Guid ServiceId);

    /// <summary>
    /// İki satış, AYNI hizmet:
    /// <list type="bullet">
    /// <item>1.000 TL'lik PAKET satışı → 4 seans (ServicePackageId dolu) — rapora GİRMEMELİ.</item>
    /// <item>500 TL'lik TEKİL HİZMET satışı → 2 seans (ServicePackageId boş) — rapora girmeli.</item>
    /// </list>
    /// </summary>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Hizmet Raporu QA", $"hizmet-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer Epilasyon", 30, 250m, "Epilasyon");
        db.ServiceDefinitions.Add(service);

        var package = new ServicePackage(tenant.Id, branch.Id, "Epilasyon Paketi", 1000m, 0m, 0);
        db.ServicePackages.Add(package);

        var customer = new Customer(tenant.Id, branch.Id, "Rapor Testi", "0555 000 77 88", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        // PAKET satışı — kendi carisi + pakete bağlı seanslar.
        var packageAccount = new CustomerAccount(tenant.Id, branch.Id, customer.Id, package.Id, "Epilasyon Paketi", 1000m, 0m);
        packageAccount.SetSaleInfo(DateTime.UtcNow.AddDays(-3), null);
        // TEKİL HİZMET satışı — kendi carisi + paketsiz seans.
        var serviceAccount = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Lazer Epilasyon", 500m, 0m);
        serviceAccount.SetSaleInfo(DateTime.UtcNow.AddDays(-2), null);
        db.CustomerAccounts.AddRange(packageAccount, serviceAccount);
        await db.SaveChangesAsync();

        db.CustomerPackageSessions.AddRange(
            new CustomerPackageSession(tenant.Id, customer.Id, packageAccount.Id, package.Id, service.Id, 4),
            new CustomerPackageSession(tenant.Id, customer.Id, serviceAccount.Id, Guid.Empty, service.Id, 2));
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, service.Id);
    }

    /// <summary>Paketten gelen seanslar hizmet sayılmamalı: adet, seans ve ciro yalnız tekil satıştan.</summary>
    [Fact]
    public async Task GetServiceReportAsync_ExcludesPackageDerivedSessions()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewAccounts(db).GetServiceReportAsync(seed.TenantId);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var report = result.Value!;

        // Tek satış (paketinki sayılmaz) — eskiden 2 dönüyordu.
        Assert.Equal(1, report.ServiceSalesCount);
        Assert.Equal(1, report.ActiveSoldServiceCount);
        // Seanslar da yalnız tekil satıştan: 2 (paketin 4'ü hariç, eskiden 6 idi).
        Assert.Equal(2, report.SessionsTotal);
        Assert.Equal(0, report.SessionsUsed);
        Assert.Equal(2, report.SessionsRemaining);
        // Ciro yalnız hizmet satışının tutarı — paketin 1.000 TL'si hizmet cirosuna eklenmez.
        Assert.Equal(500m, report.Revenue);
    }

    /// <summary>
    /// KARMA FİŞ — BAĞ YOKKA oransal dağıtım: paket + tekil hizmet AYNI cariye yazıldığında ciro
    /// payı seans ağırlığına göre bölünür. Ağırlık paydası satışın TAMAMI olmalı; yalnız hizmet
    /// satırlarından kurulsaydı satışın tüm tutarı hizmete yazılır, paketin payı hizmet cirosuna
    /// eklenirdi. (Seans satırı bir adisyona bağlıysa bunun yerine GERÇEK kalem tutarı kullanılır —
    /// bkz. <see cref="GetServiceReportAsync_UsesActualSaleLineTotal"/>.)
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_SharedAccount_AllocatesOnlyServiceShare()
    {
        var options = NewOptions();
        Guid tenantId, serviceId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Karma Fiş QA", $"karma-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 45, 300m, "Bakım");
            db.ServiceDefinitions.Add(service);
            var package = new ServicePackage(tenant.Id, branch.Id, "Bakım Paketi", 900m, 0m, 0);
            db.ServicePackages.Add(package);
            var customer = new Customer(tenant.Id, branch.Id, "Karma Fiş", "0555 111 22 33", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            // TEK cari, 1.200 TL: 3 paket seansı + 1 tekil hizmet seansı → hizmetin payı 1/4.
            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Karma satış", 1200m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, package.Id, service.Id, 3),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            serviceId = service.Id;
        }

        await using var verify = NewDb(options);
        var result = await NewAccounts(verify).GetServiceReportAsync(tenantId);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var report = result.Value!;
        Assert.Equal(1, report.ServiceSalesCount);
        Assert.Equal(1, report.SessionsTotal);
        // 1.200 × 1/4 = 300 (satışın tamamı değil).
        Assert.Equal(300m, report.Revenue);
        Assert.NotEqual(Guid.Empty, serviceId);
    }

    /// <summary>
    /// SEANS BİR ADİSYONA BAĞLIYSA CİRO O KALEMİN GERÇEK TUTARIDIR — oransal dağıtım değil.
    ///
    /// Karma fişte oran, hizmetin gerçek bedelini yansıtmıyordu: 900 TL'lik 3 seanslık paket +
    /// 250 TL'lik 1 seanslık hizmet aynı cariye yazıldığında hizmete 1.150 × 1/4 ≈ 287,50
    /// düşüyordu — oysa müşteri o hizmete 250 TL ödedi. Seans satırı hangi fişten doğduğunu
    /// <c>SourceAdisyonId</c> ile taşır; kalem de <c>RefId</c> + tutarı ile durur.
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_UsesActualSaleLineTotal()
    {
        var options = NewOptions();
        Guid tenantId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Gercek Tutar QA", $"gercek-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 45, 250m, "Bakım");
            db.ServiceDefinitions.Add(service);
            var package = new ServicePackage(tenant.Id, branch.Id, "Bakım Paketi", 900m, 0m, 0);
            db.ServicePackages.Add(package);
            var customer = new Customer(tenant.Id, branch.Id, "Gercek Tutar", "0555 777 88 99", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            // TEK cari, 1.150 TL: 3 paket seansı + 1 tekil hizmet seansı.
            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Karma satış", 1150m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);

            // Hizmetin GERÇEK bedeli fişte: 1 × 250 TL.
            var adisyon = new Adisyon(tenant.Id, branch.Id, customer.Id, null, null);
            adisyon.AddItem(AdisyonItemType.Service, service.Id, "Cilt Bakımı", 1, 250m, null, false);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, package.Id, service.Id, 3),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1, adisyon.Id));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
        }

        await using var verify = NewDb(options);
        var result = await NewAccounts(verify).GetServiceReportAsync(tenantId);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        // Oransal dağıtım 1.150 × 1/4 = 287,50 verirdi; doğrusu kalemin kendi tutarı.
        Assert.Equal(250m, result.Value!.Revenue);
    }
}

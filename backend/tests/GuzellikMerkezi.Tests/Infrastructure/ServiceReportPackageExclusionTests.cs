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

    /// <summary>
    /// AYNI FİŞTE AYNI HİZMETTEN İKİ SEANS SATIRI → kalem tutarı BÖLÜNÜR, katlanmaz.
    ///
    /// Her seans satırı kalemin TAMAMINI sayıyordu: 300 TL'lik kalem iki satıra düşünce ciro
    /// 600 TL görünüyordu (adet katı kadar şişme).
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_SplitsSaleLineAcrossItsSessionRows()
    {
        var options = NewOptions();
        Guid tenantId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Bolme QA", $"bolme-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 45, 150m, "Bakım");
            db.ServiceDefinitions.Add(service);
            var customer = new Customer(tenant.Id, branch.Id, "Bolme", "0555 999 88 77", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Cilt Bakımı ×2", 300m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);

            // TEK kalem: 2 adet × 150 TL = 300 TL.
            var adisyon = new Adisyon(tenant.Id, branch.Id, customer.Id, null, null);
            adisyon.AddItem(AdisyonItemType.Service, service.Id, "Cilt Bakımı", 2, 150m, null, false);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();

            // Aynı fişten İKİ seans satırı doğdu (adet başına bir kayıt).
            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1, adisyon.Id),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1, adisyon.Id));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
        }

        await using var verify = NewDb(options);
        var result = await NewAccounts(verify).GetServiceReportAsync(tenantId);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        // Her satır 300 sayarsa 600 çıkar; doğrusu kalemin kendisi.
        Assert.Equal(300m, result.Value!.Revenue);
    }

    /// <summary>
    /// KATALOG ZAMMI GEÇMİŞ CİROYU DEĞİŞTİRMEZ: dağıtım önce SATIŞIN KENDİ kalem fiyatını kullanır.
    ///
    /// Ağırlık doğrudan güncel katalog fiyatına bağlanınca, sonradan yapılan zam/indirim eski
    /// dönemin raporunu oynatıyordu (aynı rapor iki gün farklı rakam veriyordu).
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_CatalogPriceChange_DoesNotMovePastRevenue()
    {
        var options = NewOptions();
        Guid tenantId, serviceId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Zam QA", $"zam-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 45, 500m, "Bakım");
            db.ServiceDefinitions.Add(service);
            var package = new ServicePackage(tenant.Id, branch.Id, "Bakım Paketi", 900m, 0m, 0);
            db.ServicePackages.Add(package);
            var customer = new Customer(tenant.Id, branch.Id, "Zam", "0555 121 21 21", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Karma satış", 1400m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-30), null);
            db.CustomerAccounts.Add(account);

            // Satış anındaki bedel: 500 TL (fişte yazılı).
            var adisyon = new Adisyon(tenant.Id, branch.Id, customer.Id, null, null);
            adisyon.AddItem(AdisyonItemType.Service, service.Id, "Cilt Bakımı", 1, 500m, null, false);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, package.Id, service.Id, 3),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1, adisyon.Id));
            await db.SaveChangesAsync();

            // SONRADAN ZAM: katalog 500 → 2.000.
            service.ChangePricing(45, 2000m);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            serviceId = service.Id;
        }

        await using var verify = NewDb(options);
        var result = await NewAccounts(verify).GetServiceReportAsync(tenantId);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        // Fişteki gerçek bedel: 500. Zam sonrası katalog fiyatı kullanılsaydı rakam oynardı.
        Assert.Equal(500m, Math.Round(result.Value!.Revenue, 2));
        Assert.NotEqual(Guid.Empty, serviceId);
    }

    /// <summary>
    /// LEGACY KARMA SATIŞ (adisyon bağı YOK) → dağıtım seans ADEDİNE değil KATALOG FİYATINA göre.
    ///
    /// Seans adedine oranlamak ucuz ama çok seanslı hizmete satışın büyük kısmını yazıyordu:
    /// 1.500 TL'lik fişte 10 seanslık 100 TL'lik hizmet + 1 seanslık 500 TL'lik hizmet varken
    /// ilkine 1.363,64 düşüyordu. Paket raporu bu dağıtımı zaten birim fiyatla yapıyor.
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_LegacySale_AllocatesByCatalogPrice()
    {
        var options = NewOptions();
        Guid tenantId, cheapId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Legacy QA", $"legacy-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            // AYRI KATEGORİLER: rapor yalnız birine daraltılabilsin, dağıtım payı ölçülebilsin.
            var cheap = new ServiceDefinition(tenant.Id, branch.Id, "Ucuz Bakım", 30, 100m, "Ucuz");
            var pricey = new ServiceDefinition(tenant.Id, branch.Id, "Pahalı Bakım", 60, 500m, "Pahalı");
            db.ServiceDefinitions.AddRange(cheap, pricey);
            var customer = new Customer(tenant.Id, branch.Id, "Legacy", "0555 333 22 11", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            // Elle açılmış cari (SourceAdisyonId YOK) — 1.500 TL.
            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski kayıt", 1500m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, cheap.Id, 10),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, pricey.Id, 1));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            cheapId = cheap.Id;
        }

        await using var verify = NewDb(options);
        // Yalnız UCUZ kategoriye daralt.
        var svc = await verify.ServiceDefinitions.FindAsync(cheapId);
        var result = await NewAccounts(verify).GetServiceReportAsync(tenantId, category: svc!.Category);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        // FİYAT ağırlığı: 1.500 × (100×10) / (100×10 + 500×1) = 1.000.
        // SEANS ADEDİ ağırlığı (eski, hatalı) 1.500 × 10/11 ≈ 1.363,64 verirdi.
        Assert.Equal(1000m, Math.Round(result.Value!.Revenue, 2));
    }
}

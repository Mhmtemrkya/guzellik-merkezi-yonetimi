using GuzellikMerkezi.Application.Features.CustomerAccounts;
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
    /// LEGACY KARMA SATIŞ (adisyon bağı YOK) → dağıtım seans ADEDİNE değil BİRİM FİYATA göre.
    ///
    /// Seans adedine oranlamak ucuz ama çok seanslı hizmete satışın büyük kısmını yazıyordu:
    /// 1.500 TL'lik fişte 10 seanslık 100 TL'lik hizmet + 1 seanslık 500 TL'lik hizmet varken
    /// ilkine 1.363,64 düşüyordu. Paket raporu bu dağıtımı zaten birim fiyatla yapıyor.
    ///
    /// <para>
    /// FİYATIN KAYNAĞI DEĞİŞTİ (denetim turu 4): eskiden GÜNCEL katalogdan okunuyordu ve bu,
    /// kapanmış dönemin cirosunu kataloğa dokunulunca oynatıyordu. Artık satış anında seans
    /// satırına DONDURULUR. İsabet aynı kalır (1.000), üstelik geçmiş sabittir — bkz.
    /// <see cref="GetServiceReportAsync_LegacySale_RevenueMovesWhenCatalogPriceEdited"/>.
    /// </para>
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_LegacySale_AllocatesByFrozenUnitPrice()
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

            // Fiyat SATIŞ ANINDA dondurulur (üretimdeki yazma yollarının yaptığının aynısı).
            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, cheap.Id, 10,
                    unitPriceAtSale: 100m),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, pricey.Id, 1,
                    unitPriceAtSale: 500m));
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

    /// <summary>
    /// KANIT TESTİ (denetim turu 4 · #6): LEGACY satışın cirosu KATALOG DÜZENLENİNCE DEĞİŞİYOR MU?
    ///
    /// <para>
    /// İddia: "legacy hizmet cirosu hâlâ katalog fiyatıyla değişiyor". Bu test iddiayı
    /// ARİTMETİKTEN BAĞIMSIZ ölçer: aynı satış, aynı dönem, DEĞİŞMEYEN tek şey rapor —
    /// arada yalnız hizmetin katalog fiyatı düzenlenir. Rakam oynuyorsa kusur gerçektir;
    /// çünkü kapanmış bir ayı, iki gün sonra farklı rakam veren bir rapora karşı kapatamazsınız.
    /// </para>
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_LegacySale_RevenueMovesWhenCatalogPriceEdited()
    {
        var options = NewOptions();
        Guid tenantId, cheapId, priceyId;
        string category;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Drift QA", $"drift-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var cheap = new ServiceDefinition(tenant.Id, branch.Id, "Ucuz Bakım", 30, 100m, "Ucuz");
            var pricey = new ServiceDefinition(tenant.Id, branch.Id, "Pahalı Bakım", 60, 500m, "Pahalı");
            db.ServiceDefinitions.AddRange(cheap, pricey);
            var customer = new Customer(tenant.Id, branch.Id, "Drift", "0555 777 88 99", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            // LEGACY: elle açılmış cari, adisyon bağı YOK → fiyat yalnız katalogdan bilinebilir.
            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski kayıt", 1500m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            // Üretimdeki yazma yolları fiyatı satış anında dondurur; test de öyle yapar.
            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, cheap.Id, 10,
                    unitPriceAtSale: 100m),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, pricey.Id, 1,
                    unitPriceAtSale: 500m));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            cheapId = cheap.Id;
            priceyId = pricey.Id;
            category = cheap.Category!;
        }

        decimal before;
        await using (var read = NewDb(options))
            before = (await NewAccounts(read).GetServiceReportAsync(tenantId, category: category)).Value!.Revenue;

        // GEÇMİŞE DOKUNULMADI — yalnız BUGÜNÜN katalog fiyatı düzenlendi.
        await using (var edit = NewDb(options))
        {
            var pricey = await edit.ServiceDefinitions.FindAsync(priceyId);
            pricey!.ChangePricing(pricey.DurationMinutes, 5000m);
            await edit.SaveChangesAsync();
        }

        decimal after;
        await using (var read = NewDb(options))
            after = (await NewAccounts(read).GetServiceReportAsync(tenantId, category: category)).Value!.Revenue;

        Assert.Equal(Math.Round(before, 2), Math.Round(after, 2));
        _ = cheapId;
    }

    /// <summary>
    /// ARŞİV GERİ ALININCA CİRO KAYMAZ — İKİ GERÇEK GEÇMİŞ, İKİ AYRI TEST.
    ///
    /// <para>
    /// ÖNCEKİ HÂLİ ULAŞILAMAZ BİR DURUM KURUYORDU (kayda geçiyor ki aynı gerekçeyle geri
    /// eklenmesin). Test, canlı seans satırlarını backfill edip ARDINDAN aynı satışın
    /// snapshot'ından fiyatı regex ile siliyordu. Üretimde böyle bir satış YOKTUR:
    /// </para>
    /// <list type="bullet">
    /// <item>Migration yalnız <c>customer_package_sessions</c>'ı güncelledi; iptal edilmiş
    /// satışın seans satırları o sırada ZATEN SİLİNMİŞTİ → backfill edecek satır yok.</item>
    /// <item>Aynı migration <c>cancelled_sales.Snapshot</c>'a hiç dokunmadı → okunacak fiyat yok.</item>
    /// </list>
    /// <para>
    /// Yani "canlı satırların fiyatı var ama snapshot'ında yok" hâli yalnız testin kendi
    /// kurgusunda vardı. Bu kurgu ölçütü de yanlış seçtiriyordu: karşılaştırma "bu satış BUGÜN
    /// canlı ve backfill'li olsaydı ne okunurdu" (1.000) ile yapılıyordu; oysa doğru ölçüt
    /// "İPTAL EDİLDİĞİ AN ne okuyordu"dur (kolon henüz yokken: seans adedi ağırlığı). Geri alma,
    /// satışın hiç sahip olmadığı bir rakama göre nötr olamaz — ve o rakamı tutturmak için eksik
    /// fiyatı BUGÜNÜN katalogundan doldurmak kapanmış dönem cirosunu kataloğa bağlıyordu
    /// (denetim ölçtü: doğrusu 1.000 olan ciro geri almadan sonra 1.285,71).
    /// </para>
    /// <para>
    /// Snapshot'ta OLMAYAN bir bilgi geri almada üretilemez. Değişmez şudur: geri alma satışı
    /// İPTAL ANINDAKİ hâline döndürür. Aşağıdaki iki test ulaşılabilir iki geçmişi ayrı ayrı
    /// sabitler; katalog bağımlılığını ayırt eden test ise
    /// <c>ServiceReportRevenueMySqlTests.CancelThenRestore_IsRevenueNeutral_EvenWhenCatalogPriceChanged</c>.
    /// </para>
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_MigrationOncesiArsivGeriAlininca_CiroKaymaz()
    {
        var options = NewOptions();
        var f = await SeedArchiveFixtureAsync(options, backfillLiveSessions: false);

        // MIGRATION ÖNCESİ: seansların fiyatı hiç olmadı → seans adedi ağırlığı (1.500 × 10/11).
        decimal before;
        await using (var read = NewDb(options))
            before = (await NewAccounts(read).GetServiceReportAsync(f.TenantId, category: f.Category)).Value!.Revenue;
        Assert.Equal(1363.64m, Math.Round(before, 2));

        await using (var cancel = NewDb(options))
            Assert.True((await NewAccounts(cancel).CancelSaleAsync(f.TenantId, f.AccountId,
                new CancelSaleRequest("arşiv testi"))).IsSuccess);

        await using (var restore = NewDb(options))
        {
            var restored = await NewAccounts(restore).RestoreSaleAsync(f.TenantId, f.AccountId);
            Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Message : null);
        }

        await using (var verify = NewDb(options))
        {
            var after = (await NewAccounts(verify).GetServiceReportAsync(f.TenantId, category: f.Category)).Value!.Revenue;
            // Geri alma İPTAL ANINDAKİ rakamı korur — uydurma bir "olsaydı" rakamını değil.
            Assert.Equal(Math.Round(before, 2), Math.Round(after, 2));
        }
    }

    /// <summary>
    /// MIGRATION SONRASI ARŞİV: snapshot fiyatı TAŞIR ve geri almada geri yazılır.
    /// Şema paritesi koruması — <c>SnapshotSession.UnitPriceAtSale</c> yazılmayı/okunmayı
    /// bırakırsa dağıtım sessizce seans adedine kayar ve bu test kırılır.
    /// </summary>
    [Fact]
    public async Task GetServiceReportAsync_MigrationSonrasiArsivGeriAlininca_DonmusFiyatKorunur()
    {
        var options = NewOptions();
        var f = await SeedArchiveFixtureAsync(options, backfillLiveSessions: true);

        // Fiyatlar biliniyor → fiyat ağırlığı: 1.500 × (100×10)/(100×10 + 500×1) = 1.000.
        decimal before;
        await using (var read = NewDb(options))
            before = (await NewAccounts(read).GetServiceReportAsync(f.TenantId, category: f.Category)).Value!.Revenue;
        Assert.Equal(1000m, Math.Round(before, 2));

        await using (var cancel = NewDb(options))
            Assert.True((await NewAccounts(cancel).CancelSaleAsync(f.TenantId, f.AccountId,
                new CancelSaleRequest("arşiv testi"))).IsSuccess);

        await using (var restore = NewDb(options))
        {
            var restored = await NewAccounts(restore).RestoreSaleAsync(f.TenantId, f.AccountId);
            Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Message : null);
        }

        await using (var verify = NewDb(options))
        {
            var after = (await NewAccounts(verify).GetServiceReportAsync(f.TenantId, category: f.Category)).Value!.Revenue;
            Assert.Equal(1000m, Math.Round(after, 2));
            // Fiyat gerçekten snapshot'tan geri geldi mi (yoksa tesadüfen mi tuttu)?
            var restoredSessions = await verify.CustomerPackageSessions
                .Where(x => x.TenantId == f.TenantId).ToListAsync();
            Assert.All(restoredSessions, s => Assert.NotNull(s.UnitPriceAtSale));
        }
    }

    private sealed record ArchiveFixture(Guid TenantId, Guid AccountId, string Category);

    /// <param name="backfillLiveSessions">
    /// true → migration SONRASI hâl (canlı satırlar bugünün katalogıyla dolduruldu, dolayısıyla
    /// iptal snapshot'ı da fiyat taşır). false → migration ÖNCESİ hâl (fiyat hiç yok).
    /// </param>
    private static async Task<ArchiveFixture> SeedArchiveFixtureAsync(
        DbContextOptions<GuzellikDbContext> options, bool backfillLiveSessions)
    {
        Guid tenantId, accountId;
        string category;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Arşiv QA", $"ars-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var cheap = new ServiceDefinition(tenant.Id, branch.Id, "Ucuz Bakım", 30, 100m, "Ucuz");
            var pricey = new ServiceDefinition(tenant.Id, branch.Id, "Pahalı Bakım", 60, 500m, "Pahalı");
            db.ServiceDefinitions.AddRange(cheap, pricey);
            var customer = new Customer(tenant.Id, branch.Id, "Arşiv", "0555 444 55 66", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski kayıt", 1500m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, cheap.Id, 10),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, pricey.Id, 1));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            accountId = account.Id;
            category = cheap.Category!;
        }

        if (backfillLiveSessions)
        {
            await using var backfill = NewDb(options);
            foreach (var row in await backfill.CustomerPackageSessions.Where(x => x.TenantId == tenantId).ToListAsync())
            {
                var price = await backfill.ServiceDefinitions.Where(d => d.Id == row.ServiceDefinitionId)
                    .Select(d => d.Price).FirstAsync();
                backfill.Entry(row).Property(x => x.UnitPriceAtSale).CurrentValue = price;
            }
            await backfill.SaveChangesAsync();
        }

        return new ArchiveFixture(tenantId, accountId, category);
    }
}

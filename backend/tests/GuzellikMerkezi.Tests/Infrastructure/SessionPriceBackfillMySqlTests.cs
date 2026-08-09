using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// BACKFILL SEMANTİĞİ — kolon eklemek rakamları OYNATMAMALI.
///
/// <para>
/// `UnitPriceAtSale` migration'ı mevcut satırları bugünün katalog fiyatıyla doldurur. Bütün
/// mesele raporlanan rakamların artık oynamaması olduğuna göre, DEPLOY ANINDA rakamı değiştiren
/// bir backfill kusuru başka kılıkta tekrarlardı: "katalog değişince ciro kayıyor" yerine
/// "deploy edince ciro bir kez zıpladı" — ikincisini ay kapatan birine anlatmak daha zordur.
/// </para>
/// <para>
/// GERÇEK VERİTABANI ŞART: backfill ham SQL'dir (JOIN'li UPDATE). InMemory sağlayıcıda çalışmaz,
/// dolayısıyla 512 testin tamamında bu SQL BOŞ tabloya karşı koştu — sözdizimi kanıtlıydı,
/// ANLAMI değil.
/// </para>
/// </summary>
public sealed class SessionPriceBackfillMySqlTests
{
    /// <summary>Migration'daki backfill'in TA KENDİSİ (kopya değil; sapmasın diye tek metin).</summary>
    private const string BackfillSql = """
        UPDATE customer_package_sessions s
        JOIN service_definitions d ON d.Id = s.ServiceDefinitionId
        SET s.UnitPriceAtSale = d.Price
        WHERE s.UnitPriceAtSale IS NULL AND d.Price > 0;
        """;

    /// <summary>
    /// Backfill, KATALOG DÖNEMİNDEKİ dağıtımın aynısını üretir.
    ///
    /// <para>
    /// Eski davranış: fiyat güncel katalogdan okunurdu → 1.500 × (100×10)/(100×10 + 500×1) = 1.000.
    /// Backfill bugünün katalog fiyatını satıra yazdığı için sonuç AYNI 1.000 olmalıdır. Fark
    /// çıkarsa deploy, kapanmış dönemlerin rakamlarını değiştiriyor demektir.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task Backfill_KatalogDonemiyleAyniCiroyuUretir()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();

        Guid tenantId;
        string category;
        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Backfill QA", $"bf-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var cheap = new ServiceDefinition(tenant.Id, branch.Id, "Ucuz Bakım", 30, 100m, "Ucuz");
            var pricey = new ServiceDefinition(tenant.Id, branch.Id, "Pahalı Bakım", 60, 500m, "Pahalı");
            db.ServiceDefinitions.AddRange(cheap, pricey);
            var customer = new Customer(tenant.Id, branch.Id, "Backfill", "0555 111 00 11", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski kayıt", 1500m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            // MIGRATION ÖNCESİ HÂL: fiyat YOK (kolon yeni eklenmiş, satırlar boş).
            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, cheap.Id, 10),
                new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, pricey.Id, 1));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            category = cheap.Category!;
        }

        // Backfill UYGULANMADAN: fiyat bilinmiyor → seans adedi dağıtımı (1.500 × 10/11).
        await using (var before = database.NewContext())
        {
            var svc = new CustomerAccountService(before, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            var report = await svc.GetServiceReportAsync(tenantId, category: category);
            Assert.Equal(1363.64m, Math.Round(report.Value!.Revenue, 2));
        }

        await using (var apply = database.NewContext())
            await apply.Database.ExecuteSqlRawAsync(BackfillSql);

        await using (var after = database.NewContext())
        {
            // Her satır dolmuş olmalı — biri boş kalırsa hesap KARIŞIK BİRİME düşer.
            Assert.Empty(await after.CustomerPackageSessions.IgnoreQueryFilters()
                .Where(s => s.TenantId == tenantId && s.UnitPriceAtSale == null).ToListAsync());

            var svc = new CustomerAccountService(after, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            var report = await svc.GetServiceReportAsync(tenantId, category: category);
            // ASIL İDDİA: katalog dönemindeki rakamın AYNISI.
            Assert.Equal(1000m, Math.Round(report.Value!.Revenue, 2));
        }
    }

    /// <summary>
    /// Backfill FİYATI OLMAYAN hizmeti atlar ve zaten dolu satıra DOKUNMAZ.
    ///
    /// <para>
    /// 0 yazmak "bedava satıldı" ile "bilinmiyor"u aynı kovaya atardı. Dolu satırın üzerine
    /// yazmak ise satış anındaki fiyatı bugünkü fiyatla ezerdi — kusurun ta kendisi.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task Backfill_SifirFiyatiAtlar_VeDoluSatiriEzmez()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();

        Guid bedavaSessionId, doluSessionId;
        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Backfill QA2", $"bf2-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var bedava = new ServiceDefinition(tenant.Id, branch.Id, "Ücretsiz Kontrol", 15, 0m, "Kontrol");
            var normal = new ServiceDefinition(tenant.Id, branch.Id, "Bakım", 30, 900m, "Bakım");
            db.ServiceDefinitions.AddRange(bedava, normal);
            var customer = new Customer(tenant.Id, branch.Id, "BF2", "0555 222 00 22", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Kayıt", 900m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            var bedavaSession = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, bedava.Id, 1);
            // SATIŞ ANINDA 250'ye satılmış; bugünkü katalog 900. Backfill bunu EZMEMELİ.
            var doluSession = new CustomerPackageSession(
                tenant.Id, customer.Id, account.Id, Guid.Empty, normal.Id, 1, unitPriceAtSale: 250m);
            db.CustomerPackageSessions.AddRange(bedavaSession, doluSession);
            await db.SaveChangesAsync();

            bedavaSessionId = bedavaSession.Id;
            doluSessionId = doluSession.Id;
        }

        await using (var apply = database.NewContext())
            await apply.Database.ExecuteSqlRawAsync(BackfillSql);

        await using (var verify = database.NewContext())
        {
            var bedava = await verify.CustomerPackageSessions.IgnoreQueryFilters().SingleAsync(x => x.Id == bedavaSessionId);
            Assert.Null(bedava.UnitPriceAtSale);

            var dolu = await verify.CustomerPackageSessions.IgnoreQueryFilters().SingleAsync(x => x.Id == doluSessionId);
            Assert.Equal(250m, dolu.UnitPriceAtSale);
        }
    }
}

using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// HİZMET RAPORU CİROSU — GERÇEK VERİTABANINDA.
///
/// <para>
/// İki ayrı canlı kusur buraya düşer:
/// </para>
/// <list type="number">
/// <item>
/// <b>500:</b> rapor, adisyondan doğmuş seansların kalem tutarını okurken fiş kimliklerini
/// <c>sourceAdisyonIds.Contains(i.AdisyonId)</c> ile süzüyordu. Bu sağlayıcı yerel koleksiyonu
/// çeviremiyor → dönemde adisyondan doğmuş TEK bir hizmet seansı olduğu anda uç 500 veriyordu.
/// Yalnız gerçek MySQL/MariaDB'de görülür; InMemory ifadeyi istemcide değerlendirir.
/// </item>
/// <item>
/// <b>Ciro kayması:</b> iptali geri alma, yedeğinde fiyat olmayan eski satışların eksik fiyatını
/// BUGÜNÜN katalogundan tamamlıyordu. Geri alma ciro-nötr olmalıyken katalog düzenlenmişse rakam
/// değişiyordu. Aşağıdaki test ARADA KATALOĞU DEĞİŞTİRİR — düzeltmeyi ayırt eden şey budur;
/// katalog düzenlenmeden hem doğru hem yanlış kod yeşil kalır.
/// </item>
/// </list>
/// </summary>
public sealed class ServiceReportRevenueMySqlTests
{
    private static CustomerAccountService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid AccountId,
        Guid CheapServiceId, Guid PricyServiceId);

    /// <summary>
    /// 1.000 TL'lik tek satış, İKİ hizmetten oluşuyor: 10 seanslık ucuz + 1 seanslık pahalı.
    /// Seansların donmuş fiyatı YOKTUR (migration öncesi kayıt taklidi) → dağıtım seans adedine
    /// düşer ve rapor, kapsamdaki hizmete 1.000 × 10/11 yazar.
    /// </summary>
    private static async Task<Seed> SeedAsync(MySqlTestDatabase database, Guid? sourceAdisyonId = null)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Ciro QA", $"ciro-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "CİRO MÜŞTERİSİ", "0555 909 80 70", null);
        db.Customers.Add(customer);
        // AYRI KATEGORİLER: rapor tek kategoriye daraltılabilsin. Ağırlık kipinin (seans adedi ↔
        // fiyat) etkisi ancak KAPSAMLI raporda görünür — kapsamsız raporda paylar her hâlükârda
        // satış toplamına tamamlanır ve iki kip aynı rakamı verir (bu test önce onu ölçüyordu ve
        // bu yüzden kusuru yakalamıyordu).
        var cheap = new ServiceDefinition(tenant.Id, branch.Id, "Ucuz Hizmet", 30, 100m, "Bakım");
        var pricy = new ServiceDefinition(tenant.Id, branch.Id, "Pahalı Hizmet", 60, 500m, "Lazer");
        db.ServiceDefinitions.Add(cheap);
        db.ServiceDefinitions.Add(pricy);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Karma satış", 1000m, 0m);
        account.SetSaleInfo(DateTime.UtcNow.AddDays(-1), null);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        // TEKİL HİZMET satışı → ServicePackageId = Guid.Empty (paket seansı Hizmet Raporu'na girmez).
        // UnitPriceAtSale VERİLMEZ: donmuş fiyatı olmayan eski kayıt.
        db.CustomerPackageSessions.Add(new CustomerPackageSession(
            tenant.Id, customer.Id, account.Id, Guid.Empty, cheap.Id, 10, sourceAdisyonId));
        db.CustomerPackageSessions.Add(new CustomerPackageSession(
            tenant.Id, customer.Id, account.Id, Guid.Empty, pricy.Id, 1, sourceAdisyonId));
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, account.Id, cheap.Id, pricy.Id);
    }

    /// <summary>
    /// REGRESYON (500): seanslar bir ADİSYONDAN doğmuşsa rapor kalem tutarlarını okumaya çalışır.
    /// Bu yol <c>InvalidOperationException</c> ile patlıyordu; rapor artık dönmeli.
    /// </summary>
    [MySqlFact]
    public async Task ServiceReport_WithAdisyonSourcedSessions_DoesNotThrow()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();

        // Seanslar bir adisyondan doğmuş sayılır → `sourceAdisyonIds` dolu → patlayan dal çalışır.
        var seed = await SeedAsync(database, sourceAdisyonId: Guid.NewGuid());

        await using var check = database.NewContext();
        var report = await NewService(check).GetServiceReportAsync(seed.TenantId);

        Assert.True(report.IsSuccess, report.IsFailure ? report.Error.Message : null);
        // Fiş kalemi yok (seans bağı askıda) → oransal dağıtım; satışın TAMAMI iki hizmete bölünür.
        Assert.Equal(1000m, report.Value!.Revenue);
    }

    /// <summary>
    /// İPTAL → GERİ AL CİRO-NÖTR OLMALI — ARADA KATALOG DEĞİŞSE BİLE.
    ///
    /// <para>
    /// Ayırt edici adım KATALOG DÜZENLEMESİDİR: eksik fiyat bugünün katalogundan tamamlandığında
    /// hesap "seans adedi" ağırlığından "fiyat" ağırlığına geçiyor ve rakam kayıyordu. Bu adım
    /// olmadan hem eski hem yeni kod yeşil kalır.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task CancelThenRestore_IsRevenueNeutral_EvenWhenCatalogPriceChanged()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // RAPOR TEK KATEGORİYE DARALTILIR ("Bakım" = yalnız 10 seanslık ucuz hizmet).
        decimal before;
        await using (var db = database.NewContext())
        {
            var report = await NewService(db).GetServiceReportAsync(seed.TenantId, category: "Bakım");
            Assert.True(report.IsSuccess, report.IsFailure ? report.Error.Message : null);
            before = report.Value!.Revenue;
        }
        // Donmuş fiyat YOK → seans adedi ağırlığı → 1.000 × 10/11.
        Assert.Equal(909.09m, before);

        await using (var db = database.NewContext())
        {
            var cancelled = await NewService(db).CancelSaleAsync(
                seed.TenantId, seed.AccountId, new CancelSaleRequest("Test iptali"));
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        // ARADA KATALOG DEĞİŞİR — zam, indirim, düzeltme; hepsi olağan işletme davranışı.
        await using (var db = database.NewContext())
        {
            var pricy = await db.ServiceDefinitions.SingleAsync(x => x.Id == seed.PricyServiceId);
            pricy.ChangePricing(60, 5000m);
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var archive = await db.CancelledSales.SingleAsync(x => x.TenantId == seed.TenantId);
            var restored = await NewService(db).RestoreSaleAsync(
                seed.TenantId, archive.Id, new RestoreSaleRequest(AllowLegacySnapshot: true));
            Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Message : null);
        }

        await using (var db = database.NewContext())
        {
            var report = await NewService(db).GetServiceReportAsync(seed.TenantId, category: "Bakım");
            Assert.True(report.IsSuccess, report.IsFailure ? report.Error.Message : null);
            // GERİ ALMA CİROYU DEĞİŞTİRMEZ. Eksik fiyat bugünün katalogundan tamamlansaydı hesap
            // fiyat ağırlığına geçer ve bu satır 909,09 yerine 1.000 × (100×10)/(100×10+5.000×1)
            // = 166,67 görürdü. Kapanmış bir dönemin cirosu, iptali geri almakla değişemez.
            Assert.Equal(before, report.Value!.Revenue);
        }
    }
}

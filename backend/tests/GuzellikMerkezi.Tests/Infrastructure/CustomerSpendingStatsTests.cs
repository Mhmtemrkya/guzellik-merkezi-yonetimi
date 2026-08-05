using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// "Ortalama Harcama" kartının DÖNEM seçimi.
///
/// Ölçüt tahsilat tarihidir (<c>AccountPayment.OccurredAtUtc</c>), satış tarihi değil: geçmiş bir
/// satışın bu ay ödenen taksiti bu döneme düşer. Ortalama yalnızca o dönemde harcaması OLAN
/// müşteriler üzerinden alınır — hiç ödeme yapmayan müşteriler ortalamayı aşağı çekmemeli,
/// aksi halde "son 30 gün" kartı binlerce sessiz müşteri yüzünden hep sıfıra yakın görünürdü.
/// </summary>
public sealed class CustomerSpendingStatsTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search) =>
        new(options, null, new TestCurrentUser(), null, null, search);

    private static CustomerService NewService(GuzellikDbContext db, ISearchIndexService search) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), search, new CapturingJobQueue());

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid RecentCustomerId, Guid OldCustomerId);

    /// <summary>
    /// İki müşteri: biri 5 gün önce 400 TL ödedi, diğeri 200 gün önce 1.000 TL.
    /// Dar pencerede yalnız ilki, tüm zamanlarda ikisi de sayılmalı.
    /// </summary>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search)
    {
        await using var db = NewDb(options, search);
        var tenant = new Tenant("Harcama QA", "harcama-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var recent = new Customer(tenant.Id, branch.Id, "Yakın Ödeme", "0555 000 11 22", null);
        var old = new Customer(tenant.Id, branch.Id, "Eski Ödeme", "0555 000 33 44", null);
        db.Customers.AddRange(recent, old);
        await db.SaveChangesAsync();

        var recentAccount = new CustomerAccount(tenant.Id, branch.Id, recent.Id, null, "Cilt Bakımı", 1000m, 0m);
        recentAccount.RegisterPayment(400m, "cash", null, DateTime.UtcNow.AddDays(-5));
        var oldAccount = new CustomerAccount(tenant.Id, branch.Id, old.Id, null, "Eski paket", 1000m, 0m);
        oldAccount.RegisterPayment(1000m, "cash", null, DateTime.UtcNow.AddDays(-200));
        db.CustomerAccounts.AddRange(recentAccount, oldAccount);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, recent.Id, old.Id);
    }

    /// <summary>Pencere dışındaki tahsilat ortalamaya girmemeli.</summary>
    [Fact]
    public async Task GetSpendingStatsAsync_CountsOnlyPaymentsInsideWindow()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var seed = await SeedAsync(options, search);

        await using var db = NewDb(options, search);
        var result = await NewService(db, search).GetSpendingStatsAsync(seed.TenantId, days: 30);

        Assert.True(result.IsSuccess);
        Assert.Equal(30, result.Value!.Days);
        // 200 gün önceki 1.000 TL kapsam dışı: tek "harcayan" kalır, ortalama = 400.
        Assert.Equal(1, result.Value.SpenderCount);
        Assert.Equal(400m, result.Value.AvgSpent);
        Assert.Equal(400m, result.Value.TotalSpent);
    }

    /// <summary>days verilmezse tüm zamanlar — kartın eski (dönemsiz) davranışı korunur.</summary>
    [Fact]
    public async Task GetSpendingStatsAsync_WithoutDays_CoversAllTime()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var seed = await SeedAsync(options, search);

        await using var db = NewDb(options, search);
        var result = await NewService(db, search).GetSpendingStatsAsync(seed.TenantId, days: null);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value!.Days);
        Assert.Equal(2, result.Value.SpenderCount);
        Assert.Equal(1400m, result.Value.TotalSpent);
        Assert.Equal(700m, result.Value.AvgSpent);
    }

    /// <summary>
    /// NEGATİF HARCAMA ORTALAMAYI BOZMAZ (ham SQL yolu — bu hata yalnız orada vardı).
    ///
    /// <para>
    /// <c>AVG(NULLIF(t.Spent, 0))</c> yalnız TAM SIFIRI eliyor, NEGATİFİ paydaya katıyordu; oysa
    /// "harcayan" sayısı ve toplam yalnız pozitifleri sayıyordu. İadesi tahsilatını aşan tek bir
    /// müşteri kartı kendi içinde tutarsız hâle getiriyordu: A 100 TL harcarken B −50 TL ise
    /// ortalama 25 TL görünüyordu — harcayan 1 kişi ve toplam 100 TL olduğu hâlde.
    /// </para>
    /// <para>
    /// InMemory yolu zaten pozitifleri süzdüğü için bu testin GERÇEK veritabanında koşması şart.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task GetSpendingStatsAsync_NegativeSpenderDoesNotDragTheAverage()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Negatif QA", $"negatif-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;

            var spender = new Customer(tenant.Id, branch.Id, "HARCAYAN", "0555 121 31 41", null);
            var refunded = new Customer(tenant.Id, branch.Id, "IADESI ASAN", "0555 151 61 71", null);
            db.Customers.AddRange(spender, refunded);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, spender.Id, null, "Paket", 1000m, 0m);
            account.RegisterPayment(100m, "cash", null, DateTime.UtcNow.AddDays(-3));
            db.CustomerAccounts.Add(account);
            // İkinci müşterinin tahsilatı yok, iadesi var → net harcaması −50.
            db.RefundTransactions.Add(new RefundTransaction(
                tenant.Id, branch.Id, Guid.CreateVersion7(), refunded.Id, 50m, "cash"));
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var search = TestSearchIndex.Create();
            var result = await NewService(db, search).GetSpendingStatsAsync(tenantId, days: null);

            Assert.True(result.IsSuccess);
            Assert.Equal(1, result.Value!.SpenderCount);
            Assert.Equal(100m, result.Value.TotalSpent);
            // Hata varken 25 TL dönüyordu (100 ile −50'nin ortalaması).
            Assert.Equal(100m, result.Value.AvgSpent);
        }
    }

    /// <summary>Hiç ödemesi olmayan müşteri ortalamaya 0 olarak KATILMAZ (dayanak sayısı da artmaz).</summary>
    [Fact]
    public async Task GetSpendingStatsAsync_IgnoresCustomersWithoutPayments()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var seed = await SeedAsync(options, search);

        await using (var db = NewDb(options, search))
        {
            var silent = new Customer(seed.TenantId, seed.BranchId, "Ödemesiz Kayıt", "0555 000 55 66", null);
            db.Customers.Add(silent);
            await db.SaveChangesAsync();
            db.CustomerAccounts.Add(new CustomerAccount(seed.TenantId, seed.BranchId, silent.Id, null, "Açık borç", 2000m, 0m));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search).GetSpendingStatsAsync(seed.TenantId, days: null);

            Assert.True(result.IsSuccess);
            // Ödemesiz müşteri eklendi ama ortalama değişmedi.
            Assert.Equal(2, result.Value!.SpenderCount);
            Assert.Equal(700m, result.Value.AvgSpent);
        }
    }
}

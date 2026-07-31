using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// SATIŞ İPTALİNİN MUHASEBESİ. İptal = arşive TAŞIMA; para geçmişi silinmez, yer değiştirir.
///
/// <para>
/// Buradaki testler gerçek bir üretim hatasından doğdu: iptalde cari silinince tahsilat satırları
/// da cascade ile gidiyor, gelir sıfırlanıyor, üstüne iade gider yazılınca net kasa EKSİYE düşüyordu
/// (1.200 tahsil / 500 iade → 700 yerine −500). Ayrıca ters kayıtlar onaylanmamış adisyona da
/// uygulanıyor, geri alma ise iptalde hiç dokunulmamış kayıtları diriltiyordu.
/// </para>
/// </summary>
public sealed class SaleCancellationLedgerTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static CustomerAccountService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid AccountId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Ledger QA", "ledger-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Ledger MÜŞTERİ", "0555 000 11 22", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 1000m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, account.Id);
    }

    // =====================================================================================
    // 1) Tahsilat defteri — iptal geliri yok etmemeli
    // =====================================================================================

    [Fact]
    public async Task CancelSale_MovesPaymentsToLedger_AndRestoreRemovesThem()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RegisterPaymentAsync(seed.TenantId, seed.AccountId,
                new RegisterAccountPaymentRequest(600m, "card", null, null))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("vazgeçti", RefundedAmount: 250m, RefundMethod: "card"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            // Canlı satır gitti…
            Assert.Empty(await db.AccountPayments.ToListAsync());
            // …ama para defterde duruyor.
            var archived = await db.ArchivedSalePayments.SingleAsync();
            Assert.Equal(600m, archived.Amount);
            Assert.Equal("card", archived.Method);
            Assert.Equal(seed.AccountId, archived.OriginalAccountId);
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            // Canlı satır geri geldi → arşiv kopyası pasifleşti (çift sayım olmasın).
            Assert.Equal(600m, (await db.AccountPayments.SingleAsync()).Amount);
            Assert.Empty(await db.ArchivedSalePayments.ToListAsync());
        }
    }

    /// <summary>
    /// ASIL REGRESYON: kasa neti "tahsil edilen − iade edilen" olmalı. Eskiden gelir sıfırlanıp
    /// yalnız iade gider kaldığı için net EKSİ çıkıyordu.
    /// </summary>
    [Fact]
    public async Task CashFlow_NetStaysRetainedAmount_AfterCancellation()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RegisterPaymentAsync(seed.TenantId, seed.AccountId,
                new RegisterAccountPaymentRequest(1200m, "cash", null, null))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("kısmi iade", RefundedAmount: 500m, RefundMethod: "cash"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            var now = DateTime.UtcNow;
            var summary = await new CashFlowService(db).SummaryAsync(
                seed.TenantId, new CashFlowFilter(now.AddDays(-1), now.AddDays(1)));

            Assert.True(summary.IsSuccess);
            Assert.Equal(1200m, summary.Value!.TotalIncome);
            Assert.Equal(500m, summary.Value.TotalExpense);
            Assert.Equal(700m, summary.Value.NetAmount);
        }
    }

    // =====================================================================================
    // 2) Adisyon statüsü — onaylanmamış fişin yan etkisi yoktur
    // =====================================================================================

    [Fact]
    public async Task CancelSale_DoesNotReverseEffects_WhenAdisyonNotApproved()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var productId = await AddProductAsync(options, seed, stock: 10m);

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, seed.AccountId, null);
            adisyon.AddItem(AdisyonItemType.Product, productId, "Şampuan", 2m, 100m, null, false);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            // Hiç düşmemiş stok ARTMAMALI, sahte stok hareketi oluşmamalı.
            Assert.Equal(10m, (await db.Products.SingleAsync()).CurrentStock);
            Assert.Empty(await db.StockMovements.ToListAsync());
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            // Geri alma açık fişi ONAYLI yapmamalı — kendi eski statüsüne dönmeli.
            var adisyon = await db.Adisyonlar.SingleAsync();
            Assert.Equal(AdisyonStatus.Open, adisyon.Status);
            Assert.Null(adisyon.ApprovedAtUtc);
            Assert.Equal(10m, (await db.Products.SingleAsync()).CurrentStock);
        }
    }

    [Fact]
    public async Task CancelSale_ReversesStock_ForApprovedAdisyon_AndRestoreReapplies()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var productId = await AddProductAsync(options, seed, stock: 10m);

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, seed.AccountId, null);
            adisyon.AddItem(AdisyonItemType.Product, productId, "Şampuan", 2m, 100m, null, false);
            adisyon.Approve(null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.Equal(12m, (await db.Products.SingleAsync()).CurrentStock);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            Assert.Equal(10m, (await db.Products.SingleAsync()).CurrentStock);
            Assert.Equal(AdisyonStatus.Approved, (await db.Adisyonlar.SingleAsync()).Status);
        }
    }

    // =====================================================================================
    // 3) Prim — ödenmiş prim korunur, geri alma yalnız iptalde pasifleşenleri diriltir
    // =====================================================================================

    [Fact]
    public async Task CancelSale_KeepsPaidCommission_AndRestoreOnlyRevivesItsOwnRows()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var staffId = Guid.CreateVersion7();
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, seed.AccountId, null);
            adisyon.AddItem(AdisyonItemType.Service, Guid.CreateVersion7(), "Hizmet", 1m, 500m, staffId, false);
            adisyon.Approve(null);
            db.Adisyonlar.Add(adisyon);
            adisyonId = adisyon.Id;

            var unpaid = new StaffCommission(seed.TenantId, seed.BranchId, staffId, adisyonId, null, "Service", "Prim", 500m, 10m, DateTime.UtcNow);
            var paid = new StaffCommission(seed.TenantId, seed.BranchId, staffId, adisyonId, null, "Service", "Ödenmiş prim", 500m, 10m, DateTime.UtcNow);
            paid.MarkPaid();
            // İptalden ÖNCE başka bir sebeple pasifleştirilmiş prim — geri alma buna DOKUNMAMALI.
            var alreadyRemoved = new StaffCommission(seed.TenantId, seed.BranchId, staffId, adisyonId, null, "Service", "Eski hatalı prim", 500m, 10m, DateTime.UtcNow);
            db.StaffCommissions.AddRange(unpaid, paid, alreadyRemoved);
            await db.SaveChangesAsync();

            db.StaffCommissions.Remove(alreadyRemoved); // soft-delete
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            // Ödenmiş prim ayakta: karşılığında zaten bir gider yazılmıştı.
            var alive = await db.StaffCommissions.ToListAsync();
            Assert.Single(alive);
            Assert.True(alive[0].IsPaid);
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            var alive = await db.StaffCommissions.ToListAsync();
            // Ödenmiş + iptalde pasifleşen = 2. İptalden önce silinmiş olan DİRİLMEMELİ.
            Assert.Equal(2, alive.Count);
            Assert.DoesNotContain(alive, c => c.Description == "Eski hatalı prim");
        }
    }

    // =====================================================================================
    // 4) Sadakat — harcanmış puan bakiyeyi eksiye düşürmemeli
    // =====================================================================================

    [Fact]
    public async Task CancelSale_DoesNotPushLoyaltyBalanceNegative()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, seed.AccountId, null);
            adisyon.AddItem(AdisyonItemType.Service, Guid.CreateVersion7(), "Hizmet", 1m, 500m, null, false);
            adisyon.Approve(null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();

            // 100 puan kazanıldı, 90'ı başka bir işlemde harcandı → geri alınabilir bakiye 10.
            db.LoyaltyTransactions.Add(new LoyaltyTransaction(seed.TenantId, seed.CustomerId, 100, "Adisyon", adisyon.Id, "Kazanım", DateTime.UtcNow));
            db.LoyaltyTransactions.Add(new LoyaltyTransaction(seed.TenantId, seed.CustomerId, -90, "Manual", null, "Harcama", DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            var balance = await db.LoyaltyTransactions.SumAsync(l => l.Points);
            Assert.True(balance >= 0, $"Sadakat bakiyesi negatife düştü: {balance}");
        }
    }

    // =====================================================================================
    // 5) Randevu — karşılıksız kalan randevu kapanır, başka paketten karşılanan kalır
    // =====================================================================================

    [Fact]
    public async Task CancelSale_ClosesOrphanAppointments_ButKeepsCoveredOnes()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var orphanServiceId = Guid.CreateVersion7();
        var coveredServiceId = Guid.CreateVersion7();
        var staffId = Guid.CreateVersion7();
        Guid orphanApptId, coveredApptId;

        await using (var db = NewDb(options))
        {
            // İptal edilecek satışın seansları: iki hizmet.
            db.CustomerPackageSessions.Add(new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, seed.AccountId, Guid.CreateVersion7(), orphanServiceId, 4));
            db.CustomerPackageSessions.Add(new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, seed.AccountId, Guid.CreateVersion7(), coveredServiceId, 4));

            // İkinci hizmet BAŞKA bir satıştan da karşılanıyor → randevusu ayakta kalmalı.
            var otherAccount = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Diğer paket", 500m, 0m);
            db.CustomerAccounts.Add(otherAccount);
            await db.SaveChangesAsync();
            db.CustomerPackageSessions.Add(new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, otherAccount.Id, Guid.CreateVersion7(), coveredServiceId, 2));

            var start = DateTime.UtcNow.AddDays(3);
            var orphan = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, staffId, orphanServiceId, start, start.AddMinutes(45), 0m);
            var covered = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, staffId, coveredServiceId, start.AddHours(2), start.AddHours(3), 0m);
            db.Appointments.AddRange(orphan, covered);
            await db.SaveChangesAsync();
            orphanApptId = orphan.Id;
            coveredApptId = covered.Id;
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            var alive = await db.Appointments.Select(a => a.Id).ToListAsync();
            Assert.DoesNotContain(orphanApptId, alive);
            Assert.Contains(coveredApptId, alive);
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            var alive = await db.Appointments.Select(a => a.Id).ToListAsync();
            Assert.Contains(orphanApptId, alive);
            Assert.Contains(coveredApptId, alive);
        }
    }

    // =====================================================================================
    // 6) Paket kullanımı — başka paketten düşen seans geri verilir
    // =====================================================================================

    [Fact]
    public async Task CancelSale_CreditsBackPackageUse_AndRestoreConsumesAgain()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var serviceId = Guid.CreateVersion7();
        Guid otherSessionId;

        await using (var db = NewDb(options))
        {
            // Başka bir satıştan gelen paket: 1 seansı bu adisyonda kullanılmış.
            var otherAccount = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Diğer paket", 500m, 0m);
            db.CustomerAccounts.Add(otherAccount);
            await db.SaveChangesAsync();

            var session = new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, otherAccount.Id, Guid.CreateVersion7(), serviceId, 5);
            session.TryConsume();
            db.CustomerPackageSessions.Add(session);

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, seed.AccountId, null);
            adisyon.AddItem(AdisyonItemType.PackageUse, serviceId, "Paketten kullanım", 1m, 0m, null, true);
            adisyon.Approve(null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            otherSessionId = session.Id;
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.Equal(0, (await db.CustomerPackageSessions.SingleAsync(s => s.Id == otherSessionId)).UsedSessions);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId)).IsSuccess);

        await using (var db = NewDb(options))
            Assert.Equal(1, (await db.CustomerPackageSessions.SingleAsync(s => s.Id == otherSessionId)).UsedSessions);
    }

    private static async Task<Guid> AddProductAsync(DbContextOptions<GuzellikDbContext> options, Seed seed, decimal stock)
    {
        await using var db = NewDb(options);
        var product = new Product(seed.TenantId, seed.BranchId, "Şampuan", ProductCategory.Other, "adet", 50m, 100m, stock, 0m);
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product.Id;
    }
}

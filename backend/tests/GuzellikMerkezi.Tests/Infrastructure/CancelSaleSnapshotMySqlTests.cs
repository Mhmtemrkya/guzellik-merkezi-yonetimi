using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// İPTAL TRANSACTION'I BAYAT SNAPSHOT'A DÜŞMEMELİ.
///
/// <para>
/// MariaDB/MySQL varsayılanı REPEATABLE READ: transaction'ın İLK okuması bir snapshot dondurur ve
/// sonraki normal okumalar — cari satırı <c>FOR UPDATE</c> ile kilitlense bile — o eski görüntüyü
/// okumaya devam eder. İptal akışı önce cariyi okuyup sonra kilitlediği için, arada başka bir
/// bağlantının commit ettiği tahsilat "yok" görünüyor, arşive girmiyor ve cari cascade silinince
/// o para KALICI olarak kayboluyordu.
/// </para>
///
/// <para>
/// Bu senaryo yalnız gerçek MySQL/MariaDB üzerinde üretilebilir: InMemory sağlayıcıda snapshot
/// izolasyonu diye bir şey yok. Mevcut <c>CancelSale_SeesPaymentCommittedJustBefore</c> testi
/// tahsilatı transaction BAŞLAMADAN önce eklediği için bu pencereyi kapsamıyordu.
/// </para>
/// </summary>
public sealed class CancelSaleSnapshotMySqlTests
{
    private static CustomerAccountService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid AccountId);

    /// <summary>1.000 ₺ satış, 400 ₺ peşin tahsilat.</summary>
    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Snapshot QA", $"snap-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "SNAPSHOT MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 1000m, 0m);
        account.RegisterPayment(400m, "cash", null, DateTime.UtcNow.AddDays(-1));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, account.Id);
    }

    /// <summary>
    /// İptal sırasında araya giren tahsilat ARŞİVE GİRMELİ. Kaybolursa gerçek para kaybı olur:
    /// canlı satır silinir, arşivde izi yoktur, hiçbir rapor onu bir daha göremez.
    /// </summary>
    [MySqlFact]
    public async Task CancelSale_ArchivesPaymentCommittedDuringTransaction()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // Ayrı bağlantı: iptal transaction'ı AÇILDIKTAN sonra tahsilat ekler ve commit eder.
        await using var cancelDb = database.NewContext();
        await using (var tx = await cancelDb.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted))
        {
            // Transaction'ın ilk okuması — REPEATABLE READ'de snapshot'ı BURASI dondururdu.
            var before = await cancelDb.CustomerAccounts.AsNoTracking()
                .Where(a => a.Id == seed.AccountId).Select(a => a.TotalAmount).FirstAsync();
            Assert.Equal(1000m, before);

            // Araya giren bağlantı 250 ₺ daha tahsil ediyor. Tahsilat satırı DbSet'e AÇIKÇA
            // eklenir: PK ctor'da atandığı için EF navigasyon üzerinden eklemeyi UPDATE sanıyor
            // (bkz. AdisyonService.AddItemAsync'teki aynı tuzak).
            await using (var otherDb = database.NewContext())
            {
                otherDb.AccountPayments.Add(new AccountPayment(seed.AccountId, 250m, "card", null, DateTime.UtcNow));
                await otherDb.SaveChangesAsync();
            }

            // Kilit sonrası okuma TAZE olmalı: 2 tahsilat (400 + 250) görülmeli.
            await cancelDb.Database.SqlQueryRaw<Guid>(
                    "SELECT Id AS Value FROM customer_accounts WHERE Id = {0} FOR UPDATE", seed.AccountId.ToString())
                .ToListAsync();
            var seen = await cancelDb.AccountPayments.AsNoTracking()
                .Where(p => p.CustomerAccountId == seed.AccountId).CountAsync();
            Assert.Equal(2, seen);

            await tx.RollbackAsync();
        }

        // Gerçek iptal akışı da aynı taze görüntüyü kullanmalı → 650 ₺ arşive girer.
        await using (var db = database.NewContext())
        {
            var result = await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("Test iptali"));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var archived = await check.ArchivedSalePayments.IgnoreQueryFilters()
                .Where(p => !p.IsDeleted && p.TenantId == seed.TenantId)
                .ToListAsync();
            // Araya giren 250 ₺ dahil TÜM tahsilatlar kalıcı deftere geçmeli.
            Assert.Equal(650m, archived.Sum(p => p.Amount));
        }
    }
}

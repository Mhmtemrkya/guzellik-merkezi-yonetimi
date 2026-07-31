using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MUHASEBE BÜTÜNLÜĞÜ REGRESYONLARI (3. inceleme raporu).
/// Her test raporda doğrulanmış bir hatanın kapandığını kilitler.
/// </summary>
public sealed class AccountingIntegrityTests
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

    private static async Task<(Guid TenantId, Guid BranchId, Guid CustomerId)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Integrity QA", $"integrity-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Bütünlük MÜŞTERİ", "0555 777 88 99", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        return (tenant.Id, branch.Id, customer.Id);
    }

    // =====================================================================================
    // Açık alacak: peşinat İKİ KEZ düşülmemeli
    // =====================================================================================

    /// <summary>
    /// Taksit planı zaten "toplam − peşinat" üzerinden kurulur. Peşinat artık gerçek bir tahsilat
    /// satırı olduğu için, plan tutarından bir kez daha düşülürse açık alacak peşinat kadar
    /// EKSİK çıkar (canlıda 19.500 yerine 7.500 görünüyordu).
    /// </summary>
    [Fact]
    public async Task Receivables_DoNotSubtractDepositTwice()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var created = await NewService(db).CreateAsync(seed.TenantId, new CreateCustomerAccountRequest(
                seed.BranchId, seed.CustomerId, null, "Taksitli paket", 12000m, 2000m, 10,
                DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)), null));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var account = await db.CustomerAccounts
                .Include(a => a.Payments).Include(a => a.Installments).SingleAsync();

            // Plan 10.000 (12.000 − 2.000). Peşinat dışında tahsilat yok → açık alacak 10.000.
            var planned = account.Installments.Sum(i => i.Amount);
            var totalPaid = account.Payments.Sum(p => p.Amount);
            var allocatable = Math.Max(0m, totalPaid - account.DepositAmount - account.RefundedAmount);

            Assert.Equal(10000m, planned);
            Assert.Equal(2000m, totalPaid);            // peşinat defterde
            Assert.Equal(0m, allocatable);             // ama taksitleri kapatmaz
            Assert.Equal(10000m, planned - allocatable);
        }
    }

    // =====================================================================================
    // Peşinat: kolon sonradan değiştirilemez (defterle ayrışma)
    // =====================================================================================

    [Fact]
    public async Task UpdateAccount_RejectsDepositChange()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid accountId;

        await using (var db = NewDb(options))
        {
            var created = await NewService(db).CreateAsync(seed.TenantId, new CreateCustomerAccountRequest(
                seed.BranchId, seed.CustomerId, null, "Peşinatlı", 8000m, 2000m, 0,
                DateOnly.FromDateTime(DateTime.UtcNow), null));
            Assert.True(created.IsSuccess);
            accountId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var changed = await NewService(db).UpdateAsync(seed.TenantId, accountId,
                new UpdateCustomerAccountRequest("Peşinatlı", 8000m, 5000m, true, null));
            Assert.True(changed.IsFailure);
            Assert.Equal("Validation", changed.Error.Code);

            // Aynı peşinatla güncelleme serbest.
            var ok = await NewService(db).UpdateAsync(seed.TenantId, accountId,
                new UpdateCustomerAccountRequest("Yeni ad", 9000m, 2000m, true, null));
            Assert.True(ok.IsSuccess, ok.IsFailure ? ok.Error.Message : null);
        }
    }

    // =====================================================================================
    // Peşinat tahsilatı deterministik Id ile mükerrer eklenemez
    // =====================================================================================

    [Fact]
    public void DepositPayment_UsesAccountIdAsPrimaryKey()
    {
        var accountId = Guid.CreateVersion7();
        var first = AccountPayment.ForDeposit(accountId, 1000m, "cash", DateTime.UtcNow);
        var second = AccountPayment.ForDeposit(accountId, 1000m, "cash", DateTime.UtcNow);

        // Aynı cari için üretilen peşinat satırı HER ZAMAN aynı Id'yi alır → ikinci ekleme
        // birincil anahtar çakışmasıyla reddedilir (çoklu backend yarışı koruması).
        Assert.Equal(accountId, first.Id);
        Assert.Equal(first.Id, second.Id);
    }

    // =====================================================================================
    // Şifreli Reference yerine deterministik adisyon bağı
    // =====================================================================================

    [Fact]
    public void PaymentAndStockMovement_CarryDeterministicAdisyonLink()
    {
        var adisyonId = Guid.CreateVersion7();

        var payment = new AccountPayment(Guid.CreateVersion7(), 500m, "cash", "ADS-abc", DateTime.UtcNow, adisyonId);
        Assert.Equal(adisyonId, payment.SourceAdisyonId);

        var movement = new StockMovement(
            Guid.CreateVersion7(), Guid.CreateVersion7(), StockMovementType.Sale, 2m, DateTime.UtcNow,
            unitCost: 40m, reference: "ADS-abc", notes: null, staffMemberId: null, sourceAdisyonId: adisyonId);
        Assert.Equal(adisyonId, movement.SourceAdisyonId);
    }
}

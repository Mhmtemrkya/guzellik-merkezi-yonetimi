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

    /// <summary>
    /// GERÇEK ONAY YOLU stok hareketine kaynak adisyonu YAZMALI.
    ///
    /// <para>
    /// Aşağıdaki test entity'yi elle kurduğu için yalnız constructor'ın alanı taşıdığını
    /// doğruluyordu; <c>ApproveCoreAsync</c> parametreyi hiç geçmiyor olsa bile yeşil kalıyordu —
    /// nitekim öyleydi ve deploy sonrası her yeni ürün satışı kaynaksız kalacaktı. Bu test
    /// servisin kendisini çalıştırır: bağ kopunca kırmızıya döner.
    /// </para>
    /// </summary>
    [Fact]
    public async Task ApproveAsync_WritesSourceAdisyonIdOnStockSale()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var product = new Product(seed.TenantId, seed.BranchId, "Serum", ProductCategory.SkinCare, "adet",
                cost: 100m, salePrice: 250m, currentStock: 10m, minStockLevel: 1m);
            db.Products.Add(product);
            await db.SaveChangesAsync();

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Product, product.Id, "Serum", 1, 250m, null, false));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var db = NewDb(options))
        {
            var user = new TestCurrentUser(UserRole.InstitutionOwner);
            var service = new AdisyonService(db, new NoopAuditLogger(), user,
                new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
            var approved = await service.ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var movement = await db.StockMovements.SingleAsync();
            Assert.Equal(StockMovementType.Sale, movement.Type);
            Assert.Equal(adisyonId, movement.SourceAdisyonId);
        }
    }

    /// <summary>
    /// SATIŞ İPTALİ YALNIZ KENDİ RANDEVUSUNU KAPATIR.
    ///
    /// <para>
    /// Müşterinin AYNI hizmeti içeren iki paketi varsa, iptal eskiden tahminle karar veriyordu
    /// (kalan seans kadarını koru, gerisini kapat) ve yanlış paketin randevusunu kapatabiliyordu.
    /// Randevu artık dayandığı seansı taşıdığı için karar kesindir: A satışı iptal edilince yalnız
    /// A'nın seansına bağlı randevu kapanır, B'ninki dokunulmadan kalır.
    /// </para>
    /// </summary>
    [Fact]
    public async Task CancelSale_ClosesOnlyAppointmentsBoundToThatSale()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var serviceId = Guid.CreateVersion7();
        Guid accountAId, apptAId, apptBId;

        await using (var db = NewDb(options))
        {
            var accountA = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "A paketi", 1000m, 0m);
            var accountB = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "B paketi", 1000m, 0m);
            db.CustomerAccounts.AddRange(accountA, accountB);
            await db.SaveChangesAsync();
            accountAId = accountA.Id;

            var sessionA = new CustomerPackageSession(seed.TenantId, seed.CustomerId, accountA.Id, Guid.Empty, serviceId, 1, null);
            var sessionB = new CustomerPackageSession(seed.TenantId, seed.CustomerId, accountB.Id, Guid.Empty, serviceId, 1, null);
            db.CustomerPackageSessions.AddRange(sessionA, sessionB);
            await db.SaveChangesAsync();

            var start = DateTime.UtcNow.AddDays(3);
            var apptA = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, Guid.CreateVersion7(), serviceId, start, start.AddHours(1), 0m, null);
            var apptB = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, Guid.CreateVersion7(), serviceId, start.AddDays(1), start.AddDays(1).AddHours(1), 0m, null);
            apptA.LinkToPackageSession(sessionA.Id);
            apptB.LinkToPackageSession(sessionB.Id);
            db.Appointments.AddRange(apptA, apptB);
            await db.SaveChangesAsync();
            apptAId = apptA.Id;
            apptBId = apptB.Id;
        }

        await using (var db = NewDb(options))
        {
            var cancelled = await NewService(db).CancelSaleAsync(seed.TenantId, accountAId, new CancelSaleRequest("A iptal"));
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var live = await check.Appointments.Select(a => a.Id).ToListAsync();
            Assert.DoesNotContain(apptAId, live);  // A'nın seansına bağlıydı → kapandı
            Assert.Contains(apptBId, live);        // B'nin seansına bağlı → korunmalı
        }
    }

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

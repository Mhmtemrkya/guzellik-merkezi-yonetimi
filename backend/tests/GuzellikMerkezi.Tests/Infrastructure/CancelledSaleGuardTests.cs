using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// İptal edilmiş satışa para/plan işlemi yapılamaz.
///
/// Bu kapı SUNUCUDA olmak zorundadır: arayüzdeki buton gizlemesi güvenlik sınırı değildir —
/// Ön Muhasebe'deki "Tahsilat Al" yolu ve doğrudan API çağrısı butonu hiç görmez.
/// (Gerçekten yaşandı: satış iptal edilmesine rağmen tahsilat alınabiliyordu.)
/// </summary>
public sealed class CancelledSaleGuardTests
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

    /// <summary>Kurum + şube + müşteri + tek taksitli cari kurar.</summary>
    private static async Task<(Guid TenantId, Guid AccountId)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Guard QA", "guard-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Test MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 1000m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();
        return (tenant.Id, account.Id);
    }

    [Fact]
    public async Task RegisterPayment_IsRejected_WhenSaleCancelled()
    {
        var options = NewOptions();
        var (tenantId, accountId) = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var ok = await NewService(db).RegisterPaymentAsync(tenantId, accountId, new RegisterAccountPaymentRequest(100m, "cash", null, null));
            Assert.True(ok.IsSuccess); // iptal edilmeden önce tahsilat alınabilir
        }

        await using (var db = NewDb(options))
        {
            var cancelled = await NewService(db).CancelSaleAsync(tenantId, accountId, new CancelSaleRequest("müşteri vazgeçti"));
            Assert.True(cancelled.IsSuccess);
        }

        await using (var db = NewDb(options))
        {
            var blocked = await NewService(db).RegisterPaymentAsync(tenantId, accountId, new RegisterAccountPaymentRequest(100m, "cash", null, null));
            Assert.True(blocked.IsFailure);
            Assert.Equal("Conflict", blocked.Error.Code);
        }
    }

    [Fact]
    public async Task Update_IsRejected_WhenSaleCancelled()
    {
        var options = NewOptions();
        var (tenantId, accountId) = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(tenantId, accountId, new CancelSaleRequest(null))).IsSuccess);

        await using (var db = NewDb(options))
        {
            var blocked = await NewService(db).UpdateAsync(tenantId, accountId, new UpdateCustomerAccountRequest("yeni ad", 9999m, 0m, true, null));
            Assert.True(blocked.IsFailure);
            Assert.Equal("Conflict", blocked.Error.Code);
        }
    }

    /// <summary>
    /// İptal = ARŞİVE TAŞIMA. Canlı satırlar gerçekten silinmeli, tam kopyaları arşivde durmalı.
    /// (Eskiden satırlar yerinde kalıyordu; süzgeç koymayan raporlar iptal edilmiş satışın parasını
    /// saymaya devam ediyordu — asıl düzeltilen hata bu.)
    /// </summary>
    [Fact]
    public async Task CancelSale_MovesRowsToArchive_AndDeletesLiveRows()
    {
        var options = NewOptions();
        var (tenantId, accountId) = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RegisterPaymentAsync(tenantId, accountId, new RegisterAccountPaymentRequest(400m, "cash", null, null))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(tenantId, accountId, new CancelSaleRequest("paket iadesi", RefundedAmount: 150m))).IsSuccess);

        await using (var db = NewDb(options))
        {
            Assert.False(await db.CustomerAccounts.IgnoreQueryFilters().AnyAsync(a => a.Id == accountId));
            Assert.False(await db.AccountPayments.IgnoreQueryFilters().AnyAsync(p => p.CustomerAccountId == accountId));
            Assert.False(await db.Installments.IgnoreQueryFilters().AnyAsync(i => i.CustomerAccountId == accountId));

            var archive = await db.CancelledSales.SingleAsync(x => x.OriginalAccountId == accountId);
            Assert.Equal(1000m, archive.TotalAmount);
            Assert.Equal(400m, archive.CollectedAmount);   // peşinat 0 + tahsilat 400
            Assert.Equal(150m, archive.RefundedAmount);
            Assert.Equal(250m, archive.RetainedAmount);    // kurumda kalan
            Assert.Equal("paket iadesi", archive.CancellationReason);
        }

        // Arşiv listesi "İptal Edilenler" ekranını besler.
        await using (var db = NewDb(options))
        {
            var listed = await NewService(db).ListCancelledAsync(tenantId);
            Assert.True(listed.IsSuccess);
            var only = Assert.Single(listed.Value!);
            Assert.Equal(accountId, only.OriginalAccountId);
        }
    }

    /// <summary>
    /// Geri alma yedekten kurar ve AYNI Id'leri korur — randevu/adisyon gibi bu satırlara Id ile
    /// bakan kayıtlar kırılmasın diye.
    /// </summary>
    [Fact]
    public async Task RestoreSale_RebuildsRowsWithOriginalIds()
    {
        var options = NewOptions();
        var (tenantId, accountId) = await SeedAsync(options);

        Guid paymentId;
        await using (var db = NewDb(options))
        {
            Assert.True((await NewService(db).RegisterPaymentAsync(tenantId, accountId, new RegisterAccountPaymentRequest(300m, "card", "REF-1", null))).IsSuccess);
            paymentId = await db.AccountPayments.Where(p => p.CustomerAccountId == accountId).Select(p => p.Id).SingleAsync();
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(tenantId, accountId, new CancelSaleRequest("yanlış iptal"))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(tenantId, accountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            var account = await db.CustomerAccounts.Include(a => a.Payments).SingleAsync(a => a.Id == accountId);
            Assert.Equal(1000m, account.TotalAmount);
            var payment = Assert.Single(account.Payments);
            Assert.Equal(paymentId, payment.Id);       // Id korunmalı
            Assert.Equal(300m, payment.Amount);
            Assert.Equal("REF-1", payment.Reference);

            // Geri alınan iptal arşiv listesinden düşer (iz olarak RestoredAtUtc ile durur).
            Assert.Empty((await NewService(db).ListCancelledAsync(tenantId)).Value!);
        }
    }

    [Fact]
    public async Task RegisterPayment_WorksAgain_AfterSaleRestored()
    {
        var options = NewOptions();
        var (tenantId, accountId) = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(tenantId, accountId, new CancelSaleRequest("yanlış iptal"))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RestoreSaleAsync(tenantId, accountId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            var ok = await NewService(db).RegisterPaymentAsync(tenantId, accountId, new RegisterAccountPaymentRequest(250m, "cash", null, null));
            Assert.True(ok.IsSuccess);
        }
    }
}

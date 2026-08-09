using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// İADENİN KANALI DIŞARI VERİLMELİ.
///
/// <para>
/// Kanal (nakit/kart/havale) iptal anında zaten <c>refund_transactions</c>'a yazılıyordu ama
/// <see cref="CancelledSaleDto"/> onu HİÇ taşımıyordu. Ekstre bu yüzden "müşteriye geri ödendi"
/// diye SENTETİK bir metin gösteriyor, KART iadesi ile NAKİT iade ayırt edilemiyordu — kasa
/// kırılımı tutmuyordu. Veri vardı, yalnız uçtan çıkmıyordu.
/// </para>
/// </summary>
public sealed class RefundChannelExposureTests
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

    private sealed record Seed(Guid TenantId, Guid AccountId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("İade QA", $"iade-qa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "İade MÜŞTERİ", "0555 000 33 44", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Lazer Paketi", 1000m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, account.Id);
    }

    /// <summary>KART iadesi listede KART olarak görünmeli — nakit varsayılanına düşmemeli.</summary>
    [Fact]
    public async Task IptalListesi_IadeKanaliniTasir()
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
            var listed = await NewService(db).ListCancelledAsync(seed.TenantId);
            Assert.True(listed.IsSuccess, listed.IsFailure ? listed.Error.Message : null);

            var row = Assert.Single(listed.Value!);
            var refund = Assert.Single(row.Refunds);
            // ASIL İDDİA: kanal dışarı çıkıyor.
            Assert.Equal("card", refund.Method);
            Assert.Equal(250m, refund.Amount);
        }
    }

    /// <summary>HAVALE iadesi nakit sayılamaz — kasa kırılımında yanlış satıra düşerdi.</summary>
    [Fact]
    public async Task IptalListesi_HavaleIadesiNakitSayilmaz()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RegisterPaymentAsync(seed.TenantId, seed.AccountId,
                new RegisterAccountPaymentRequest(400m, "transfer", null, null))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("vazgeçti", RefundedAmount: 400m, RefundMethod: "transfer"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            var listed = await NewService(db).ListCancelledAsync(seed.TenantId);
            var refund = Assert.Single(listed.Value!.Single().Refunds);
            Assert.Equal("transfer", refund.Method);
        }
    }

    /// <summary>
    /// İADESİZ iptalde iade satırı OLMAMALI.
    ///
    /// Boş listeyi "0 TL nakit iade" gibi bir satıra çevirmek ekstreye olmayan bir kasa
    /// hareketi ekler; para kurumda kalmıştır, çıkış yoktur.
    /// </summary>
    [Fact]
    public async Task IadesizIptal_IadeSatiriUretmez()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RegisterPaymentAsync(seed.TenantId, seed.AccountId,
                new RegisterAccountPaymentRequest(600m, "cash", null, null))).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("vazgeçti"))).IsSuccess);

        await using (var db = NewDb(options))
        {
            var row = Assert.Single((await NewService(db).ListCancelledAsync(seed.TenantId)).Value!);
            Assert.Empty(row.Refunds);
            // Tahsilat tarafı bozulmadı: para kurumda kaldı.
            Assert.Equal(600m, row.RetainedAmount);
        }
    }
}

using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// KULLANICININ ANLATTIĞI SENARYO, BİREBİR: 30.000 ₺ paket · 10.000 ₺ peşin · kalan 20.000 ₺ 5 taksit.
///
/// <para>
/// İki ayrı soru var ve cevapları FARKLI:
/// </para>
/// <list type="number">
/// <item>Taksitler 30.000'i mi yoksa KALAN 20.000'i mi bölüyor? (plan doğru mu)</item>
/// <item>Peşin alınan 10.000 "Aylık Taksit Performansı"nda görünüyor mu? (rapor eksik mi)</item>
/// </list>
/// </summary>
public sealed class DepositInstallmentScenarioTests
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

    private sealed record Seed(Guid TenantId, Guid CustomerId, Guid BranchId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Peşinat QA", $"pes-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Peşinat MÜŞTERİ", "0555 909 10 11", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, customer.Id, branch.Id);
    }

    /// <summary>Senaryoyu kurar: 30.000 toplam, 10.000 peşinat, 5 taksit (ilk vade gelecek ay).</summary>
    private static async Task<Guid> CreateSaleAsync(DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        var created = await NewService(db).CreateAsync(seed.TenantId, new CreateCustomerAccountRequest(
            seed.BranchId, seed.CustomerId, null, "Lazer Paketi",
            TotalAmount: 30000m, DepositAmount: 10000m, InstallmentCount: 5,
            FirstDueDate: DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)), Notes: null));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        return created.Value!.Id;
    }

    /// <summary>
    /// TAKSİT PLANI KALAN TUTARI BÖLER — 30.000'i değil.
    ///
    /// Kullanıcının beklentisi: 20.000 / 5 = 4.000. Kod `TotalAmount − DepositAmount` üzerinden
    /// kurar; bu test o kuralı sabitler (biri "toplamı böl" diye değiştirirse kapı düşer).
    /// </summary>
    [Fact]
    public async Task Plan_KalaniBoler_PesinatiDegil()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await CreateSaleAsync(options, seed);

        await using var verify = NewDb(options);
        var account = await verify.CustomerAccounts.Include(a => a.Installments)
            .SingleAsync(a => a.Id == accountId);

        Assert.Equal(5, account.Installments.Count);
        Assert.All(account.Installments, i => Assert.Equal(4000m, i.Amount));
        // Plan toplamı KALAN borçtur; peşinat plana girmez.
        Assert.Equal(20000m, account.Installments.Sum(i => i.Amount));
    }

    /// <summary>
    /// PEŞİNAT TAKSİTLERİ KAPATMAZ (çift sayım olmaz).
    ///
    /// Peşinat gerçek bir tahsilat satırıdır; havuzdan düşülmeseydi ilk iki taksiti bir kez daha
    /// kapatır ve müşteri 10.000 fazla ödemiş görünürdü.
    /// </summary>
    [Fact]
    public async Task Pesinat_TaksitleriKapatmaz()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await CreateSaleAsync(options, seed);

        await using var verify = NewDb(options);
        var account = await verify.CustomerAccounts
            .Include(a => a.Installments).Include(a => a.Payments)
            .SingleAsync(a => a.Id == accountId);

        // Peşinat GERÇEK bir tahsilat satırı olarak var (kasa/gelir defteri onu görsün).
        Assert.Equal(10000m, account.Payments.Sum(p => p.Amount));

        // …ama taksitlere dağıtılmaz: 5 taksitin hiçbiri kapanmamış olmalı.
        var allocation = account.AllocatePayments();
        Assert.All(account.Installments, i => Assert.Equal(0m, allocation[i.Id]));
    }

    /// <summary>
    /// KUSUR: PEŞİN ALINAN PARA "AYLIK TAKSİT PERFORMANSI"NDA HİÇ GÖRÜNMÜYOR.
    ///
    /// <para>
    /// Grafik yalnız TAKSİT satırlarından kuruluyor. Peşinat taksit olmadığı için, kasaya 10.000 ₺
    /// girmiş olmasına rağmen satışın yapıldığı ay grafikte BOŞ görünüyor. Kullanıcı bu grafiğe
    /// "o ay ne tahsil ettim" diye bakıyor; en büyük tahsilat kaleminin görünmemesi raporu yanıltıcı
    /// yapıyor.
    /// </para>
    /// </summary>
    [Fact]
    public async Task AylikTaksitPerformansi_PesinatiGosterir()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        await CreateSaleAsync(options, seed);

        await using var verify = NewDb(options);
        var report = await NewService(verify).GetReportAsync(seed.TenantId, months: 12);
        Assert.True(report.IsSuccess, report.IsFailure ? report.Error.Message : null);

        var now = DateTime.UtcNow;
        var thisMonth = report.Value!.MonthlyInstallments
            .SingleOrDefault(m => m.Year == now.Year && m.Month == now.Month);
        Assert.NotNull(thisMonth);

        // ASIL İDDİA: peşin alınan 10.000 bu ayın tahsilatında görünmeli.
        Assert.Equal(10000m, thisMonth.Collected);
    }

    /// <summary>
    /// PEŞİNAT YOKSA TOPLAMIN TAMAMI BÖLÜNÜR — 30.000 / 5 = 6.000 (kullanıcı kuralı).
    ///
    /// Aynı kuralın diğer ucu: plan her zaman "toplam − peşinat"tır; peşinat 0 iken bu, toplamın
    /// kendisidir. İki uç birlikte sabitlenir ki biri düzeltilirken diğeri bozulmasın.
    /// </summary>
    [Fact]
    public async Task Plan_PesinatYoksa_ToplamiBoler()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        Guid accountId;
        await using (var db = NewDb(options))
        {
            var created = await NewService(db).CreateAsync(seed.TenantId, new CreateCustomerAccountRequest(
                seed.BranchId, seed.CustomerId, null, "Lazer Paketi",
                TotalAmount: 30000m, DepositAmount: 0m, InstallmentCount: 5,
                FirstDueDate: DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)), Notes: null));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            accountId = created.Value!.Id;
        }

        await using var verify = NewDb(options);
        var account = await verify.CustomerAccounts.Include(a => a.Installments)
            .SingleAsync(a => a.Id == accountId);

        Assert.Equal(5, account.Installments.Count);
        Assert.All(account.Installments, i => Assert.Equal(6000m, i.Amount));
        Assert.Equal(30000m, account.Installments.Sum(i => i.Amount));
    }
}

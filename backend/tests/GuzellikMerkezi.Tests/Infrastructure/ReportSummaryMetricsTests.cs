using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// GENEL BAKIŞ KART SETİ SUNUCUNUN SÖZLEŞMESİDİR.
///
/// <para>
/// Web ve mobil, <c>metrics</c> listesini OLDUĞU GİBİ çizer — kart eklemek/çıkarmak yalnız
/// <c>ReportsService.BuildSummaryMetrics</c> ile olur. Bu yüzden listenin kendisi test edilir:
/// kaldırılmış bir metrik (net kâr, tamamlanma oranı, ortalama sepet…) geri sızarsa ya da yeni
/// bir kart eklenip iki arayüzde de karşılığı unutulursa burada patlar.
/// </para>
/// <para>
/// "Toplam Alacak" ayrıca HESAP olarak doğrulanır: taban SATIŞTIR, taksit planı değil ve peşinat
/// İKİNCİ kez düşülmez (peşinat gerçek bir tahsilat satırıdır; çıkarmak alacağı eksik gösterirdi).
/// </para>
/// </summary>
public sealed class ReportSummaryMetricsTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static ReportsService NewService(GuzellikDbContext db) =>
        new(db, new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(Guid TenantId, Guid CustomerId, Guid BranchId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Rapor Metrik QA", "rapor-metrik-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Metrik MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, customer.Id, branch.Id);
    }

    /// <summary>Dönemin tamamını kapsayan istek (kıyas yok).</summary>
    private static ReportRangeRequest ThisMonth()
    {
        var now = DateTime.UtcNow;
        return new ReportRangeRequest(
            new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1));
    }

    /// <summary>Kart seti tam olarak bu altı anahtar — ne eksik ne fazla, sıra dahil.</summary>
    [Fact]
    public async Task Summary_ExposesExactlyTheAgreedCards()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).GetSummaryAsync(seed.TenantId, ThisMonth());

        Assert.True(result.IsSuccess);
        Assert.Equal(
            new[] { "income", "expense", "openReceivable", "sales", "appointments", "activeCustomers" },
            result.Value!.Metrics.Select(m => m.Key).ToArray());
        Assert.Equal(
            new[] { "Toplam Gelir", "Toplam Gider", "Toplam Alacak", "Toplam Satış Tutarı", "Randevu Sayısı", "Aktif Müşteri" },
            result.Value.Metrics.Select(m => m.Label).ToArray());
    }

    /// <summary>
    /// 10.000 ₺ satış · 2.000 ₺ peşinat (tahsilat satırı olarak yazılı) → alacak 8.000 ₺.
    /// Peşinat ikinci kez düşülseydi 6.000 çıkardı; taksit planına bakılsaydı satışın tamamı
    /// (ya da 0) görünürdü.
    /// </summary>
    [Fact]
    public async Task OpenReceivable_IsSaleMinusPayments_WithoutDoubleCountingDeposit()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Cilt Paketi", 10_000m, 2_000m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.AccountPayments.Add(new AccountPayment(account.Id, 2_000m, "cash", null, DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).GetSummaryAsync(seed.TenantId, ThisMonth());
            Assert.True(result.IsSuccess);

            var receivable = result.Value!.Metrics.Single(m => m.Key == "openReceivable").Value;
            var sales = result.Value.Metrics.Single(m => m.Key == "sales").Value;
            Assert.Equal(8_000m, receivable);
            Assert.Equal(10_000m, sales);
        }
    }

    /// <summary>
    /// İADE ALACAĞI YENİDEN DOĞURUR: 10.000 ₺ satış · 4.000 ₺ tahsilat · 1.000 ₺ iade →
    /// müşteride kalan 3.000, borç 7.000. (Cari kartının kendi kuralıyla aynı hesap.)
    /// </summary>
    [Fact]
    public async Task OpenReceivable_CountsRefundAsUnpaidAgain()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Lazer Paketi", 10_000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.AccountPayments.Add(new AccountPayment(account.Id, 4_000m, "card", null, DateTime.UtcNow));
            await db.SaveChangesAsync();

            account.ApplyPreservedRefund(1_000m);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).GetSummaryAsync(seed.TenantId, ThisMonth());
            Assert.True(result.IsSuccess);
            Assert.Equal(7_000m, result.Value!.Metrics.Single(m => m.Key == "openReceivable").Value);
        }
    }

    /// <summary>Tamamı tahsil edilmiş satış alacağa girmez (negatife de düşmez).</summary>
    [Fact]
    public async Task OpenReceivable_IsZeroWhenFullyCollected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Peşin Satış", 1_500m, 1_500m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            // Fazla ödeme (alacak bakiyesi) borcu EKSİYE çekmemeli.
            db.AccountPayments.Add(new AccountPayment(account.Id, 1_800m, "cash", null, DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).GetSummaryAsync(seed.TenantId, ThisMonth());
            Assert.True(result.IsSuccess);
            Assert.Equal(0m, result.Value!.Metrics.Single(m => m.Key == "openReceivable").Value);
        }
    }

    /// <summary>Dönem dışında satılmış bir cari bu ayın alacağına girmez (kart dönem kapsamlı).</summary>
    [Fact]
    public async Task OpenReceivable_IgnoresSalesOutsideThePeriod()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Geçmiş Satış", 5_000m, 0m);
            account.SetSaleInfo(DateTime.UtcNow.AddMonths(-6), null);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).GetSummaryAsync(seed.TenantId, ThisMonth());
            Assert.True(result.IsSuccess);
            Assert.Equal(0m, result.Value!.Metrics.Single(m => m.Key == "openReceivable").Value);
            Assert.Equal(0m, result.Value.Metrics.Single(m => m.Key == "sales").Value);
        }
    }
}

using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// AÇILIŞTAKİ PEŞİNAT TAŞIMA İŞİ MÜKERRER TAHSİLAT ÜRETMEZ.
///
/// <para>
/// CANLI OLAY: sürüm aktive edildikten sonra açılıştaki <c>BackfillDepositPaymentsAsync</c>
/// tek bir tenantta üç peşinatlı caride 24.000 TL mükerrer tahsilat yazdı (35 kayıt/127.730 TL →
/// 38 kayıt/151.730 TL) ve sürüm geri alınmak zorunda kaldı.
/// </para>
/// <para>
/// KÖK NEDEN: kapsam ölçütü "İŞARET" arıyordu — deterministik Id (<c>payment.Id == account.Id</c>)
/// ya da "Peşinat" referansı. ADİSYONDAN doğan satış bu işaretlerin İKİSİNİ DE taşımaz: fişin
/// ödeme kalemleri normal <c>RegisterPaymentAsync</c> ile, RASTGELE Id ve <c>ADS-…</c>
/// referansıyla yazılır (yöntem kırılımı korunsun diye bilinçli). Taksitli satışta peşinat kolonu
/// da doldurulduğundan (12 Ağu, <c>ApproveCoreAsync</c>) bu cariler "kapsanmamış" görünüyor ve
/// açılış işi peşinatı İKİNCİ KEZ yazıyordu. Ölçüt artık işaret değil PARA: carinin canlı
/// tahsilat toplamı peşinatı karşılıyorsa satır eklenmez.
/// </para>
/// <para>
/// NEDEN GERÇEK MySQL: <c>BackfillDepositPaymentsAsync</c> InMemory sağlayıcıda ilk satırda
/// çıkar (<c>if (db.Database.IsInMemory()) return;</c>) — kusur yalnız gerçek sağlayıcıda görünür.
/// Bu yüzden mevcut 451 testin hiçbiri bu yolu geçmiyordu. Sunucu yoksa test atlanır.
/// </para>
/// </summary>
public sealed class DepositBackfillCoverageMySqlTests
{
    private static AdisyonService NewAdisyon(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid ServiceId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Pesinat QA", $"pesinat-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "PEŞİNATLI MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 20000m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, service.Id);
    }

    /// <summary>
    /// CANLI SENARYONUN BİREBİRİ: adisyondan taksitli + peşinatlı satış → açılış işi çalışır →
    /// tahsilat sayısı ve toplamı DEĞİŞMEZ. Kusurlu ölçütte burada ikinci bir 10.000 TL doğuyordu.
    /// </summary>
    [MySqlFact]
    public async Task Backfill_AdisyonOriginatedDeposit_DoesNotCreateDuplicatePayment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // 20.000 satış · 10.000 peşinat · kalan 12 taksit (kullanıcının anlattığı senaryo).
        Guid adisyonId;
        await using (var db = database.NewContext())
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceId, "Cilt Bakımı", 1, 20000m, null, false));
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Peşinat", 1, 10000m, null, false, "cash"));
            adisyon.SetInstallmentPlan(12, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var db = database.NewContext())
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        // ÖN KOŞUL: kurgu gerçekten kusurlu yolu geçiyor mu? Peşinat kolonu dolu OLMALI ve
        // tahsilat satırı İŞARETLERİN HİÇBİRİNİ taşımamalı — aksi hâlde test boşuna yeşil yanar.
        Guid accountId;
        await using (var db = database.NewContext())
        {
            var account = await db.CustomerAccounts.IgnoreQueryFilters()
                .Include(a => a.Payments)
                .SingleAsync(a => a.CustomerId == seed.CustomerId);
            accountId = account.Id;
            Assert.Equal(10000m, account.DepositAmount);
            var payment = Assert.Single(account.Payments);
            Assert.NotEqual(account.Id, payment.Id);                                  // deterministik Id YOK
            Assert.NotEqual(CustomerAccount.DepositPaymentReference, payment.Reference); // "Peşinat" referansı YOK
            Assert.Equal(adisyonId, payment.SourceAdisyonId);
        }

        var before = await PaymentTotalsAsync(database, accountId);
        Assert.Equal((1, 10000m), before);

        // Açılış işi — canlıda mükerrer tahsilatı üreten adım.
        await using (var provider = database.NewServiceProvider())
            await DatabaseBootstrap.BackfillDepositPaymentsAsync(provider);

        Assert.Equal(before, await PaymentTotalsAsync(database, accountId));

        // İKİNCİ AÇILIŞ da bir şey değiştirmemeli (iş idempotent kalmalı).
        await using (var provider = database.NewServiceProvider())
            await DatabaseBootstrap.BackfillDepositPaymentsAsync(provider);

        Assert.Equal(before, await PaymentTotalsAsync(database, accountId));
    }

    /// <summary>
    /// İŞ HÂLÂ YÜK TAŞIYOR: karşılığı defterde OLMAYAN eski peşinat taşınmaya devam eder.
    /// Düzeltme "hiç ekleme" değil, "şüphede ekleme" — bu test onu ayırır.
    /// </summary>
    [MySqlFact]
    public async Task Backfill_LegacyDepositWithoutAnyPayment_IsStillMaterialised()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // Eski kayıt: peşinat kolonu dolu ama KARŞILIĞINDA hiç tahsilat satırı yok.
        Guid accountId;
        await using (var db = database.NewContext())
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Eski satış", 20000m, 10000m);
            account.RebuildInstallments(12, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)));
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            accountId = account.Id;
        }

        Assert.Equal((0, 0m), await PaymentTotalsAsync(database, accountId));

        await using (var provider = database.NewServiceProvider())
            await DatabaseBootstrap.BackfillDepositPaymentsAsync(provider);

        // Peşinat gerçek tahsilat hareketine taşındı — kasa defteri artık parayı görüyor.
        Assert.Equal((1, 10000m), await PaymentTotalsAsync(database, accountId));

        // Ve ikinci açılışta tekrar yazılmaz.
        await using (var provider = database.NewServiceProvider())
            await DatabaseBootstrap.BackfillDepositPaymentsAsync(provider);

        Assert.Equal((1, 10000m), await PaymentTotalsAsync(database, accountId));
    }

    /// <summary>Carinin CANLI tahsilat adedi ve toplamı (silinmiş satır sayılmaz).</summary>
    private static async Task<(int Count, decimal Total)> PaymentTotalsAsync(MySqlTestDatabase database, Guid accountId)
    {
        await using var db = database.NewContext();
        var rows = await db.AccountPayments.IgnoreQueryFilters()
            .Where(p => !p.IsDeleted && p.CustomerAccountId == accountId)
            .Select(p => p.Amount)
            .ToListAsync();
        return (rows.Count, rows.Sum());
    }
}

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

    /// <summary>
    /// KUSUR SINIFI: PEŞİN SATIŞ "BEKLEYEN TAHSİLAT" ORANININ TABANINA GİRMİYORDU.
    ///
    /// <para>
    /// <see cref="AccountReportDto.TotalReceivable"/> ve <see cref="AccountReportDto.TotalCollected"/>
    /// TAKSİT PLANINI ölçer. Taksitsiz (peşin) satış hiç taksit satırı üretmediği için parası
    /// dağıtıma girmez: pano kartı oranı yalnız taksitli satışlar üzerinden kuruyor, kurumun
    /// peşin cirosu tabandan düşüyordu. Sonuç: gerçekte borcun payı küçükken kart büyük yüzde
    /// gösteriyordu (canlı veride %19'a karşı gerçek %4,7).
    /// </para>
    /// <para>
    /// <see cref="AccountReportDto.OpenReceivable"/> / <see cref="AccountReportDto.TotalPaid"/>
    /// carinin kendi kuralından gelir ve Ön Muhasebe'deki "Toplam açık alacak" ile aynı tabandır.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Rapor_PesinSatisiTahsilatTabaninaKatar()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        // 1) Taksitli satış: 30.000 · 10.000 peşinat · 5 × 4.000 → 20.000 borç.
        await CreateSaleAsync(options, seed);

        // 2) PEŞİN satış: 10.000, taksit yok, tamamı ayrı bir tahsilat satırıyla alındı.
        await using (var db = NewDb(options))
        {
            var service = NewService(db);
            var pesin = await service.CreateAsync(seed.TenantId, new CreateCustomerAccountRequest(
                seed.BranchId, seed.CustomerId, null, "Cilt Bakımı (peşin)",
                TotalAmount: 10000m, DepositAmount: 0m, InstallmentCount: 0,
                FirstDueDate: DateOnly.FromDateTime(DateTime.UtcNow), Notes: null));
            Assert.True(pesin.IsSuccess, pesin.IsFailure ? pesin.Error.Message : null);

            var paid = await service.RegisterPaymentAsync(seed.TenantId, pesin.Value!.Id,
                new RegisterAccountPaymentRequest(10000m, "cash", null, DateTime.UtcNow));
            Assert.True(paid.IsSuccess, paid.IsFailure ? paid.Error.Message : null);
        }

        await using var verify = NewDb(options);
        var report = (await NewService(verify).GetReportAsync(seed.TenantId, months: 12)).Value!;

        // TAKSİT ekseni (Paket Raporu KPI'ları) değişmedi: yalnız planı ölçer.
        Assert.Equal(20000m, report.TotalReceivable);
        Assert.Equal(10000m, report.TotalCollected);   // sadece taksitli satışın peşinatı

        // SATIŞ ekseni (pano kartı): peşin satışın 10.000'i de tahsilata girer.
        Assert.Equal(20000m, report.OpenReceivable);
        Assert.Equal(20000m, report.TotalPaid);

        // Kartın oranı: borç / (borç + tahsilat). Peşin satış tabana girmeseydi %67 çıkardı.
        var rate = report.OpenReceivable / (report.OpenReceivable + report.TotalPaid) * 100m;
        Assert.Equal(50m, Math.Round(rate));
    }

    /// <summary>
    /// GEÇMİŞ SATIŞTA PEŞİNAT: plan "toplam − peşinat"ı böler ve peşinat SATIŞ TARİHİYLE
    /// gerçek bir tahsilat satırı olur.
    ///
    /// <para>
    /// Alan eklenmeden önce geçmiş satışta peşinat girilemiyordu: taksitler toplamın tamamını
    /// bölüyor, satış günü alınan kapora evrakta hiç görünmüyordu. Kural canlı satışla AYNI
    /// olmalı, yoksa aynı satış "geçmişe girildi" diye farklı bir taksit planı üretirdi.
    /// </para>
    /// </summary>
    [Fact]
    public async Task GecmisSatis_Pesinati_PlandanDuser()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var soldAt = DateTime.UtcNow.AddYears(-1);

        Guid accountId;
        await using (var db = NewDb(options))
        {
            var created = await NewService(db).CreateHistoricalAsync(seed.TenantId, new CreateHistoricalSaleRequest(
                CustomerId: seed.CustomerId,
                Name: "Geçmiş Lazer Paketi",
                SoldAtUtc: soldAt,
                TotalAmount: 30000m,
                PaidAmount: 0m,
                BranchId: seed.BranchId,
                InstallmentCount: 5,
                FirstDueDate: DateOnly.FromDateTime(soldAt.AddMonths(1)),
                PaidInstallmentCount: 2,     // ilk iki taksit ödenmiş
                PaymentMethod: "cash",
                DepositAmount: 10000m));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            accountId = created.Value!.Id;
        }

        await using var verify = NewDb(options);
        var account = await verify.CustomerAccounts
            .Include(a => a.Installments).Include(a => a.Payments)
            .SingleAsync(a => a.Id == accountId);

        // Plan KALANI böler: (30.000 − 10.000) / 5 = 4.000.
        Assert.Equal(10000m, account.DepositAmount);
        Assert.Equal(5, account.Installments.Count);
        Assert.All(account.Installments, i => Assert.Equal(4000m, i.Amount));

        // Peşinat satış tarihiyle tahsilata döner; ödenmiş iki taksit kendi vadesiyle yazılır.
        var deposit = account.Payments.Single(p => p.Id == account.Id);
        Assert.Equal(10000m, deposit.Amount);
        Assert.Equal(soldAt.Date, deposit.OccurredAtUtc.Date);
        Assert.Equal(18000m, account.PaidAmount);            // 10.000 peşinat + 2 × 4.000
        Assert.Equal(12000m, account.RemainingAmount);

        // Peşinat taksitleri ÇİFT kapatmaz: dağıtımda yalnız ödenen iki taksit kapanmış olmalı.
        var allocation = account.AllocatePayments();
        var closed = account.Installments.Count(i => allocation[i.Id] >= i.Amount);
        Assert.Equal(2, closed);
    }

    /// <summary>
    /// PEŞİNATLI GEÇMİŞ SATIŞ İPTAL → GERİ ALMA turunu SAĞLAM atlatır.
    ///
    /// <para>
    /// Bu değişikliğe kadar yeni akışlı geçmiş satışın <c>DepositAmount</c>'ı HER ZAMAN 0'dı;
    /// artık dolu olabiliyor. Snapshot şema paritesi bu projede iki kez ısırdı: yedekte taşınmayan
    /// bir kolon geri almada sessizce sıfırlanır ve plan bu kez TOPLAMI böler (peşinat hatasının
    /// aynısı, bu sefer arşivden dönerken). Kapı burada.
    /// </para>
    /// </summary>
    [Fact]
    public async Task GecmisSatis_PesinatiIptalGeriAlmadaKorunur()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var soldAt = DateTime.UtcNow.AddYears(-1);

        Guid accountId;
        await using (var db = NewDb(options))
        {
            var created = await NewService(db).CreateHistoricalAsync(seed.TenantId, new CreateHistoricalSaleRequest(
                CustomerId: seed.CustomerId,
                Name: "Geçmiş Lazer Paketi",
                SoldAtUtc: soldAt,
                TotalAmount: 30000m,
                PaidAmount: 0m,
                BranchId: seed.BranchId,
                InstallmentCount: 5,
                FirstDueDate: DateOnly.FromDateTime(soldAt.AddMonths(1)),
                PaidInstallmentCount: 0,
                PaymentMethod: "cash",
                DepositAmount: 10000m));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            accountId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var cancelled = await NewService(db).CancelSaleAsync(seed.TenantId, accountId, new CancelSaleRequest("Yanlış giriş"));
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var restored = await NewService(db).RestoreSaleAsync(seed.TenantId, accountId);
            Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Message : null);
        }

        await using var verify = NewDb(options);
        var account = await verify.CustomerAccounts
            .Include(a => a.Installments).Include(a => a.Payments)
            .SingleAsync(a => a.Id == accountId);

        // Peşinat ve plan tabanı aynen dönmeli — plan 30.000'i DEĞİL 20.000'i bölmeye devam eder.
        Assert.Equal(10000m, account.DepositAmount);
        Assert.Equal(20000m, account.Installments.Sum(i => i.Amount));
        Assert.All(account.Installments, i => Assert.Equal(4000m, i.Amount));
        Assert.Equal(10000m, account.PaidAmount);       // peşinat tahsilatı da geri geldi
        Assert.Equal(20000m, account.RemainingAmount);
    }

    /// <summary>
    /// PEŞİNAT SATIRI ESKİ (RASTGELE) Id İLE YAZILMIŞ OLSA DA TAHSİLATA GİRER.
    ///
    /// <para>
    /// Deterministik anahtar (peşinat tahsilatının Id'si = carinin Id'si) mükerrer koruması için
    /// SONRADAN geldi; ondan önce çalışmış taşıma işi satırı rastgele Id ile yazdı. Rapor yalnız
    /// Id eşitliğine baktığı sürece o carilerde peşinat dağıtım havuzundan düşülüyor ama
    /// "tahsil edildi" toplamına geri eklenmiyordu — kurum peşinatı kadar eksik tahsilat görüyordu.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Rapor_EskiIdliPesinatiDaTahsilatSayar()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await CreateSaleAsync(options, seed);

        // Taşıma öncesi hâli taklit et: peşinat satırının Id'sini rastgeleye çevir.
        await using (var db = NewDb(options))
        {
            var account = await db.CustomerAccounts.Include(a => a.Payments).SingleAsync(a => a.Id == accountId);
            var deposit = Assert.Single(account.Payments);
            Assert.Equal(accountId, deposit.Id);   // bugünkü kural
            var occurred = deposit.OccurredAtUtc;
            db.AccountPayments.Remove(deposit);
            await db.SaveChangesAsync();

            // Taşımanın eski hâli: rastgele Id + "Peşinat" referansı (tek işaret buydu).
            db.AccountPayments.Add(new AccountPayment(
                accountId, 10000m, "cash", CustomerAccount.DepositPaymentReference, occurred));
            await db.SaveChangesAsync();
        }

        await using var verify = NewDb(options);
        var report = (await NewService(verify).GetReportAsync(seed.TenantId, months: 12)).Value!;

        Assert.Equal(10000m, report.TotalCollected);   // peşinat kayıp değil
        Assert.Equal(10000m, report.TotalPaid);
        Assert.Equal(20000m, report.OpenReceivable);
    }
}

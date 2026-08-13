using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// SATIŞ ↔ CARİ BÜTÜNLÜĞÜ — deploy denetiminde bulunan üç açığın regresyon koruması.
///
/// <list type="number">
/// <item>İstemcinin verdiği <c>CustomerAccountId</c> doğrulanmıyordu: başka müşterinin carisi
/// hedef gösterilerek borç yanlış kişiye yazılabiliyor (BOLA), ayrıca satışa mevcut bir cari
/// iliştirilerek "her satış kendi kartını açar" kuralı baypas edilebiliyordu.</item>
/// <item>Bir randevu tamamlanınca müşterinin TÜM bekleyen satışları onaylanır; tahsilat hedefi
/// "ilk onaylanan" seçildiği için B randevusunun parası A satışına yazılabiliyordu.</item>
/// <item>Arayüz belirli bir paket satırı seçtiriyor ama seçim sunucuya taşınmıyordu: aynı hizmeti
/// içeren iki paketten EN ESKİSİ tüketiliyordu.</item>
/// <item>"Her satış kendi cari kartını açar" kuralı, fişe AYNI MÜŞTERİNİN mevcut carisi bağlanarak
/// baypas edilebiliyordu (sahiplik kontrolünü geçer): onay yeni kart açmayı atlıyor, satışın borcu
/// eski kartın toplamına ekleniyordu. Onaylanmış fişin cari bağı da sonradan değiştirilebiliyordu —
/// tahsilat eski kartta kalırken borç yenisine geçiyor, silme/iptal parayı yanlış kartta arıyordu.</item>
/// </list>
/// </summary>
public sealed class SaleAccountIntegrityTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AdisyonService NewAdisyon(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private static AppointmentService NewAppointments(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, NewAdisyon(db), null!);
    }

    private sealed record Seed(
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid OtherCustomerId,
        Guid StaffId, Guid ServiceA, Guid ServiceB, Guid OtherAccountId,
        // Müşterinin KENDİ geçmiş satış kartı (4 taksitli) — baypas denemesinin hedefi.
        Guid OwnAccountId,
        // Müşterinin ikinci kartı — onay sonrası "başka kendi kartıma" rebind denemesi için.
        Guid SecondOwnAccountId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Cari QA", $"cari-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "ANA MÜŞTERİ", "0555 100 20 30", null);
        var other = new Customer(tenant.Id, branch.Id, "BAŞKA MÜŞTERİ", "0555 900 80 70", null);
        db.Customers.AddRange(customer, other);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        db.StaffMembers.Add(staff);
        var serviceA = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m, "Cilt");
        var serviceB = new ServiceDefinition(tenant.Id, branch.Id, "Lazer Epilasyon", 45, 800m, "Epilasyon");
        db.ServiceDefinitions.AddRange(serviceA, serviceB);
        await db.SaveChangesAsync();

        // BAŞKA müşterinin carisi — saldırı hedefi.
        var otherAccount = new CustomerAccount(tenant.Id, branch.Id, other.Id, null, "Başkasının satışı", 5000m, 0m);
        db.CustomerAccounts.Add(otherAccount);
        // Müşterinin KENDİ geçmiş kartı: taksitli, ödenmemiş. Yeni satış buraya YAZILMAMALI.
        var ownAccount = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Önceki satış", 5000m, 0m);
        ownAccount.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(10)));
        db.CustomerAccounts.Add(ownAccount);
        var secondOwn = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "İkinci kart", 1000m, 0m);
        db.CustomerAccounts.Add(secondOwn);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, other.Id, staff.Id, serviceA.Id, serviceB.Id,
            otherAccount.Id, ownAccount.Id, secondOwn.Id);
    }

    // ── 1) BOLA: başka müşterinin carisi hedef gösterilemez ────────────────────────────────

    [Fact]
    public async Task CreateAdisyon_WithForeignCustomerAccount_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewAdisyon(db).CreateAsync(seed.TenantId,
            new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, seed.OtherAccountId, null));

        Assert.True(result.IsFailure, "Başka müşterinin carisi adisyona bağlanabildi (BOLA).");
        Assert.Equal("Validation", result.Error.Code);
        Assert.Empty(await db.Adisyonlar.ToListAsync());
    }

    [Fact]
    public async Task UpdateAdisyon_WithForeignCustomerAccount_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var created = await NewAdisyon(db).CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, null, null));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewAdisyon(db).UpdateAsync(seed.TenantId, adisyonId,
                new UpdateAdisyonRequest(seed.OtherAccountId, null));
            Assert.True(result.IsFailure, "Başka müşterinin carisi adisyona sonradan bağlanabildi.");
            Assert.Equal("Validation", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var adisyon = await check.Adisyonlar.SingleAsync(a => a.Id == adisyonId);
            Assert.Null(adisyon.CustomerAccountId);
        }
    }

    // ── 3) Seçilen paketin seansı sunucuda dikkate alınır ──────────────────────────────────

    /// <summary>Müşterinin AYNI hizmeti içeren iki paketi var; kullanıcı YENİ olanı seçiyor.</summary>
    [Fact]
    public async Task CreateAsync_WithChosenSession_BindsThatSessionNotTheOldest()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid oldSessionId, newSessionId;

        await using (var db = NewDb(options))
        {
            var acc = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Paketler", 2000m, 0m);
            db.CustomerAccounts.Add(acc);
            await db.SaveChangesAsync();

            var older = new CustomerPackageSession(seed.TenantId, seed.CustomerId, acc.Id, Guid.NewGuid(), seed.ServiceA, 3);
            db.CustomerPackageSessions.Add(older);
            await db.SaveChangesAsync();          // CreatedAtUtc farkı için ayrı kaydedilir
            var newer = new CustomerPackageSession(seed.TenantId, seed.CustomerId, acc.Id, Guid.NewGuid(), seed.ServiceA, 5);
            db.CustomerPackageSessions.Add(newer);
            await db.SaveChangesAsync();

            oldSessionId = older.Id;
            newSessionId = newer.Id;
        }

        await using (var db = NewDb(options))
        {
            var request = new CreateAppointmentRequest(
                seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceA,
                DateTime.UtcNow.AddHours(2), DateTime.UtcNow.AddHours(3), 0m, null,
                SourceCustomerPackageSessionId: newSessionId);

            var result = await NewAppointments(db).CreateAsync(seed.TenantId, request);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);

            var appointment = await db.Appointments.SingleAsync();
            Assert.Equal(newSessionId, appointment.SourceCustomerPackageSessionId);
            Assert.NotEqual(oldSessionId, appointment.SourceCustomerPackageSessionId);
        }
    }

    /// <summary>Seçilen seans BAŞKA müşteriye aitse randevu açılmaz (sessizce kaymaz).</summary>
    [Fact]
    public async Task CreateAsync_WithForeignSession_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid foreignSessionId;

        await using (var db = NewDb(options))
        {
            // Başka müşterinin aynı hizmete ait seansı.
            var foreign = new CustomerPackageSession(
                seed.TenantId, seed.OtherCustomerId, seed.OtherAccountId, Guid.NewGuid(), seed.ServiceA, 5);
            db.CustomerPackageSessions.Add(foreign);
            // Ana müşterinin de kendi hakkı olsun ki ret SAHİPLİKTEN kaynaklansın.
            var acc = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Kendi paketi", 500m, 0m);
            db.CustomerAccounts.Add(acc);
            await db.SaveChangesAsync();
            db.CustomerPackageSessions.Add(new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, acc.Id, Guid.NewGuid(), seed.ServiceA, 2));
            await db.SaveChangesAsync();
            foreignSessionId = foreign.Id;
        }

        await using (var db = NewDb(options))
        {
            var request = new CreateAppointmentRequest(
                seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceA,
                DateTime.UtcNow.AddHours(2), DateTime.UtcNow.AddHours(3), 0m, null,
                SourceCustomerPackageSessionId: foreignSessionId);

            var result = await NewAppointments(db).CreateAsync(seed.TenantId, request);
            Assert.True(result.IsFailure, "Başka müşterinin seansına randevu açılabildi.");
            Assert.Equal("Validation", result.Error.Code);
            Assert.Empty(await db.Appointments.ToListAsync());
        }
    }

    // ── 4) Kural "kendi carim" verilerek de baypas edilemez ────────────────────────────────

    /// <summary>
    /// Kartın taksit SATIR KİMLİKLERİ. <c>RebuildInstallments</c> planı silip yeniden kurduğu için
    /// kimlikler değişir: "eski kartın taksitleri hiç dokunulmadı" iddiası ancak böyle kanıtlanır
    /// (tutar toplamı yanıltıcıdır — borç eklenip geri alındığında da eski toplama döner).
    /// </summary>
    private static async Task<Guid[]> InstallmentIdsAsync(DbContextOptions<GuzellikDbContext> options, Guid accountId)
    {
        await using var db = NewDb(options);
        return await db.Installments
            .Where(i => i.CustomerAccountId == accountId)
            .OrderBy(i => i.DueDate).ThenBy(i => i.Id)
            .Select(i => i.Id)
            .ToArrayAsync();
    }

    /// <summary>Fişi doğrudan bir cariye bağlı olarak açar (düzeltmeden önceki eski kayıt hâli).</summary>
    private static async Task<Guid> SeedAccountBoundSaleAsync(
        DbContextOptions<GuzellikDbContext> options, Seed seed, Guid boundAccountId)
    {
        await using var db = NewDb(options);
        var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, boundAccountId, null);
        db.Adisyonlar.Add(adisyon);
        await db.SaveChangesAsync();
        db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceA, "Cilt Bakımı", 1, 1250m, null, false));
        db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Peşinat", 1, 500m, null, false, "cash"));
        await db.SaveChangesAsync();
        return adisyon.Id;
    }

    /// <summary>
    /// MÜŞTERİNİN KENDİ carisi bağlı olsa bile satış onayı YENİ kart açar: eski kartın toplamı ve
    /// taksit planı değişmez, tahsilat da satışın kendi kartına yazılır.
    /// </summary>
    [Fact]
    public async Task Approve_SaleOnAccountBoundAdisyon_OpensOwnAccount_AndLeavesExistingUntouched()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var adisyonId = await SeedAccountBoundSaleAsync(options, seed, seed.OwnAccountId);
        var planBefore = await InstallmentIdsAsync(options, seed.OwnAccountId);

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        Assert.Equal(planBefore, await InstallmentIdsAsync(options, seed.OwnAccountId)); // plan yeniden kurulmadı

        await using (var check = NewDb(options))
        {
            var accounts = await check.CustomerAccounts
                .Include(a => a.Installments)
                .Where(a => a.CustomerId == seed.CustomerId)
                .ToListAsync();
            Assert.Equal(3, accounts.Count); // iki eski kart + satışın KENDİ kartı

            var existing = accounts.Single(a => a.Id == seed.OwnAccountId);
            Assert.Equal(5000m, existing.TotalAmount);                     // eski kart DOKUNULMAZ
            Assert.Equal(4, existing.Installments.Count);
            Assert.Equal(5000m, existing.Installments.Sum(i => i.Amount)); // plan da aynı kalır

            var sale = accounts.Single(a => a.Id != seed.OwnAccountId && a.Id != seed.SecondOwnAccountId);
            Assert.Equal(1250m, sale.TotalAmount);
            Assert.Equal("Cilt Bakımı", sale.Name);

            // Fişin bağı satışın kendi kartına taşınır — silme/iptal ters kaydı buradan arar.
            var adisyon = await check.Adisyonlar.SingleAsync(a => a.Id == adisyonId);
            Assert.Equal(sale.Id, adisyon.CustomerAccountId);

            // Tahsilat da satışın kartına yazılır; eski kartta hiç ödeme görünmez.
            var payment = Assert.Single(await check.AccountPayments.ToListAsync());
            Assert.Equal(sale.Id, payment.CustomerAccountId);
            Assert.Equal(500m, payment.Amount);
            Assert.Equal(adisyonId, payment.SourceAdisyonId);
        }
    }

    /// <summary>
    /// TAKSİTLİ SATIŞTA PEŞİNAT PLANDAN DÜŞÜLÜR — kullanıcının anlattığı senaryo birebir.
    ///
    /// <para>
    /// 20.000 ₺ satış · 10.000 ₺ peşin · kalan 12 taksit. Doğru davranış: plan finanse edilen
    /// tutarı böler (10.000 / 12) ve peşinat HİÇBİR taksiti kapatmaz.
    /// </para>
    /// <para>
    /// KUSUR (bu testin koruduğu): <c>ApproveCoreAsync</c> cariyi <c>depositAmount: 0m</c> ile
    /// açıyordu. Plan 20.000'i 12'ye bölüyor (1.666,67/ay), sonra 10.000'lik peşinat
    /// <c>AllocatePayments</c> ile vade sırasıyla dağıtılıp ilk ALTI taksiti "ödendi" gösteriyordu.
    /// Toplam borç doğruydu, ama plan ve taksit durumları saçmalıyordu.
    /// </para>
    /// <para>
    /// Aynı kural doğrudan cari yolunda zaten sabitti (<c>DepositInstallmentScenarioTests</c>);
    /// kırık olan ADİSYON yoluydu ve hiçbir test onu geçmiyordu.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Approve_InstallmentSaleWithDownPayment_SplitsFinancedAmount_AndLeavesInstallmentsUnpaid()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceA, "Cilt Bakımı", 1, 20000m, null, false));
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Peşinat", 1, 10000m, null, false, "cash"));
            adisyon.SetInstallmentPlan(12, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var sale = await check.CustomerAccounts
                .Include(a => a.Installments).Include(a => a.Payments)
                .SingleAsync(a => a.Id == check.Adisyonlar.Single(x => x.Id == adisyonId).CustomerAccountId);

            Assert.Equal(20000m, sale.TotalAmount);
            Assert.Equal(10000m, sale.DepositAmount);   // peşinat PLAN alanına yazıldı

            // Plan FİNANSE EDİLEN tutarı böler: 10.000 / 12 (kuruş farkı son taksitte).
            Assert.Equal(12, sale.Installments.Count);
            Assert.Equal(10000m, sale.Installments.Sum(i => i.Amount));
            Assert.All(sale.Installments, i => Assert.InRange(i.Amount, 833m, 834m));

            // Peşinat gerçek bir tahsilattır (kasa onu görür) ama HİÇBİR taksiti kapatmaz.
            Assert.Equal(10000m, sale.Payments.Sum(p => p.Amount));
            var allocation = sale.AllocatePayments();
            Assert.All(sale.Installments, i => Assert.Equal(0m, allocation[i.Id]));

            // Toplam borç ve tahsilat DEĞİŞMEDİ — düzelen yalnız planın tabanı.
            Assert.Equal(10000m, sale.RemainingAmount);
        }
    }

    /// <summary>
    /// PEŞİN (taksitsiz) satışta peşinat alanı YAZILMAZ — davranış değişmemeli.
    /// Plan yoksa <c>DepositAmount</c> hiçbir şey ifade etmez; 0 kalması eski kayıtlarla ve
    /// ekstre/rapor formülleriyle tutarlılığı korur.
    /// </summary>
    [Fact]
    public async Task Approve_CashSaleWithoutPlan_LeavesDepositZero()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceA, "Cilt Bakımı", 1, 1250m, null, false));
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Tahsilat", 1, 500m, null, false, "cash"));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var db = NewDb(options))
            Assert.True((await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId)).IsSuccess);

        await using (var check = NewDb(options))
        {
            // Payments ZORUNLU: `PaidAmount` (dolayısıyla `RemainingAmount`) ödeme satırlarından
            // türetilir — include edilmezse borç ödenmemiş görünür.
            var sale = await check.CustomerAccounts.Include(a => a.Payments)
                .SingleAsync(a => a.Id == check.Adisyonlar.Single(x => x.Id == adisyonId).CustomerAccountId);
            Assert.Equal(0m, sale.DepositAmount);
            Assert.Equal(1250m, sale.TotalAmount);
            Assert.Equal(750m, sale.RemainingAmount);
            Assert.Empty(sale.Installments);
        }
    }

    /// <summary>
    /// HAYALET CARİ BORCU — peşinatlı satış silinince kaynaksız bakiye KALMAZ.
    ///
    /// <para>
    /// KUSUR (bu testin koruduğu): silme yolundaki "yalnız bu fişin carisi mi" kapısı
    /// <c>DepositAmount == 0m</c> arıyordu. Peşinatlı satış bu koşulu hiçbir zaman geçemediği
    /// için kart kapatılmıyor, paylaşılan cari dalına düşüyordu; oradaki
    /// <c>Math.Max(DepositAmount, Total − charge)</c> tabanı da toplamı peşinat kadar AYAKTA
    /// tutuyordu. Sonuç: 20.000 ₺ satış + 10.000 ₺ peşinat silindiğinde tahsilat satırları
    /// kalkıyor ama müşteride kaynağı, tahsilatı ve taksit planı olmayan 10.000 ₺ borç kalıyordu.
    /// </para>
    /// <para>
    /// Tahsilatlı fiş defter guard'ı yüzünden yalnız <c>force: true</c> ile silinir; peşinat da
    /// bir tahsilat olduğundan kusurlu koda ANCAK bu bayrakla ulaşılır — force'suz bir kurgu
    /// 409 alır ve hatayı "zaten düzelmiş" gibi gösterir.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Delete_InstallmentSaleWithDownPayment_ClosesAccount_LeavesNoPhantomDebt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceA, "Cilt Bakımı", 1, 20000m, null, false));
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Peşinat", 1, 10000m, null, false, "cash"));
            adisyon.SetInstallmentPlan(12, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        Guid saleAccountId;
        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            saleAccountId = (await db.Adisyonlar.SingleAsync(a => a.Id == adisyonId)).CustomerAccountId!.Value;
        }

        await using (var db = NewDb(options))
        {
            var deleted = await NewAdisyon(db).DeleteAsync(seed.TenantId, adisyonId, force: true);
            Assert.True(deleted.IsSuccess, deleted.IsFailure ? deleted.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            // Kart CANLI listeden düştü — hayalet borç ekranda görünmez.
            // (Silme yumuşaktır: satır durur, `IsDeleted` ile süzülür — bu yüzden varlık
            //  kontrolü SÜZGEÇLİ sorguyla yapılır, `IgnoreQueryFilters` ile değil.)
            Assert.Null(await check.CustomerAccounts.FirstOrDefaultAsync(a => a.Id == saleAccountId));
            Assert.True((await check.CustomerAccounts.IgnoreQueryFilters()
                .SingleAsync(a => a.Id == saleAccountId)).IsDeleted);

            // Peşinat tahsilatı da canlı defterden düştü.
            Assert.Empty(await check.AccountPayments.ToListAsync());

            // Müşterinin CANLI açık borcu satış öncesine döndü: yalnız seed kartları (5.000 + 1.000).
            // Kusurlu kodda burada 10.000 ₺'lik kaynaksız bir kart daha duruyordu.
            var live = await check.CustomerAccounts.Include(a => a.Payments)
                .Where(a => a.CustomerId == seed.CustomerId).ToListAsync();
            Assert.Equal(2, live.Count);
            Assert.Equal(6000m, live.Sum(a => a.RemainingAmount));

            var existing = live.Single(a => a.Id == seed.OwnAccountId);
            Assert.Equal(5000m, existing.TotalAmount);
        }
    }

    /// <summary>
    /// KAPI HÂLÂ YÜK TAŞIYOR: peşinatı BAŞKA bir kayıttan gelen paylaşılan cari silinmez.
    ///
    /// <para>
    /// Doğrudan açılan cari peşinatı her zaman gerçek bir tahsilat satırına çevirir; o satır bu
    /// fişe ait olmadığı için kart korunur. Fişin borcu düşer, peşinat KALAN tahsilatla desteklendiği
    /// sürece yerinde kalır ve dağıtım havuzu (Σödeme − peşinat − iade) eksiye düşmez.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Delete_AdisyonOnDirectAccountWithDeposit_KeepsAccountAndDepositBacking()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid directAccountId;

        // Doğrudan açılmış taksitli cari: 6.000 toplam · 2.000 peşinat (gerçek tahsilat satırıyla).
        await using (var db = NewDb(options))
        {
            var direct = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Elle açılan cari", 6000m, 2000m);
            direct.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)));
            direct.RegisterDepositPayment("cash", DateTime.UtcNow);
            db.CustomerAccounts.Add(direct);
            await db.SaveChangesAsync();
            directAccountId = direct.Id;
        }

        // Bu cariye BAĞLI, satış kalemi olmayan tahsilat fişi (1.000 ₺).
        Guid adisyonId;
        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, directAccountId, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Tahsilat", 1, 1000m, null, false, "cash"));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var db = NewDb(options))
            Assert.True((await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId)).IsSuccess);

        await using (var db = NewDb(options))
        {
            var deleted = await NewAdisyon(db).DeleteAsync(seed.TenantId, adisyonId, force: true);
            Assert.True(deleted.IsSuccess, deleted.IsFailure ? deleted.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts
                .Include(a => a.Installments).Include(a => a.Payments)
                .SingleAsync(a => a.Id == directAccountId);

            Assert.Equal(6000m, account.TotalAmount);   // fişin borcu yoktu, toplam değişmez
            Assert.Equal(2000m, account.DepositAmount); // peşinat kendi tahsilatıyla ayakta
            Assert.Equal(2000m, account.Payments.Sum(p => p.Amount)); // yalnız fişin 1.000'i silindi

            // DAĞITIM HAVUZU EKSİYE DÜŞMEZ: peşinat, kalan tahsilatın üstüne çıkmadı.
            Assert.All(account.AllocatePayments().Values, v => Assert.True(v >= 0m));
        }
    }

    /// <summary>
    /// SİLME DOĞRU KARTI BULUR: satış kendi kartını açtığı için ters kayıt tahsilatı orada bulur,
    /// kart kapanır; müşterinin eski kartının toplamı ve taksitleri hiç değişmez.
    /// </summary>
    [Fact]
    public async Task Delete_AfterSaleOnAccountBoundAdisyon_ReversesFromSaleAccountOnly()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var adisyonId = await SeedAccountBoundSaleAsync(options, seed, seed.OwnAccountId);
        var planBefore = await InstallmentIdsAsync(options, seed.OwnAccountId);

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            // Tahsilatlı fiş yalnız yönetici onayıyla (force) silinir — defter guard'ı.
            var deleted = await NewAdisyon(db).DeleteAsync(seed.TenantId, adisyonId, force: true);
            Assert.True(deleted.IsSuccess, deleted.IsFailure ? deleted.Error.Message : null);
        }

        // Eski kartın planı satış boyunca hiç ELLENMEDİ: borç oraya yazılıp geri alınsaydı satır
        // kimlikleri değişirdi (toplam yine 5.000'e dönerdi — kimlik karşılaştırması bunu yakalar).
        Assert.Equal(planBefore, await InstallmentIdsAsync(options, seed.OwnAccountId));

        await using (var check = NewDb(options))
        {
            var accounts = await check.CustomerAccounts
                .Include(a => a.Installments)
                .Where(a => a.CustomerId == seed.CustomerId)
                .ToListAsync();
            Assert.Equal(2, accounts.Count); // satışın kartı kapandı, eski kartlar duruyor

            var existing = accounts.Single(a => a.Id == seed.OwnAccountId);
            Assert.Equal(5000m, existing.TotalAmount);
            Assert.Equal(4, existing.Installments.Count);
            Assert.Equal(5000m, existing.Installments.Sum(i => i.Amount));

            Assert.Empty(await check.AccountPayments.ToListAsync()); // tahsilat doğru kartta bulundu
            Assert.Empty(await check.Adisyonlar.ToListAsync());
        }
    }

    /// <summary>Cariye bağlı fişe SATIŞ kalemi eklenemez; tahsilat kalemi (fişin asıl amacı) eklenebilir.</summary>
    [Fact]
    public async Task AddItem_SaleItemOntoAccountBoundAdisyon_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var created = await NewAdisyon(db).CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, seed.OwnAccountId, "Cari tahsilatı"));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var service = NewAdisyon(db);
            var sale = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Service, seed.ServiceA, "Cilt Bakımı", 1, 1250m, null, false));
            Assert.True(sale.IsFailure, "Cariye bağlı fişe satış kalemi eklenebildi.");
            Assert.Equal("Validation", sale.Error.Code);

            var payment = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Payment, null, "Tahsilat", 1, 500m, null, false, "cash"));
            Assert.True(payment.IsSuccess, payment.IsFailure ? payment.Error.Message : null);
        }
    }

    /// <summary>Ters yön: önce satış kalemi eklenip SONRA mevcut cari bağlanarak da baypas edilemez.</summary>
    [Fact]
    public async Task UpdateAdisyon_BindingOwnAccountToSaleAdisyon_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var service = NewAdisyon(db);
            var created = await service.CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, null, null, ForceNew: true));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;

            var item = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Service, seed.ServiceA, "Cilt Bakımı", 1, 1250m, null, false));
            Assert.True(item.IsSuccess, item.IsFailure ? item.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var result = await NewAdisyon(db).UpdateAsync(seed.TenantId, adisyonId,
                new UpdateAdisyonRequest(seed.OwnAccountId, null));
            Assert.True(result.IsFailure, "Satış fişi mevcut cariye bağlanabildi.");
            Assert.Equal("Validation", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var adisyon = await check.Adisyonlar.SingleAsync(a => a.Id == adisyonId);
            Assert.Null(adisyon.CustomerAccountId);
        }
    }

    // ── 5) Net tutarı SIFIR olan satış da kendi kartını açar ──────────────────────────────

    /// <summary>Ürün ekler ve satış fişini onaylar; müşterinin kartlarını döndürür.</summary>
    private static async Task<List<CustomerAccount>> ApproveProductSaleAsync(
        DbContextOptions<GuzellikDbContext> options, Seed seed, decimal salePrice, decimal discount)
    {
        Guid adisyonId;
        await using (var db = NewDb(options))
        {
            var product = new Product(seed.TenantId, seed.BranchId, "Bakım Şampuanı", ProductCategory.Other, "adet",
                cost: 40m, salePrice: salePrice, currentStock: 5m, minStockLevel: 0m);
            db.Products.Add(product);
            await db.SaveChangesAsync();

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(
                AdisyonItemType.Product, product.Id, "Bakım Şampuanı", 1, salePrice, null, false));
            if (discount > 0)
                db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Discount, null, "İndirim", 1, discount, null, false));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var approve = NewDb(options))
        {
            var approved = await NewAdisyon(approve).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        await using var check = NewDb(options);
        return await check.CustomerAccounts
            .Where(a => a.CustomerId == seed.CustomerId && a.Id != seed.OwnAccountId && a.Id != seed.SecondOwnAccountId)
            .ToListAsync();
    }

    /// <summary>
    /// BEDELSİZ ÜRÜN SATIŞI da kendi kartını açar. Kart açma kapısı ürün kalemini hiç saymıyordu:
    /// birim fiyat 0 iken stok düşüyor, fiş onaylanıyor, ama satışın cari kartı hiç oluşmuyordu.
    /// </summary>
    [Fact]
    public async Task Approve_ZeroPricedProductSale_StillOpensItsOwnAccount()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        var sale = Assert.Single(await ApproveProductSaleAsync(options, seed, salePrice: 0m, discount: 0m));
        Assert.Equal(0m, sale.TotalAmount);
        Assert.Equal("Bakım Şampuanı", sale.Name);
    }

    /// <summary>
    /// İNDİRİMLE NET TUTARI SIFIRLANAN satış da kendi kartını açar (kapı charge &gt; 0'a bakıyordu).
    /// </summary>
    [Fact]
    public async Task Approve_ProductSaleDiscountedToZero_StillOpensItsOwnAccount()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        var sale = Assert.Single(await ApproveProductSaleAsync(options, seed, salePrice: 500m, discount: 500m));
        Assert.Equal(0m, sale.TotalAmount);   // borç yok ama satış kartı VAR
        Assert.Equal("Bakım Şampuanı", sale.Name);
    }

    /// <summary>
    /// ONAY SONRASI REBIND YOK: fiş onaylandıktan sonra cari bağı aynı müşterinin başka kartına
    /// çevrilemez (para eski kartta kalıp borç yenisine geçerdi). Ret gerekçesi satış kuralı değil
    /// ONAY DURUMU olsun diye fişte satış değil EK KALEM var.
    /// </summary>
    [Fact]
    public async Task UpdateAdisyon_RebindingApprovedAdisyon_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId, boundAccountId;

        await using (var db = NewDb(options))
        {
            var service = NewAdisyon(db);
            var created = await service.CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, null, null, ForceNew: true));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;

            var item = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Extra, null, "Ek hizmet farkı", 1, 300m, null, false));
            Assert.True(item.IsSuccess, item.IsFailure ? item.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            boundAccountId = approved.Value!.CustomerAccountId!.Value;
        }

        // Hedef: müşterinin DİĞER kendi kartı (sahiplik kontrolünü geçer, kural yalnız duruma bakar).
        var otherOwnAccountId = boundAccountId == seed.OwnAccountId ? seed.SecondOwnAccountId : seed.OwnAccountId;

        await using (var db = NewDb(options))
        {
            var result = await NewAdisyon(db).UpdateAsync(seed.TenantId, adisyonId,
                new UpdateAdisyonRequest(otherOwnAccountId, "not"));
            Assert.True(result.IsFailure, "Onaylı adisyonun cari bağı değiştirilebildi.");
            Assert.Equal("Validation", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var adisyon = await check.Adisyonlar.SingleAsync(a => a.Id == adisyonId);
            Assert.Equal(boundAccountId, adisyon.CustomerAccountId);
        }
    }
}

using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// SATIŞ İPTALİ — GERÇEK VERİTABANI DAVRANIŞI.
///
/// <para>
/// InMemory testleri iş kurallarını doğrular ama sağlayıcıya bağlı üç şeyi doğrulayamaz:
/// gerçek transaction, satır kilidi (<c>FOR UPDATE</c>) ve cari silinince tahsilatların cascade
/// ile gitmesi. İptal muhasebesindeki en pahalı hatalar tam da buralardaydı — bu yüzden ayrı
/// bir MySQL/MariaDB test seti var. Sunucu yoksa testler atlanır (bkz. <see cref="MySqlFactAttribute"/>).
/// </para>
/// </summary>
public sealed class SaleCancellationMySqlTests
{
    private static CustomerAccountService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(Guid TenantId, Guid AccountId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database, decimal paid)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("MySQL QA", $"mysql-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "MySQL MÜŞTERİ", "0555 333 44 55", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 2000m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        if (paid > 0)
        {
            var ok = await NewService(db).RegisterPaymentAsync(
                tenant.Id, account.Id, new RegisterAccountPaymentRequest(paid, "cash", null, null));
            Assert.True(ok.IsSuccess);
        }

        return new Seed(tenant.Id, account.Id);
    }

    /// <summary>
    /// ASIL REGRESYON — gerçek cascade delete ile: cari silinince <c>account_payments</c> da gider.
    /// Tahsilat kalıcı deftere taşınmasaydı gelir sıfırlanır, yalnız iade gider kalır ve net kasa
    /// 700 yerine −500 çıkardı.
    /// </summary>
    [MySqlFact]
    public async Task CancelSale_KeepsNetCash_WithRealCascadeDelete()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, paid: 1200m);

        await using (var db = database.NewContext())
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("kısmi iade", RefundedAmount: 500m, RefundMethod: "cash"))).IsSuccess);

        await using (var db = database.NewContext())
        {
            // Cascade gerçekten çalıştı mı?
            Assert.Empty(await db.AccountPayments.IgnoreQueryFilters().ToListAsync());
            Assert.Empty(await db.CustomerAccounts.IgnoreQueryFilters().ToListAsync());

            var now = DateTime.UtcNow;
            var summary = await new CashFlowService(db).SummaryAsync(
                seed.TenantId, new CashFlowFilter(now.AddDays(-1), now.AddDays(1)));

            Assert.True(summary.IsSuccess);
            Assert.Equal(1200m, summary.Value!.TotalIncome);
            Assert.Equal(500m, summary.Value.TotalExpense);
            Assert.Equal(700m, summary.Value.NetAmount);
        }
    }

    /// <summary>
    /// Aynı satışı iki istek AYNI ANDA iptal ederse yalnız biri geçmeli; ikincisi nazikçe
    /// reddedilmeli. Çift arşiv kaydı ya da yarım kalmış silme oluşmamalı.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentCancel_ProducesExactlyOneArchive()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, paid: 400m);

        async Task<bool> CancelAsync()
        {
            await using var db = database.NewContext();
            var result = await NewService(db).CancelSaleAsync(
                seed.TenantId, seed.AccountId, new CancelSaleRequest("eşzamanlı"));
            return result.IsSuccess;
        }

        var results = await Task.WhenAll(CancelAsync(), CancelAsync());

        Assert.Equal(1, results.Count(x => x));
        await using var check = database.NewContext();
        Assert.Single(await check.CancelledSales.IgnoreQueryFilters().ToListAsync());
        // Tahsilat tam olarak BİR kez deftere yazılmalı (çift sayım = uydurma gelir).
        Assert.Single(await check.ArchivedSalePayments.IgnoreQueryFilters().Where(p => !p.IsDeleted).ToListAsync());
    }

    /// <summary>
    /// İki eşzamanlı "iptali geri al": ikisi de arşivi aktif görüp cariyi AYNI Id ile kurmaya
    /// çalışırsa biri duplicate-key ile 500 alırdı. Kilit ikinciyi bekletir ve reddeder.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentRestore_RestoresOnce_WithoutDuplicateKey()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, paid: 400m);

        await using (var db = database.NewContext())
            Assert.True((await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId, new CancelSaleRequest("iptal"))).IsSuccess);

        async Task<bool> RestoreAsync()
        {
            await using var db = database.NewContext();
            var result = await NewService(db).RestoreSaleAsync(seed.TenantId, seed.AccountId);
            return result.IsSuccess;
        }

        var results = await Task.WhenAll(RestoreAsync(), RestoreAsync());

        Assert.Equal(1, results.Count(x => x));
        await using var check = database.NewContext();
        Assert.Single(await check.CustomerAccounts.IgnoreQueryFilters().ToListAsync());
        Assert.Equal(400m, (await check.AccountPayments.IgnoreQueryFilters().SingleAsync()).Amount);
        // Geri alınan satışın arşiv tahsilatı pasifleşmeli — yoksa para iki kez gelir sayılır.
        Assert.Empty(await check.ArchivedSalePayments.Where(p => !p.IsDeleted).ToListAsync());
    }

    /// <summary>
    /// İPTAL SIRASINDA ARAYA GİREN TAHSİLAT. Kilit veriyi okumadan ÖNCE alınmazsa, ikinci istemcinin
    /// eklediği tahsilat yedeğe girmez ve hard-delete onu kalıcı olarak siler.
    /// Burada tahsilat, iptal transaction'ı açılmadan önce commit edilir; iptalin onu görmesi şarttır.
    /// </summary>
    [MySqlFact]
    public async Task CancelSale_SeesPaymentCommittedJustBefore()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, paid: 400m);

        // Aynı süreçte BAŞKA bir bağlantıdan ek tahsilat (ör. Ön Muhasebe'den alınan ikinci ödeme).
        await using (var other = database.NewContext())
            Assert.True((await NewService(other).RegisterPaymentAsync(
                seed.TenantId, seed.AccountId, new RegisterAccountPaymentRequest(250m, "card", null, null))).IsSuccess);

        await using (var db = database.NewContext())
        {
            // 650'nin tamamı iade edilebilmeli: doğrulama TAZE tutara bakmalı.
            var result = await NewService(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("tam iade", RefundedAmount: 650m, RefundMethod: "cash"));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var ledger = await check.ArchivedSalePayments.ToListAsync();
            Assert.Equal(2, ledger.Count);
            Assert.Equal(650m, ledger.Sum(p => p.Amount));
            Assert.Equal(650m, (await check.CancelledSales.SingleAsync()).CollectedAmount);
        }
    }

    /// <summary>
    /// TAHSİLAT–RANDEVU BAĞI İPTAL/GERİ ALMA ZİNCİRİNDE KAYBOLMAMALI.
    ///
    /// <para>
    /// Zincir: randevu tamamlanır ve parası alınır (<c>AccountPayment.SourceAppointmentId</c> yazılır)
    /// → satış iptal edilir (canlı tahsilat satırı cari ile birlikte CASCADE ile silinir, geriye
    /// yalnız yedeği kalır) → iptal geri alınır (satır SADECE yedekten kurulur). Yedek bu alanı
    /// taşımadığı için tahsilat bağsız geri geliyordu ve iki şey birden bozuluyordu:
    /// </para>
    /// <list type="number">
    ///   <item>"Tamamlamayı geri al" kapısı parayı göremediği için randevu "yapılmadı"ya
    ///         dönebiliyor, tahsilat cari kartta SAHİPSİZ kalıyordu.</item>
    ///   <item>Bağı boşalan satır, adisyon yolundaki geriye dönük eşleştirmenin
    ///         (<c>SourceAdisyonId == x &amp;&amp; SourceAppointmentId == null</c>) ağına düşüp
    ///         SONRAKİ bir randevuya bağlanabiliyordu — para yanlış randevunun üstüne yazılırdı.</item>
    /// </list>
    ///
    /// <para>
    /// Yalnız gerçek MySQL/MariaDB'de üretilebilir: kaybın sebebi cascade delete'tir, InMemory'de yok.
    /// Randevu iptalde HİÇ ellenmez (<c>CancelOrphanAppointmentsAsync</c> yalnız Scheduled/Confirmed/
    /// Draft kapatır) — kaybolan tek şey tahsilatın bağıdır, testin ölçtüğü de budur.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task RestoreSale_KeepsPaymentAppointmentLink_SoVoidCompletionStaysBlocked()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();

        Guid tenantId, accountId, appointmentId;
        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Bağ QA", $"bag-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "BAĞ MÜŞTERİ", "0555 777 88 99", null);
            db.Customers.Add(customer);
            var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Ayşe", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 45, 900m, "Epilasyon");
            db.ServiceDefinitions.Add(service);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Lazer Paketi", 3000m, 0m);
            db.CustomerAccounts.Add(account);

            // TAMAMLANMIŞ randevu. SourceAdisyonId bilerek boş: aksi hâlde geri alma isteği bir
            // ÜST kapıya ("önce satışı iptal edin") takılır ve test, ölçmek istediği para kapısına
            // hiç ulaşmadan yeşil görünürdü.
            var start = DateTime.UtcNow.AddDays(-2);
            var appointment = new Appointment(
                tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, start, start.AddMinutes(45), 0m);
            appointment.Complete();
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();

            // Randevu tamamlanınca alınan tahsilat — /complete ucunun ürettiği satırın aynısı.
            db.AccountPayments.Add(new AccountPayment(
                account.Id, 750m, "cash", "Randevu tahsilatı", DateTime.UtcNow,
                sourceAdisyonId: null, sourceAppointmentId: appointment.Id));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            accountId = account.Id;
            appointmentId = appointment.Id;
        }

        // Zincirin BAŞINDA kapı çalışıyor olmalı — yoksa sondaki "hâlâ kapalı" iddiası anlamsız olur.
        await using (var db = database.NewContext())
            await AssertVoidBlockedByPaymentAsync(db, tenantId, appointmentId);

        await using (var db = database.NewContext())
        {
            var cancelled = await NewService(db).CancelSaleAsync(
                tenantId, accountId, new CancelSaleRequest("bağ testi"));
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        // Cascade gerçekten sildi mi? Silmediyse test, geri yüklemeyi değil eski satırı ölçerdi.
        await using (var db = database.NewContext())
            Assert.Empty(await db.AccountPayments.IgnoreQueryFilters().ToListAsync());

        await using (var db = database.NewContext())
        {
            var restored = await NewService(db).RestoreSaleAsync(tenantId, accountId);
            Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var payment = await check.AccountPayments.IgnoreQueryFilters().SingleAsync();
            Assert.Equal(750m, payment.Amount);
            // ASIL REGRESYON: bağ yedekten geri gelmeli. null kalırsa hem kapı açılır hem satır
            // sonraki tamamlamanın eşleştirme süzgecine yakalanabilir hâle gelir.
            Assert.Equal(appointmentId, payment.SourceAppointmentId);
        }

        // Ve kapı geri almadan SONRA da kapalı kalmalı — kullanıcıya yansıyan sonuç budur.
        await using (var db = database.NewContext())
            await AssertVoidBlockedByPaymentAsync(db, tenantId, appointmentId);
    }

    /// <summary>
    /// Geri almanın TAHSİLAT kapısıyla durduğunu doğrular. Yalnız <c>IsFailure</c> yetmez: akışta
    /// başka reddetme yolları da var (yetki, "tamamlanmış değil", bağlı satış) ve hepsi testi
    /// yanlışlıkla yeşil gösterebilirdi — mesaj, kapının hangisi olduğunu sabitler.
    /// </summary>
    private static async Task AssertVoidBlockedByPaymentAsync(GuzellikDbContext db, Guid tenantId, Guid appointmentId)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
        var appointments = new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, null!);

        var result = await appointments.VoidCompletionAsync(
            tenantId, appointmentId, new VoidAppointmentCompletionRequest("yanlış tamamlama düzeltmesi"));

        Assert.True(result.IsFailure, "Tahsilatı olan randevunun tamamlaması geri alınabildi.");
        Assert.Contains("tahsilat", result.Error.Message, StringComparison.OrdinalIgnoreCase);
    }
}

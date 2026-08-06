using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DERİN DENETİM — FAZ 2 (finansal doğruluk).
///
/// <list type="bullet">
/// <item><b>H1</b> — Bağlı satış AÇIKKEN (henüz carisiz) istemcinin gönderdiği eski cari elemeden
/// geçiyor, otomatik onay yeni cariyi yaratınca para yine eski cariye yazılıyordu.</item>
/// <item><b>H2</b> — Prim ödemesi iki ayrı yazmaydı: gider patlarsa primler "ödendi" kalıyor,
/// eşzamanlı iki çağrı iki maaş gideri üretebiliyordu.</item>
/// <item><b>H3</b> — Onaylı gider soft-delete edilince gerçekleşmiş kasa çıkışı raporlardan siliniyordu.</item>
/// <item><b>M1</b> — İptalde harcanmış sadakat kazanımı sessizce korunuyordu.</item>
/// </list>
/// </summary>
public sealed class AuditRoundSevenPhase2Tests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    // ── H1: bağlı satış açıkken istemcinin eski carisi kabul edilmez ──────────────────────

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId, Guid OldAccountId);

    private static AppointmentService NewAppointments(GuzellikDbContext db, ICurrentUser actor)
    {
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), actor);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), actor, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), null!,
            new CapturingJobQueue(), new NoopAppNotificationService(), actor, adisyon, accounts);
    }

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Faz2 QA", $"faz2-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "FAZ2 MUSTERI", "0555 212 31 41", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Hizmet", 45, 1000m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        // ESKİ BORÇLU CARİ — yanlış hedef seçilirse para buraya kayar.
        var old = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski paket", 5000m, 0m);
        db.CustomerAccounts.Add(old);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, old.Id);
    }

    /// <summary>
    /// ASIL İDDİA: bağlı satış tamamlama anında HÂLÂ AÇIK (carisiz) olsa bile, istemcinin
    /// gönderdiği eski cari hedef kabul edilmez; istek reddedilir ve hiçbir şey yazılmaz.
    /// </summary>
    [Fact]
    public async Task CompleteWithPayment_OpenBoundSale_RejectsClientChosenOldAccount()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var created = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    new CreateAppointmentRequest(seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId,
                        DateTime.UtcNow.AddHours(3), DateTime.UtcNow.AddHours(3).AddMinutes(45), 0m, null),
                    new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId)));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            appointmentId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            // Satış hâlâ AÇIK (carisiz): erken kontrolün karşılaştıracağı hedef yok.
            var sale = await db.Adisyonlar.AsNoTracking().SingleAsync();
            Assert.Equal(AdisyonStatus.Open, sale.Status);
            Assert.Null(sale.CustomerAccountId);

            var result = await NewAppointments(db, actor).CompleteWithPaymentAsync(seed.TenantId, appointmentId,
                new CompleteAppointmentRequest(null,
                    new CompleteAppointmentPaymentDto(1000m, "cash", "Randevu tahsilatı", seed.OldAccountId, DateTime.UtcNow)));

            Assert.True(result.IsFailure, "Acik bagli satista eski cari hedef gosterilebildi.");
            Assert.Equal("Validation", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            // TAHSİLAT YAZILMADI. (Randevu durumunun da geri alındığı iddiası GERÇEK transaction
            // ister — InMemory sağlayıcıda rollback yoktur; o iddia MariaDB testinde doğrulanır:
            // CompleteWithPayment_OpenBoundSale_RejectedRequestRollsBackEverything.)
            Assert.Empty(await check.AccountPayments.ToListAsync());
        }
    }

    /// <summary>
    /// AYNI İDDİA, GERÇEK VERİTABANINDA: reddedilen istekte randevu da tamamlanmaz — durum
    /// değişikliği, seans tüketimi ve tahsilat birlikte geri alınır.
    /// </summary>
    [MySqlFact]
    public async Task CompleteWithPayment_OpenBoundSale_RejectedRequestRollsBackEverything()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, branchId, customerId, staffId, serviceId, oldAccountId, appointmentId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz2 SQL", $"faz2sql-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "FAZ2 SQL MUSTERI", "0555 313 41 51", null);
            db.Customers.Add(customer);
            var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(tenant.Id, branch.Id, "Hizmet", 45, 1000m, "Cilt");
            db.ServiceDefinitions.Add(service);
            await db.SaveChangesAsync();

            var old = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski paket", 5000m, 0m);
            db.CustomerAccounts.Add(old);
            await db.SaveChangesAsync();

            tenantId = tenant.Id; branchId = branch.Id; customerId = customer.Id;
            staffId = staff.Id; serviceId = service.Id; oldAccountId = old.Id;
        }

        var actor = new TestCurrentUser(UserRole.InstitutionOwner, tenantId, branchId);
        await using (var db = database.NewContext())
        {
            var created = await NewAppointments(db, actor).CreateWithSaleAsync(tenantId,
                new CreateAppointmentWithSaleRequest(
                    new CreateAppointmentRequest(branchId, customerId, staffId, serviceId,
                        DateTime.UtcNow.AddHours(3), DateTime.UtcNow.AddHours(3).AddMinutes(45), 0m, null),
                    new AppointmentCatalogSaleDto(serviceId, null, staffId)));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            appointmentId = created.Value!.Id;
        }

        await using (var db = database.NewContext())
        {
            var result = await NewAppointments(db, actor).CompleteWithPaymentAsync(tenantId, appointmentId,
                new CompleteAppointmentRequest(null,
                    new CompleteAppointmentPaymentDto(1000m, "cash", "Randevu tahsilatı", oldAccountId, DateTime.UtcNow)));
            Assert.True(result.IsFailure, "Acik bagli satista eski cari hedef gosterilebildi.");
        }

        await using (var check = database.NewContext())
        {
            // HİÇBİR ŞEY UYGULANMADI: ne tahsilat, ne tamamlama, ne de satış onayı.
            Assert.Empty(await check.AccountPayments.AsNoTracking().ToListAsync());
            var status = await check.Appointments.AsNoTracking()
                .Where(a => a.Id == appointmentId).Select(a => a.Status).SingleAsync();
            Assert.NotEqual(AppointmentStatus.Completed, status);
            var sale = await check.Adisyonlar.AsNoTracking().SingleAsync();
            Assert.Equal(AdisyonStatus.Open, sale.Status);
        }
    }

    /// <summary>Cari verilmezse akış bozulmaz: para randevunun KENDİ satışının carisine yazılır.</summary>
    [Fact]
    public async Task CompleteWithPayment_OpenBoundSale_WithoutClientAccount_PaysItsOwnSale()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var created = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    new CreateAppointmentRequest(seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId,
                        DateTime.UtcNow.AddHours(3), DateTime.UtcNow.AddHours(3).AddMinutes(45), 0m, null),
                    new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId)));
            appointmentId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var done = await NewAppointments(db, actor).CompleteWithPaymentAsync(seed.TenantId, appointmentId,
                new CompleteAppointmentRequest(null,
                    new CompleteAppointmentPaymentDto(1000m, "cash", "Randevu tahsilatı", null, DateTime.UtcNow)));
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var accounts = await check.CustomerAccounts.Include(a => a.Payments).ToListAsync();
            var oldAccount = accounts.Single(a => a.Id == seed.OldAccountId);
            var saleAccount = accounts.Single(a => a.Id != seed.OldAccountId);
            Assert.Equal(0m, oldAccount.Payments.Sum(p => p.Amount));     // eski borca dokunulmadı
            Assert.Equal(1000m, saleAccount.Payments.Sum(p => p.Amount)); // para kendi satışında
        }
    }

    // ── H2: prim ödemesi atomik ───────────────────────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: prim ödemesi ile maaş gideri AYNI transaction'da yazılır ve ikinci çağrı
    /// (aynı personel, ödenecek prim kalmamış) gider ÜRETMEZ.
    /// </summary>
    [Fact]
    public async Task PayCommission_SecondCallCreatesNoSecondExpense()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            db.StaffCommissions.Add(new StaffCommission(seed.TenantId, seed.BranchId, seed.StaffId,
                Guid.CreateVersion7(), Guid.CreateVersion7(), "Service", "Hizmet", 1000m, 30m, DateTime.UtcNow.AddDays(-1)));
            db.StaffCommissions.Add(new StaffCommission(seed.TenantId, seed.BranchId, seed.StaffId,
                Guid.CreateVersion7(), Guid.CreateVersion7(), "Service", "Hizmet", 500m, 40m, DateTime.UtcNow.AddDays(-1)));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var first = await new CommissionService(db, new NoopAuditLogger()).PayAsync(seed.TenantId, seed.StaffId, null, null);
            Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            // İkinci çağrı: ödenmemiş prim kalmadı → reddedilir, İKİNCİ gider oluşmaz.
            var second = await new CommissionService(db, new NoopAuditLogger()).PayAsync(seed.TenantId, seed.StaffId, null, null);
            Assert.True(second.IsFailure);
        }

        await using (var check = NewDb(options))
        {
            var expenses = await check.BusinessExpenses.Where(e => e.Category == ExpenseCategory.Salary).ToListAsync();
            var expense = Assert.Single(expenses);
            var paidTotal = await check.StaffCommissions.Where(c => c.IsPaid).SumAsync(c => c.Amount);
            Assert.Equal(paidTotal, expense.Amount);      // gider = ödenen prim toplamı
            Assert.All(await check.StaffCommissions.ToListAsync(), c => Assert.True(c.IsPaid));
        }
    }

    // ── H3: onaylı gider silinemez ────────────────────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: onaylanmış (gerçekleşmiş) gider silinemez — geçmiş kasa çıkışı raporlardan
    /// kaybolamaz. Onay bekleyen kayıt silinebilir (hiçbir deftere girmemiştir).
    /// </summary>
    [Fact]
    public async Task DeleteExpense_ApprovedIsRefused_PendingIsAllowed()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid approvedId, pendingId;

        await using (var db = NewDb(options))
        {
            var approved = new BusinessExpense(seed.TenantId, seed.BranchId, ExpenseCategory.Rent, 1000m,
                DateTime.UtcNow.AddDays(-3), ExpensePaymentMethod.Cash, "Kira");
            approved.Approve();
            var pending = new BusinessExpense(seed.TenantId, seed.BranchId, ExpenseCategory.Other, 250m,
                DateTime.UtcNow.AddDays(-1), ExpensePaymentMethod.Cash, "Onay bekleyen");
            db.BusinessExpenses.AddRange(approved, pending);
            await db.SaveChangesAsync();
            approvedId = approved.Id;
            pendingId = pending.Id;
        }

        await using (var db = NewDb(options))
        {
            var service = new ExpenseService(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

            var approvedDelete = await service.DeleteAsync(seed.TenantId, approvedId);
            Assert.True(approvedDelete.IsFailure, "Onayli gider silinebildi.");
            Assert.Equal("Conflict", approvedDelete.Error.Code);

            var pendingDelete = await service.DeleteAsync(seed.TenantId, pendingId);
            Assert.True(pendingDelete.IsSuccess, pendingDelete.IsFailure ? pendingDelete.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            // Onaylı gider hâlâ görünür (kasa çıkışı korunmuş), bekleyen silinmiş.
            var remaining = Assert.Single(await check.BusinessExpenses.ToListAsync());
            Assert.Equal(approvedId, remaining.Id);
        }
    }

    // ── M1: harcanmış sadakat kazanımı için ters kayıt ───────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: iptal edilen satıştan kazanılan puan BAŞKA bir satışta harcanmışsa kazanım
    /// sessizce korunmaz; açık bir ters hareket (negatif yükümlülük) yazılır ve bakiye düşer.
    /// </summary>
    [Fact]
    public async Task ReverseAdisyon_SpentLoyaltyEarn_WritesClawbackInsteadOfKeepingIt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;

            // Bu satıştan 10 puan kazanıldı…
            db.LoyaltyTransactions.Add(new LoyaltyTransaction(seed.TenantId, seed.CustomerId, 10,
                "Adisyon", adisyon.Id, "Kazanım", DateTime.UtcNow.AddDays(-2)));
            // …ve başka bir işlemde harcandı (bakiye 0).
            db.LoyaltyTransactions.Add(new LoyaltyTransaction(seed.TenantId, seed.CustomerId, -10,
                "Redeem", Guid.CreateVersion7(), "Harcama", DateTime.UtcNow.AddDays(-1)));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var adisyon = await db.Adisyonlar.Include(a => a.Items).SingleAsync(a => a.Id == adisyonId);
            var reversal = new AdisyonEffectsReversal(db, new FixedClock());
            await reversal.ReverseAsync(seed.TenantId, adisyon);
            await db.SaveChangesAsync();
        }

        await using (var check = NewDb(options))
        {
            var rows = await check.LoyaltyTransactions.Where(l => l.CustomerId == seed.CustomerId).ToListAsync();
            // Kazanım satırı duruyor (geçmiş harcama bozulmadı) ama ters kayıt yazıldı.
            Assert.Contains(rows, r => r.SourceType == "AdisyonCancelClawback" && r.Points == -10);
            // Bakiye artık BORÇLU tarafta: müşteri iptal edilen paradan fayda sağlamış kalmıyor.
            Assert.Equal(-10, rows.Sum(r => r.Points));
        }
    }
}

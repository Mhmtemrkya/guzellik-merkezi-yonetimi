using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DEPLOY BLOCKER REGRESYONLARI (5 Ağu 2026 denetimi — dördüncü tur).
///
/// <list type="number">
/// <item>ŞUBE YÖNETİCİSİ BAŞKA ŞUBEYE RANDEVU YAZABİLİYORDU: middleware onu JWT şubesine
/// sabitliyor ama randevu şubesi İSTEK GÖVDESİNDEN geliyor ve yalnız "aynı kurum mu" diye
/// doğrulanıyordu — başlık koruması gövdeyle baypas ediliyordu.</item>
/// <item>RANDEVU İPTALİ/SİLİNMESİ KAYNAK SATIŞI AÇIK BIRAKIYORDU: satıştan randevuya doğru
/// kapatma vardı, tersi yoktu. Karşılıksız kalan açık fiş, müşterinin BAŞKA bir randevusu
/// tamamlanınca "ilk randevuda cariye işle" kuralıyla onaylanıp cariye borç yazıyordu.</item>
/// <item>AÇILIŞTAKİ TAKSİT ONARIMI planı YIKIP yeniden kuruyordu: taksit kimlikleri, durumları
/// ve vadeleri kayboluyor, kilit/yeniden doğrulama olmadığı için iki backend aynı anda
/// açıldığında iki plan seti oluşabiliyordu.</item>
/// <item>İADE ÖDEME YÖNTEMİ gider listesinde koşulsuz "Nakit" yazılıyordu (kart/havale iadesi
/// nakit çıkış görünüyor, kasa kırılımı yanlış kapanıyordu).</item>
/// </list>
/// </summary>
public sealed class DeployBlockerRoundFourTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AppointmentService NewAppointments(GuzellikDbContext db, ICurrentUser? actor = null)
    {
        var user = actor ?? new TestCurrentUser(UserRole.InstitutionOwner);
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), user);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, accounts);
    }

    private sealed record Seed(
        Guid TenantId, Guid BranchA, Guid BranchB, Guid CustomerId, Guid StaffId, Guid ServiceA, Guid ServiceB);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Blocker4 QA", $"blocker4-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var a = tenant.AddBranch("Şube A", "İstanbul", true);
        var b = tenant.AddBranch("Şube B", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, a.Id, "BLOCKER4 MÜŞTERİ", "0555 707 60 50", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, a.Id, "Uzman Nil", "Uzman");
        db.StaffMembers.Add(staff);
        var serviceA = new ServiceDefinition(tenant.Id, a.Id, "A Hizmeti", 60, 1500m, "Cilt");
        var serviceB = new ServiceDefinition(tenant.Id, a.Id, "B Hizmeti", 45, 900m, "Epilasyon");
        db.ServiceDefinitions.AddRange(serviceA, serviceB);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, a.Id, b.Id, customer.Id, staff.Id, serviceA.Id, serviceB.Id);
    }

    private static CreateAppointmentRequest Request(Seed seed, Guid branchId, Guid serviceId, int hourOffset) =>
        new(branchId, seed.CustomerId, seed.StaffId, serviceId,
            DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(45), 0m, null);

    // ── 1) Şube kapsamı: gövdedeki şube sabitlenmiş rolü aşamaz ───────────────────────────

    public static TheoryData<UserRole> PinnedRoles => new() { UserRole.BranchManager, UserRole.Staff };

    /// <summary>
    /// ASIL İDDİA: Şube A'ya sabitlenmiş kullanıcı gövdeye Şube B yazsa da randevu A'da açılır.
    /// (Düzeltmeden önce randevu gerçekten B'ye yazılıyordu.)
    /// </summary>
    [Theory]
    [MemberData(nameof(PinnedRoles))]
    public async Task CreateAppointment_PinnedRole_CannotTargetAnotherBranch(UserRole role)
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(role, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using (var db = NewDb(options))
        {
            var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    Request(seed, seed.BranchB, seed.ServiceA, 3),   // ← saldırı: başka şube
                    new AppointmentCatalogSaleDto(seed.ServiceA, null, seed.StaffId)));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.SingleAsync();
            Assert.Equal(seed.BranchA, appointment.BranchId);
            Assert.Equal(0, await check.Appointments.CountAsync(a => a.BranchId == seed.BranchB));
        }
    }

    /// <summary>Kurum sahibi kurumun TAMAMINI yönetir: seçtiği şubeye randevu yazabilmeli.</summary>
    [Fact]
    public async Task CreateAppointment_InstitutionOwner_CanTargetAnyOwnBranch()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var owner = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);

        await using (var db = NewDb(options))
        {
            var result = await NewAppointments(db, owner).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    Request(seed, seed.BranchB, seed.ServiceA, 4),
                    new AppointmentCatalogSaleDto(seed.ServiceA, null, seed.StaffId)));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            Assert.Equal(seed.BranchB, (await check.Appointments.SingleAsync()).BranchId);
        }
    }

    // ── 2) Randevu → satış yaşam döngüsü ──────────────────────────────────────────────────

    private static async Task<(Guid AppointmentId, Guid SaleId)> CreateWithSaleAsync(
        DbContextOptions<GuzellikDbContext> options, Seed seed, Guid serviceId, int hourOffset)
    {
        await using var db = NewDb(options);
        var created = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId,
            new CreateAppointmentWithSaleRequest(
                Request(seed, seed.BranchA, serviceId, hourOffset),
                new AppointmentCatalogSaleDto(serviceId, null, seed.StaffId)));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        var appointment = await db.Appointments.SingleAsync(a => a.Id == created.Value!.Id);
        Assert.NotNull(appointment.SourceAdisyonId);
        return (appointment.Id, appointment.SourceAdisyonId!.Value);
    }

    [Fact]
    public async Task CancelAppointment_ClosesTheOpenSaleThatCreatedIt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var (appointmentId, saleId) = await CreateWithSaleAsync(options, seed, seed.ServiceA, 5);

        await using (var db = NewDb(options))
        {
            var result = await NewAppointments(db).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Cancelled, "Müşteri vazgeçti"));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            Assert.Equal(AdisyonStatus.Cancelled, (await check.Adisyonlar.SingleAsync(a => a.Id == saleId)).Status);
            // İptal gerekçesi kullanıcının yazdığı metin olarak KALIR (fiş kapatma onu ezmemeli).
            Assert.Equal("Müşteri vazgeçti", (await check.Appointments.SingleAsync(a => a.Id == appointmentId)).CancellationReason);
        }
    }

    [Fact]
    public async Task DeleteAppointment_ClosesTheOpenSaleThatCreatedIt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var (appointmentId, saleId) = await CreateWithSaleAsync(options, seed, seed.ServiceA, 6);

        await using (var db = NewDb(options))
        {
            var result = await NewAppointments(db).DeleteAsync(seed.TenantId, appointmentId);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            Assert.Equal(AdisyonStatus.Cancelled, (await check.Adisyonlar.SingleAsync(a => a.Id == saleId)).Status);
        }
    }

    /// <summary>
    /// PARA ETKİSİ: iptal edilen randevunun fişi, BAŞKA bir randevunun tamamlanmasıyla
    /// otomatik onaylanıp cariye borç yazmamalı (bulgunun asıl zararı buydu).
    /// </summary>
    [Fact]
    public async Task CompletingAnotherAppointment_DoesNotApproveTheCancelledAppointmentsSale()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var first = await CreateWithSaleAsync(options, seed, seed.ServiceA, 7);
        var second = await CreateWithSaleAsync(options, seed, seed.ServiceB, 30);

        await using (var db = NewDb(options))
        {
            var cancelled = await NewAppointments(db).ChangeStatusAsync(seed.TenantId, first.AppointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Cancelled, "İptal"));
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var completed = await NewAppointments(db).ChangeStatusAsync(seed.TenantId, second.AppointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(completed.IsSuccess, completed.IsFailure ? completed.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            Assert.Equal(AdisyonStatus.Cancelled, (await check.Adisyonlar.SingleAsync(a => a.Id == first.SaleId)).Status);
            Assert.Equal(AdisyonStatus.Approved, (await check.Adisyonlar.SingleAsync(a => a.Id == second.SaleId)).Status);
            // İptal edilen satıştan cari doğmamalı: yalnız tamamlanan randevununki açılır.
            Assert.Equal(1, await check.CustomerAccounts.CountAsync(a => a.CustomerId == seed.CustomerId));
        }
    }

    /// <summary>
    /// ONAYLI FİŞE DOKUNULMAZ: parası kasaya, borcu cariye işlenmiştir. Randevu iptali onu
    /// iptal ederse muhasebe defteri ile satış kaydı ayrışırdı (o yol satış iptali ekranıdır).
    /// </summary>
    [Fact]
    public async Task CancelAppointment_LeavesAnAlreadyApprovedSaleUntouched()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var (appointmentId, saleId) = await CreateWithSaleAsync(options, seed, seed.ServiceA, 8);

        await using (var db = NewDb(options))
        {
            var approved = new AdisyonService(db, new NoopAuditLogger(),
                    new TestCurrentUser(UserRole.InstitutionOwner),
                    new CustomerAccountService(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner)),
                    new AllowAllFeatureService())
                .ApproveAsync(seed.TenantId, saleId);
            Assert.True((await approved).IsSuccess);
        }

        await using (var db = NewDb(options))
        {
            var result = await NewAppointments(db).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Cancelled, "İptal"));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            Assert.Equal(AdisyonStatus.Approved, (await check.Adisyonlar.SingleAsync(a => a.Id == saleId)).Status);
        }
    }

    // ── 3) Açılıştaki taksit onarımı planı YIKMAZ ─────────────────────────────────────────

    /// <summary>
    /// Sapmış bir cari kurar: 4 taksitlik plan (biri İPTAL), sonra toplam yükseltilir ama plan
    /// güncellenmez. (driftedAccountId, aktif taksit kimlikleri, iptal taksit kimliği) döner.
    /// </summary>
    private static async Task<(Guid AccountId, Guid[] ActiveIds, Guid CancelledId, DateOnly[] DueDates)>
        SeedDriftedAccountAsync(DbContextOptions<GuzellikDbContext> options, Seed seed, decimal from, decimal to)
    {
        await using var db = NewDb(options);
        var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerId, null, "Sapmış satış", from, 0m);
        account.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(15)));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        // Bir taksit iptal edilmiş olsun: eski onarım (RebuildInstallments) bu satırı SİLİP
        // yerine Planned bir taksit koyuyordu — durum semantiği kayboluyordu.
        var cancelled = account.Installments.OrderBy(i => i.No).Last();
        cancelled.Cancel();
        account.ChangeTotal(to, 0m);      // plan bilerek yeniden kurulmadı
        await db.SaveChangesAsync();

        var active = account.Installments.Where(i => i.Status != InstallmentStatus.Cancelled).OrderBy(i => i.No).ToList();
        return (account.Id, active.Select(i => i.Id).ToArray(), cancelled.Id, active.Select(i => i.DueDate).ToArray());
    }

    [Fact]
    public async Task RepairInstallmentPlanDrift_KeepsInstallmentIdentityStatusAndDueDates()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var before = await SeedDriftedAccountAsync(options, seed, 8500m, 8750m);

        await using (var db = NewDb(options))
        {
            Assert.Equal(1, await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db));
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == before.AccountId);
            var active = account.Installments.Where(i => i.Status != InstallmentStatus.Cancelled).OrderBy(i => i.No).ToList();

            // SATIR KİMLİKLERİ AYNI (plan yıkılıp yeniden kurulmadı) ve vadeler korundu.
            Assert.Equal(before.ActiveIds, active.Select(i => i.Id).ToArray());
            Assert.Equal(before.DueDates, active.Select(i => i.DueDate).ToArray());
            // İptal edilmiş taksit hâlâ duruyor ve HÂLÂ İptal (silinip Planned'a dönüşmedi).
            var cancelled = account.Installments.Single(i => i.Id == before.CancelledId);
            Assert.Equal(InstallmentStatus.Cancelled, cancelled.Status);
            // Kayıp alacak kapandı: aktif plan finanse edilen tutara eşit.
            Assert.Equal(8750m, active.Sum(i => i.Amount));
        }

        // İDEMPOTENT.
        await using (var db = NewDb(options))
        {
            Assert.Equal(0, await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db));
        }
    }

    /// <summary>
    /// TERS YÖN ONARILMAZ: plan finanse edilen tutarın ÜSTÜNDEyse bu bilinen hatanın imzası
    /// değildir; planı otomatik küçültmek müşteriden beklenen alacağı azaltırdı.
    /// </summary>
    [Fact]
    public async Task RepairInstallmentPlanDrift_DoesNotShrinkPlansAboveTheFinancedAmount()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var before = await SeedDriftedAccountAsync(options, seed, 9000m, 6000m);

        await using (var db = NewDb(options))
        {
            Assert.Equal(0, await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db));
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == before.AccountId);
            var active = account.Installments.Where(i => i.Status != InstallmentStatus.Cancelled).ToList();
            Assert.Equal(6750m, active.Sum(i => i.Amount));   // 3 × 2250 — dokunulmadı
        }
    }

    /// <summary>
    /// DEVRE KESİCİ: sapma bilinen tek seferlik artığın ötesine yayılmışsa iş HİÇ çalışmaz
    /// (para etkileyen düzeltme binlerce kayda otomatik uygulanmamalı).
    /// </summary>
    [Fact]
    public async Task RepairInstallmentPlanDrift_RefusesWhenTooManyAccountsAreDrifted()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            for (var i = 0; i < 26; i++)
            {
                var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerId, null, $"Sapma {i}", 1000m, 0m);
                account.RebuildInstallments(2, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(15)));
                db.CustomerAccounts.Add(account);
                await db.SaveChangesAsync();
                account.ChangeTotal(1500m, 0m);
                await db.SaveChangesAsync();
            }
        }

        await using (var db = NewDb(options))
        {
            Assert.Equal(0, await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db));
            // Hiçbir plana dokunulmamış olmalı.
            Assert.Equal(0, await db.Installments.CountAsync(i => i.Amount != 500m));
        }
    }

    // ── 4) İade ödeme yöntemi ─────────────────────────────────────────────────────────────

    public static TheoryData<string, ExpensePaymentMethod> RefundMethods => new()
    {
        { "cash", ExpensePaymentMethod.Cash },
        { "card", ExpensePaymentMethod.Card },
        { "transfer", ExpensePaymentMethod.BankTransfer },
    };

    [Theory]
    [MemberData(nameof(RefundMethods))]
    public async Task ExpenseList_ReportsTheRefundsOwnPaymentMethod(string method, ExpensePaymentMethod expected)
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            db.RefundTransactions.Add(new RefundTransaction(
                seed.TenantId, seed.BranchA, Guid.CreateVersion7(), seed.CustomerId, 250m, method));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var service = new ExpenseService(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            var result = await service.ListAsync(seed.TenantId, new ExpenseFilter(null, null, null, null), new PageRequest(1, 50));

            Assert.True(result.IsSuccess);
            var row = Assert.Single(result.Value!.Items);
            Assert.Equal(expected, row.PaymentMethod);
        }
    }
}

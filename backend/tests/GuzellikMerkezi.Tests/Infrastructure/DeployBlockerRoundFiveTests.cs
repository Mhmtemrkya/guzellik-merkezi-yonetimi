using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DEPLOY BLOCKER REGRESYONLARI (5 Ağu 2026 denetimi — besinci tur).
///
/// <list type="number">
/// <item>ŞUBE SABİTLEMESİ DELİĞİN YALNIZ YARISINI KAPATIYORDU: randevunun kendi BranchId'si
/// kullanıcının şubesine çekiliyor ama BAĞLANDIĞI müşteri/personel/hizmet yalnız "aynı kurumda mı"
/// diye denetleniyordu. Şube A yöneticisi Şube B'nin kayıtlarıyla kendi şubesine randevu+satış
/// açabiliyordu.</item>
/// <item>İPTAL GERİ ALINIRKEN KORUNAN İADE İKİ KEZ DÜŞÜLÜYORDU: tutar hem
/// <c>CustomerAccount.RefundedAmount</c> alanına yazılıyor hem de iade satırı canlı kalıyor,
/// harcama sorgusu ikisini birden düşüyordu (1.000 tahsilat − 400 iade = 200 gösteriliyordu).</item>
/// <item>BEKLEME LİSTESİNDE KAYNAK SEANS DOĞRULANMIYORDU: istemciden gelen seans kimliği kurum /
/// müşteri / hizmet bağı hiç kontrol edilmeden saklanıyordu (kolonun FK'sı da yok).</item>
/// <item>AÇILIŞTAKİ TAKSİT ONARIMI KOŞULSUZ ÇALIŞIYORDU: para etkileyen düzeltme artık opt-in ve
/// belirli carilerle sınırlanabiliyor.</item>
/// </list>
/// </summary>
public sealed class DeployBlockerRoundFiveTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AppointmentService NewAppointments(GuzellikDbContext db, ICurrentUser actor)
    {
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), actor);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), actor, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, actor, adisyon, accounts);
    }

    // ── 1) Bağlı varlıklar da sabitlenmiş şubede olmalı ───────────────────────────────────

    private sealed record BranchSeed(
        Guid TenantId, Guid BranchA, Guid BranchB,
        Guid CustomerA, Guid StaffA, Guid ServiceA,
        Guid CustomerB, Guid StaffB, Guid ServiceB,
        Guid TenantWideService);

    private static async Task<BranchSeed> SeedBranchesAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Blocker5 QA", $"blocker5-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var a = tenant.AddBranch("Şube A", "İstanbul", true);
        var b = tenant.AddBranch("Şube B", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customerA = new Customer(tenant.Id, a.Id, "A MUSTERI", "0555 101 20 30", null);
        var customerB = new Customer(tenant.Id, b.Id, "B MUSTERI", "0555 404 50 60", null);
        db.Customers.AddRange(customerA, customerB);
        var staffA = new StaffMember(tenant.Id, a.Id, "A Uzman", "Uzman");
        var staffB = new StaffMember(tenant.Id, b.Id, "B Uzman", "Uzman");
        db.StaffMembers.AddRange(staffA, staffB);
        var serviceA = new ServiceDefinition(tenant.Id, a.Id, "A Hizmeti", 60, 1000m, "Cilt");
        var serviceB = new ServiceDefinition(tenant.Id, b.Id, "B Hizmeti", 60, 1000m, "Cilt");
        // Kurum geneli katalog kaydı: BranchId null → her şubede geçerli olmalı.
        var shared = new ServiceDefinition(tenant.Id, null, "Ortak Hizmet", 60, 1000m, "Cilt");
        db.ServiceDefinitions.AddRange(serviceA, serviceB, shared);
        await db.SaveChangesAsync();

        return new BranchSeed(tenant.Id, a.Id, b.Id,
            customerA.Id, staffA.Id, serviceA.Id,
            customerB.Id, staffB.Id, serviceB.Id, shared.Id);
    }

    private static CreateAppointmentWithSaleRequest WithSale(
        Guid branchId, Guid customerId, Guid staffId, Guid serviceId, int hourOffset) =>
        new(new CreateAppointmentRequest(branchId, customerId, staffId, serviceId,
                DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(45), 0m, null),
            new AppointmentCatalogSaleDto(serviceId, null, staffId));

    public static TheoryData<string> ForeignBranchFields => new() { "customer", "staff", "service" };

    /// <summary>
    /// ASIL İDDİA: Şube A'ya sabitlenmiş yönetici, Şube B'nin müşteri/personel/hizmet kimliğini
    /// gönderdiğinde istek REDDEDİLİR ve hiçbir randevu/satış oluşmaz.
    /// </summary>
    [Theory]
    [MemberData(nameof(ForeignBranchFields))]
    public async Task CreateWithSale_PinnedRole_CannotBindOtherBranchEntities(string field)
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed.BranchA,
                field == "customer" ? seed.CustomerB : seed.CustomerA,
                field == "staff" ? seed.StaffB : seed.StaffA,
                field == "service" ? seed.ServiceB : seed.ServiceA,
                3));

        Assert.True(result.IsFailure, $"Baska subenin {field} kaydiyla randevu acilabildi.");
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Empty(await db.Appointments.ToListAsync());
        Assert.Empty(await db.Adisyonlar.ToListAsync());
    }

    /// <summary>Kendi şubesinin kayıtlarıyla akış bozulmamalı (kural fazla katı olmamalı).</summary>
    [Fact]
    public async Task CreateWithSale_PinnedRole_OwnBranchEntities_StillWork()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed.BranchA, seed.CustomerA, seed.StaffA, seed.ServiceA, 4));
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    /// <summary>KURUM GENELİ katalog kaydı (BranchId = null) her şubede kullanılabilmeli.</summary>
    [Fact]
    public async Task CreateWithSale_PinnedRole_TenantWideService_IsAllowed()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed.BranchA, seed.CustomerA, seed.StaffA, seed.TenantWideService, 5));
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    /// <summary>Kurum sahibi kurumun tamamını yönetir: şubeler arası bağ onu kısıtlamaz.</summary>
    [Fact]
    public async Task CreateWithSale_InstitutionOwner_CanBindAnyBranchEntities()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var owner = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, owner).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed.BranchB, seed.CustomerB, seed.StaffB, seed.ServiceB, 6));
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    /// <summary>Personel aktarımı da başka şubenin personeline yapılamaz (taşıma yolu).</summary>
    [Fact]
    public async Task Reschedule_PinnedRole_CannotMoveToOtherBranchStaff()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var created = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
                WithSale(seed.BranchA, seed.CustomerA, seed.StaffA, seed.ServiceA, 7));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            appointmentId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var start = DateTime.UtcNow.AddHours(20);
            var moved = await NewAppointments(db, actor).RescheduleAsync(seed.TenantId, appointmentId,
                new RescheduleAppointmentRequest(start, start.AddMinutes(45), seed.StaffB));
            Assert.True(moved.IsFailure, "Randevu baska subenin personeline aktarilabildi.");
            Assert.Equal("NotFound", moved.Error.Code);
        }
    }

    // ── 2) Korunmuş iade iki kez düşülmemeli ──────────────────────────────────────────────

    /// <summary>
    /// 1.000 TL tahsilat + 400 TL korunmuş iade → net harcama 600 TL olmalı.
    /// Hata varken 200 TL donuyordu: aynı iade hem RefundedAmount alanından hem
    /// refund_transactions satırından düşülüyordu.
    /// </summary>
    [Fact]
    public async Task GetSpendingStats_PreservedRefund_IsSubtractedOnlyOnce()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        Guid tenantId;

        await using (var db = new GuzellikDbContext(options, null, new TestCurrentUser(), null, null, search))
        {
            var tenant = new Tenant("Iade QA", $"iade5-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;

            var customer = new Customer(tenant.Id, branch.Id, "IADE MUSTERI", "0555 707 80 90", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 2000m, 0m);
            account.RegisterPayment(1000m, "cash", null, DateTime.UtcNow.AddDays(-2));
            // İptal geri alındı ve iade KORUNDU: alan doldurulur, iade satırı CANLI kalır.
            account.ApplyPreservedRefund(400m);
            db.CustomerAccounts.Add(account);
            db.RefundTransactions.Add(new RefundTransaction(
                tenant.Id, branch.Id, Guid.CreateVersion7(), customer.Id, 400m, "cash",
                refundedAtUtc: DateTime.UtcNow.AddDays(-1)));
            await db.SaveChangesAsync();
        }

        await using (var db = new GuzellikDbContext(options, null, new TestCurrentUser(), null, null, search))
        {
            var service = new CustomerService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
                new TestCurrentUser(UserRole.InstitutionOwner), new AllowAllFeatureService(), search, new CapturingJobQueue());
            var result = await service.GetSpendingStatsAsync(tenantId, days: null);

            Assert.True(result.IsSuccess);
            Assert.Equal(600m, result.Value!.TotalSpent);
            Assert.Equal(600m, result.Value.AvgSpent);
            Assert.Equal(1, result.Value.SpenderCount);
        }
    }

    // ── 3) Bekleme listesinde kaynak seans doğrulanır ──────────────────────────────────────

    private static WaitlistService NewWaitlist(GuzellikDbContext db, ICurrentUser actor) =>
        new(db, new NoopAuditLogger(), new AllowAllFeatureService(), new NoopAppNotificationService(), actor, null!);

    [Fact]
    public async Task CreateWaitlist_ForeignCustomersSession_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid foreignSessionId;

        await using (var db = NewDb(options))
        {
            // B müşterisine ait GERÇEK bir seans — saldırıda "kaynak" diye gönderilir.
            var account = new CustomerAccount(seed.TenantId, seed.BranchB, seed.CustomerB, null, "B paketi", 1000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            var session = new CustomerPackageSession(seed.TenantId, seed.CustomerB, account.Id, Guid.CreateVersion7(), seed.ServiceA, 5, null);
            db.CustomerPackageSessions.Add(session);
            await db.SaveChangesAsync();
            foreignSessionId = session.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                new CreateWaitlistRequest(seed.CustomerA, seed.ServiceA, seed.StaffA,
                    DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)), null, seed.BranchA,
                    SourceCustomerPackageSessionId: foreignSessionId));

            Assert.True(result.IsFailure, "Baska musterinin seansi kaynak olarak kaydedilebildi.");
            Assert.Equal("Validation", result.Error.Code);
            Assert.Empty(await db.WaitlistEntries.ToListAsync());
        }
    }

    [Fact]
    public async Task CreateWaitlist_OwnSession_IsAccepted()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid sessionId;

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "A paketi", 1000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            var session = new CustomerPackageSession(seed.TenantId, seed.CustomerA, account.Id, Guid.CreateVersion7(), seed.ServiceA, 5, null);
            db.CustomerPackageSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                new CreateWaitlistRequest(seed.CustomerA, seed.ServiceA, seed.StaffA,
                    DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)), null, seed.BranchA,
                    SourceCustomerPackageSessionId: sessionId));

            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(sessionId, (await db.WaitlistEntries.SingleAsync()).SourceCustomerPackageSessionId);
        }
    }

    // ── 4) Açılış onarımı yalnız hedeflenen cariye dokunur ────────────────────────────────

    /// <summary>
    /// Operatör belirli cari(ler) verdiyse diğer sapmış kayıtlara DOKUNULMAZ — "canlıdaki bilinen
    /// tek kaydı düzelt" isteği bu şekilde karşılanır.
    /// </summary>
    [Fact]
    public async Task RepairInstallmentPlanDrift_WithAccountFilter_TouchesOnlyListedAccount()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        Guid targetId, otherId;

        await using (var db = NewDb(options))
        {
            var target = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "Hedef", 8500m, 0m);
            target.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(15)));
            var other = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "Digeri", 4000m, 0m);
            other.RebuildInstallments(2, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(15)));
            db.CustomerAccounts.AddRange(target, other);
            await db.SaveChangesAsync();
            target.ChangeTotal(8750m, 0m);
            other.ChangeTotal(5000m, 0m);
            await db.SaveChangesAsync();
            targetId = target.Id;
            otherId = other.Id;
        }

        await using (var db = NewDb(options))
        {
            var repaired = await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                new DatabaseBootstrap.InstallmentPlanRepairTarget(
                    targetId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4)]);
            Assert.Equal(1, repaired);
        }

        await using (var check = NewDb(options))
        {
            var target = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == targetId);
            Assert.Equal(8750m, target.Installments.Sum(i => i.Amount));
            // Listede olmayan sapmış kayda DOKUNULMADI (2 x 2000 = 4000, 5000 değil).
            var other = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == otherId);
            Assert.Equal(4000m, other.Installments.Sum(i => i.Amount));
        }
    }
}

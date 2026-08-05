using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DEPLOY BLOCKER REGRESYONLARI (5 Ağu 2026 denetimi — altıncı tur).
///
/// <list type="number">
/// <item>RANDEVU TAMAMLAMA MÜŞTERİNİN TÜM BEKLEYEN SATIŞLARINI ONAYLIYORDU: A randevusu
/// tamamlandığında B satışı da cariye borç yazılıyor, B'nin seansları/primi HENÜZ VERİLMEMİŞ bir
/// hizmet için oluşuyordu.</item>
/// <item>SATIŞ KALEMİNİN PERSONELİ ŞUBE KAPSAMI DIŞINDAN SEÇİLEBİLİYORDU: Şube A yöneticisi Şube
/// B'nin personelini satışa bağlayıp ona prim tahakkuk ettirebiliyordu.</item>
/// <item>BEKLEME LİSTESİ OLUŞTURMADA KAPSAM HİÇ DENETLENMİYORDU: başka kurumun/şubenin müşteri,
/// personel, hizmet ve seans kimlikleri olduğu gibi kaydediliyordu (BOLA).</item>
/// <item>AÇILIŞTAKİ TAKSİT BAKIMI SESSİZCE GEÇİYORDU: hedef listesi boşken tüm sapmış kayıtları
/// tarıyor, hatalı kimliği atlıyor, onaramadığında "0 onarıldı" deyip deployment'ı başarılı
/// gösteriyordu.</item>
/// </list>
/// </summary>
public sealed class DeployBlockerRoundSixTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AdisyonService NewAdisyon(GuzellikDbContext db, ICurrentUser actor) =>
        new(db, new NoopAuditLogger(), actor, new CustomerAccountService(db, new NoopAuditLogger(), actor),
            new AllowAllFeatureService());

    private static AppointmentService NewAppointments(GuzellikDbContext db, ICurrentUser actor) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), null!, new CapturingJobQueue(),
            new NoopAppNotificationService(), actor, NewAdisyon(db, actor),
            new CustomerAccountService(db, new NoopAuditLogger(), actor));

    private static WaitlistService NewWaitlist(GuzellikDbContext db, ICurrentUser actor) =>
        new(db, new NoopAuditLogger(), new AllowAllFeatureService(), new NoopAppNotificationService(), actor, null!);

    private sealed record Seed(
        Guid TenantId, Guid BranchA, Guid BranchB,
        Guid CustomerA, Guid StaffA, Guid ServiceA, Guid ServiceB2,
        Guid CustomerB, Guid StaffB, Guid ServiceB);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Blocker6 QA", $"blocker6-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
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
        // Şube A'da İKİ hizmet: "yalnız bağlı satış onaylanır" senaryosu iki ayrı satış ister.
        var serviceA = new ServiceDefinition(tenant.Id, a.Id, "A Hizmeti", 60, 1000m, "Cilt");
        var serviceA2 = new ServiceDefinition(tenant.Id, a.Id, "A2 Hizmeti", 45, 2000m, "Epilasyon");
        var serviceB = new ServiceDefinition(tenant.Id, b.Id, "B Hizmeti", 60, 1500m, "Cilt");
        db.ServiceDefinitions.AddRange(serviceA, serviceA2, serviceB);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, a.Id, b.Id, customerA.Id, staffA.Id, serviceA.Id, serviceA2.Id,
            customerB.Id, staffB.Id, serviceB.Id);
    }

    private static CreateAppointmentWithSaleRequest WithSale(
        Seed seed, Guid serviceId, int hourOffset, Guid? saleStaffId = null) =>
        new(new CreateAppointmentRequest(seed.BranchA, seed.CustomerA, seed.StaffA, serviceId,
                DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(45), 0m, null),
            new AppointmentCatalogSaleDto(serviceId, null, saleStaffId ?? seed.StaffA));

    // ── 1) Randevu tamamlanınca YALNIZ kendi satışı onaylanır ─────────────────────────────

    /// <summary>
    /// ASIL İDDİA: aynı müşteride A ve B satış+randevusu açıkken A randevusu tamamlanınca YALNIZ
    /// A satışı cariye işlenir. B satışı açık kalır; B için borç, seans, stok ya da prim oluşmaz.
    /// </summary>
    [Fact]
    public async Task CompleteAppointment_ApprovesOnlyItsOwnSale_LeavesOtherPendingSaleOpen()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid appointmentA, saleA, saleB;

        await using (var db = NewDb(options))
        {
            var service = NewAppointments(db, actor);
            var createdA = await service.CreateWithSaleAsync(seed.TenantId, WithSale(seed, seed.ServiceA, 3));
            Assert.True(createdA.IsSuccess, createdA.IsFailure ? createdA.Error.Message : null);
            appointmentA = createdA.Value!.Id;

            var createdB = await service.CreateWithSaleAsync(seed.TenantId, WithSale(seed, seed.ServiceB2, 8));
            Assert.True(createdB.IsSuccess, createdB.IsFailure ? createdB.Error.Message : null);

            var sales = await db.Adisyonlar.AsNoTracking().Include(x => x.Items).ToListAsync();
            Assert.Equal(2, sales.Count);
            saleA = sales.Single(s => s.Items.Any(i => i.RefId == seed.ServiceA)).Id;
            saleB = sales.Single(s => s.Items.Any(i => i.RefId == seed.ServiceB2)).Id;
        }

        await using (var db = NewDb(options))
        {
            var done = await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentA,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var sales = await check.Adisyonlar.AsNoTracking()
                .Select(a => new { a.Id, a.Status, a.CustomerAccountId }).ToListAsync();

            var processed = sales.Single(s => s.Id == saleA);
            Assert.Equal(AdisyonStatus.Approved, processed.Status);
            Assert.NotNull(processed.CustomerAccountId);

            var untouched = sales.Single(s => s.Id == saleB);
            Assert.Equal(AdisyonStatus.Open, untouched.Status);
            Assert.Null(untouched.CustomerAccountId);

            // Tek cari (A'nın satışı) açıldı; B'nin borcu doğmadı.
            var account = Assert.Single(await check.CustomerAccounts.AsNoTracking().ToListAsync());
            Assert.Equal(1000m, account.TotalAmount);

            // B'nin seansı ve primi de OLUŞMADI (hizmet henüz verilmedi).
            Assert.Empty(await check.CustomerPackageSessions.AsNoTracking()
                .Where(s => s.ServiceDefinitionId == seed.ServiceB2).ToListAsync());
            Assert.Empty(await check.StaffCommissions.AsNoTracking()
                .Where(c => c.SourceAdisyonId == saleB).ToListAsync());
        }
    }

    /// <summary>Tek bekleyen satış varsa akış bozulmaz: randevu tamamlanınca o satış işlenir.</summary>
    [Fact]
    public async Task CompleteAppointment_WithSinglePendingSale_StillApprovesIt()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var created = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId, WithSale(seed, seed.ServiceA, 3));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            appointmentId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var done = await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var sale = Assert.Single(await check.Adisyonlar.AsNoTracking().ToListAsync());
            Assert.Equal(AdisyonStatus.Approved, sale.Status);
            Assert.NotNull(sale.CustomerAccountId);
        }
    }

    // ── 2) Satış kaleminin personeli şube kapsamında olmalı ───────────────────────────────

    /// <summary>
    /// ASIL İDDİA: Şube A'ya sabitlenmiş yönetici, satış kalemine Şube B'nin personelini
    /// bağlayamaz — istek reddedilir ve randevu/satış/prim satırı OLUŞMAZ.
    /// </summary>
    [Fact]
    public async Task CreateWithSale_PinnedRole_CannotAssignOtherBranchSalesStaff()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed, seed.ServiceA, 3, saleStaffId: seed.StaffB));

        Assert.True(result.IsFailure, "Baska subenin personeli satis kalemine baglanabildi.");
        Assert.Equal("Validation", result.Error.Code);
        Assert.Empty(await db.Appointments.ToListAsync());
        Assert.Empty(await db.Adisyonlar.ToListAsync());
        Assert.Empty(await db.StaffCommissions.ToListAsync());
    }

    /// <summary>Kendi şubesinin personeliyle akış bozulmamalı (kural fazla katı olmamalı).</summary>
    [Fact]
    public async Task CreateWithSale_PinnedRole_AcceptsOwnBranchSalesStaff()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed, seed.ServiceA, 3, saleStaffId: seed.StaffA));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    /// <summary>KURUM SAHİBİ şubeler arası çalışmayı sürdürür: kural yalnız sabitlenmiş rollere uygulanır.</summary>
    [Fact]
    public async Task CreateWithSale_InstitutionOwner_MayUseAnyBranchSalesStaff()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            WithSale(seed, seed.ServiceA, 3, saleStaffId: seed.StaffB));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    /// <summary>
    /// KANONİK KAPI DA KAPALI: adisyon ucu doğrudan çağrıldığında da başka şubenin personeli
    /// kaleme bağlanamaz (atomik uçtaki erken kontrol tek başına yeterli sayılmamalı).
    /// </summary>
    [Fact]
    public async Task AddAdisyonItem_PinnedRole_RejectsOtherBranchStaff()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var adisyon = NewAdisyon(db, actor);
        var created = await adisyon.CreateAsync(seed.TenantId,
            new CreateAdisyonRequest(seed.BranchA, seed.CustomerA, null, null, ForceNew: true));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);

        var added = await adisyon.AddItemAsync(seed.TenantId, created.Value!.Id,
            new AddAdisyonItemRequest(AdisyonItemType.Service, seed.ServiceA, "A Hizmeti", 1, 1000m, seed.StaffB, false));

        Assert.True(added.IsFailure, "Baska subenin personeli adisyon kalemine baglanabildi.");
        Assert.Equal("Validation", added.Error.Code);
        Assert.Empty(await db.AdisyonItems.ToListAsync());
    }

    // ── 3) Bekleme listesi kapsam denetimi ────────────────────────────────────────────────

    private static CreateWaitlistRequest Waitlist(
        Guid customerId, Guid? serviceId, Guid? staffId, Guid? branchId, Guid? sessionId = null) =>
        new(customerId, serviceId, staffId, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)), null, branchId,
            SourceCustomerPackageSessionId: sessionId);

    /// <summary>Başka KURUMUN müşterisiyle bekleme kaydı açılamaz (BOLA).</summary>
    [Fact]
    public async Task CreateWaitlist_ForeignTenantCustomer_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid foreignCustomerId;

        await using (var db = NewDb(options))
        {
            var other = new Tenant("Yabanci", $"yabanci-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = other.AddBranch("Merkez", "İzmir", true);
            db.Tenants.Add(other);
            await db.SaveChangesAsync();
            var customer = new Customer(other.Id, branch.Id, "YABANCI MUSTERI", "0555 777 88 99", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();
            foreignCustomerId = customer.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                Waitlist(foreignCustomerId, null, null, seed.BranchA));

            Assert.True(result.IsFailure, "Baska kurumun musterisiyle bekleme kaydi acilabildi.");
            Assert.Equal("NotFound", result.Error.Code);
            Assert.Empty(await db.WaitlistEntries.ToListAsync());
        }
    }

    public static TheoryData<string> ForeignWaitlistFields => new() { "customer", "staff", "service" };

    /// <summary>Şubeye sabitlenmiş rol, başka şubenin müşteri/personel/hizmetini bağlayamaz.</summary>
    [Theory]
    [MemberData(nameof(ForeignWaitlistFields))]
    public async Task CreateWaitlist_PinnedRole_CannotBindOtherBranchEntities(string field)
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA);

        await using var db = NewDb(options);
        var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId, Waitlist(
            field == "customer" ? seed.CustomerB : seed.CustomerA,
            field == "service" ? seed.ServiceB : seed.ServiceA,
            field == "staff" ? seed.StaffB : seed.StaffA,
            seed.BranchA));

        Assert.True(result.IsFailure, $"Baska subenin {field} kaydiyla bekleme kaydi acilabildi.");
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Empty(await db.WaitlistEntries.ToListAsync());
    }

    /// <summary>Başka KURUMUN şube kimliği gönderilirse kayıt açılmaz.</summary>
    [Fact]
    public async Task CreateWaitlist_ForeignBranch_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, null);
        Guid foreignBranchId;

        await using (var db = NewDb(options))
        {
            var other = new Tenant("Yabanci2", $"yabanci2-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = other.AddBranch("Merkez", "İzmir", true);
            db.Tenants.Add(other);
            await db.SaveChangesAsync();
            foreignBranchId = branch.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                Waitlist(seed.CustomerA, seed.ServiceA, seed.StaffA, foreignBranchId));

            Assert.True(result.IsFailure, "Baska kurumun subesiyle bekleme kaydi acilabildi.");
            Assert.Equal("NotFound", result.Error.Code);
            Assert.Empty(await db.WaitlistEntries.ToListAsync());
        }
    }

    /// <summary>Şubeye sabitlenmiş rolde gövdedeki şube YOK SAYILIR, kullanıcının şubesine çekilir.</summary>
    [Fact]
    public async Task CreateWaitlist_PinnedRole_ForcesOwnBranch()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.BranchA);

        await using var db = NewDb(options);
        var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
            Waitlist(seed.CustomerA, seed.ServiceA, seed.StaffA, seed.BranchB));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(seed.BranchA, (await db.WaitlistEntries.SingleAsync()).BranchId);
    }

    /// <summary>Bakiyesi tükenmiş seans bekleme kaydına kaynak gösterilemez.</summary>
    [Fact]
    public async Task CreateWaitlist_ExhaustedSession_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid sessionId;

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "Paket", 1000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            var session = new CustomerPackageSession(seed.TenantId, seed.CustomerA, account.Id, Guid.Empty, seed.ServiceA, 1);
            Assert.True(session.TryConsume());   // tek seans harcandı → bakiye 0
            db.CustomerPackageSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                Waitlist(seed.CustomerA, seed.ServiceA, seed.StaffA, seed.BranchA, sessionId));

            Assert.True(result.IsFailure, "Bakiyesi bitmis seans kaynak gosterilebildi.");
            Assert.Equal("Validation", result.Error.Code);
            Assert.Empty(await db.WaitlistEntries.ToListAsync());
        }
    }

    /// <summary>İPTAL EDİLMİŞ satışın seansı kaynak olamaz: yer açıldığında karşılıksız randevu doğardı.</summary>
    [Fact]
    public async Task CreateWaitlist_SessionOfCancelledSale_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid sessionId;

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "Iptal edilmis", 1000m, 0m);
            account.CancelSale("test");
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            var session = new CustomerPackageSession(seed.TenantId, seed.CustomerA, account.Id, Guid.Empty, seed.ServiceA, 3);
            db.CustomerPackageSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                Waitlist(seed.CustomerA, seed.ServiceA, seed.StaffA, seed.BranchA, sessionId));

            Assert.True(result.IsFailure, "Iptal edilmis satisin seansi kaynak gosterilebildi.");
            Assert.Equal("Validation", result.Error.Code);
            Assert.Empty(await db.WaitlistEntries.ToListAsync());
        }
    }

    /// <summary>Geçerli seans kabul edilir — kural meşru akışı kırmamalı.</summary>
    [Fact]
    public async Task CreateWaitlist_UsableSession_IsAccepted()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        Guid sessionId;

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "Paket", 1000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            var session = new CustomerPackageSession(seed.TenantId, seed.CustomerA, account.Id, Guid.Empty, seed.ServiceA, 4);
            db.CustomerPackageSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewWaitlist(db, actor).CreateAsync(seed.TenantId,
                Waitlist(seed.CustomerA, seed.ServiceA, seed.StaffA, seed.BranchA, sessionId));

            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(sessionId, (await db.WaitlistEntries.SingleAsync()).SourceCustomerPackageSessionId);
        }
    }

    // ── 4) Taksit bakımı: hedefsiz/uyuşmayan/eksik → fail-fast ────────────────────────────

    private static IServiceProvider NewServices(DbContextOptions<GuzellikDbContext> options) =>
        new ServiceCollection()
            .AddSingleton<ILoggerFactory>(NullLoggerFactory.Instance)
            .AddScoped(_ => NewDb(options))
            .BuildServiceProvider();

    private static IConfiguration Config(params (string Key, string Value)[] entries) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(entries.ToDictionary(e => e.Key, e => (string?)e.Value))
            .Build();

    /// <summary>
    /// Geçersiz hedef listeleri. Boş/bozuk kimliklerin yanında BOŞ TOKEN'lar da vardır: eskiden
    /// <c>RemoveEmptyEntries</c> yüzünden "id1,,id2", "id1," ve ",id1" sessizce kabul ediliyordu —
    /// finansal bir bakım ayarındaki yazım hatası fark edilmeden geçiyordu. Mükerrer kimlik de
    /// hatadır: sessizce atlamak, operatörün yanlış listesini "uygulandı" gibi gösterirdi.
    /// </summary>
    public static TheoryData<string?> InvalidTargetLists => new()
    {
        null,
        "",
        "   ",
        "not-a-guid",
        "00000000-0000-0000-0000-000000000000",
        "019f0000-0000-7000-8000-000000000001,,019f0000-0000-7000-8000-000000000002",
        "019f0000-0000-7000-8000-000000000001,",
        ",019f0000-0000-7000-8000-000000000001",
        "019f0000-0000-7000-8000-000000000001,019f0000-0000-7000-8000-000000000001",
    };

    /// <summary>
    /// BAYRAK TEK BAŞINA YETMEZ: hedef listesi boş ya da bozuksa açılış BAŞARISIZ olur. Eskiden
    /// boş liste "sapmış tüm kayıtları tara" anlamına geliyordu; hatalı kimlik ise sessizce atılıyordu.
    /// </summary>
    [Theory]
    [MemberData(nameof(InvalidTargetLists))]
    public async Task InstallmentMaintenance_WithoutValidTargets_FailsStartup(string? targets)
    {
        var options = NewOptions();
        var entries = new List<(string, string)> { ("Maintenance:RepairInstallmentPlanDrift", "true") };
        if (targets is not null) entries.Add(("Maintenance:RepairInstallmentPlanAccountIds", targets));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            DatabaseBootstrap.RepairInstallmentPlanDriftAsync(NewServices(options), Config([.. entries])));
    }

    /// <summary>Hedef verilmiş ama beklenen değerleri yoksa da açılış durur (doğrulanmamış kayda dokunulmaz).</summary>
    [Fact]
    public async Task InstallmentMaintenance_TargetWithoutExpectedValues_FailsStartup()
    {
        var options = NewOptions();
        var accountId = Guid.CreateVersion7();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            DatabaseBootstrap.RepairInstallmentPlanDriftAsync(NewServices(options), Config(
                ("Maintenance:RepairInstallmentPlanDrift", "true"),
                ("Maintenance:RepairInstallmentPlanAccountIds", accountId.ToString()))));
    }

    /// <summary>Bayrak kapalıysa (varsayılan) hiçbir doğrulama yapılmaz ve açılış normal ilerler.</summary>
    [Fact]
    public async Task InstallmentMaintenance_Disabled_IsNoOp()
    {
        var options = NewOptions();
        await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(NewServices(options), Config(
            ("Maintenance:RepairInstallmentPlanDrift", "false"),
            ("Maintenance:RepairInstallmentPlanAccountIds", "bozuk-guid")));
    }

    /// <summary>Sapmış bir cari kurar (plan 8.500'de kalmış, toplam 8.750'ye çıkmış).</summary>
    private static async Task<Guid> SeedDriftedAccountAsync(DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        var account = new CustomerAccount(seed.TenantId, seed.BranchA, seed.CustomerA, null, "Sapmış satış", 8500m, 0m);
        account.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(20)));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();
        account.ChangeTotal(8750m, 0m);      // plan bilerek yeniden kurulmadı
        await db.SaveChangesAsync();
        return account.Id;
    }

    public static TheoryData<string> MismatchedFields => new()
        { "tenant", "total", "deposit", "financed", "planTotal", "count" };

    /// <summary>
    /// ASIL İDDİA: beklenen tuple'ın TEK bir alanı bile tutmuyorsa hiçbir veri değiştirilmeden
    /// açılış durur. Yanlış kimlik girilmesi ya da kaydın arada değişmesi sessiz bir mutasyona
    /// dönüşemez.
    /// </summary>
    [Theory]
    [MemberData(nameof(MismatchedFields))]
    public async Task InstallmentMaintenance_ExpectedTupleMismatch_ChangesNothing(string field)
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await SeedDriftedAccountAsync(options, seed);

        var target = new DatabaseBootstrap.InstallmentPlanRepairTarget(
            accountId,
            field == "tenant" ? Guid.CreateVersion7() : seed.TenantId,
            field == "total" ? 9999m : 8750m,
            field == "deposit" ? 100m : 0m,
            field == "financed" ? 9999m : 8750m,
            field == "planTotal" ? 1m : 8500m,
            field == "count" ? 7 : 4);

        await using (var db = NewDb(options))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [target]));
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == accountId);
            Assert.Equal(8500m, account.Installments.Sum(i => i.Amount));   // plana DOKUNULMADI
        }
    }

    /// <summary>
    /// KISMİ HATA YUTULMAZ: hedeflerden biri bulunamazsa istisna yükselir (eskiden loglanıp
    /// diğerlerine devam ediliyordu ve dönen sayı "başarı" gibi okunuyordu).
    /// </summary>
    [Fact]
    public async Task InstallmentMaintenance_MissingTarget_FailsInsteadOfSkipping()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await SeedDriftedAccountAsync(options, seed);
        var missingId = Guid.CreateVersion7();

        await using var db = NewDb(options);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                new DatabaseBootstrap.InstallmentPlanRepairTarget(accountId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4),
                new DatabaseBootstrap.InstallmentPlanRepairTarget(missingId, seed.TenantId, 100m, 0m, 100m, 50m, 2)]));
    }

    /// <summary>Beklenen tuple tutuyorsa onarım uygulanır ve onarılan sayı hedef sayısına eşittir.</summary>
    [Fact]
    public async Task InstallmentMaintenance_MatchingTuple_RepairsExactlyTheTargets()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await SeedDriftedAccountAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var repaired = await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                new DatabaseBootstrap.InstallmentPlanRepairTarget(accountId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4)]);
            Assert.Equal(1, repaired);
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == accountId);
            Assert.Equal(4, account.Installments.Count);
            Assert.Equal(8750m, account.Installments.Sum(i => i.Amount));
        }
    }
}

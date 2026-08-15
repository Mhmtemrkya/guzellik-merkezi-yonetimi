using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// YAŞAM DÖNGÜSÜ + KURUM BÜTÜNLÜĞÜ — mantık denetiminde bulunan açıkların regresyon koruması.
///
/// <list type="number">
/// <item>Satış ile randevu ayrı ayrı doğrulanıyor ama BİRBİRİYLE eşleştirilmiyordu: "A hizmetini
/// sat + B hizmetine randevu aç" kabul ediliyor, randevu A'nın fişine bağlanıyor ve tahsilat
/// A'nın carisine gidiyordu.</item>
/// <item>Randevunun bağlandığı müşteri/şube/personel/hizmet hiç doğrulanmıyordu (DB'de bileşik
/// TenantId+Id bütünlüğü de yok) → başka kurumun kayıtlarına bağlı randevu açılabiliyordu.</item>
/// <item>Açık satış fişi silinince/iptal edilince ondan doğan randevu takvimde yaşamaya devam
/// ediyordu: dayanağı olmayan randevu tamamlanınca ne satış ne seans bulunuyordu.</item>
/// <item>Adisyon kalemi de doğrulanmıyordu: başka kurumun personeli/hizmeti kaleme bağlanabiliyordu.</item>
/// <item>Silinmiş paket/hediye çeki onayda SESSİZCE atlanıyordu: bedel tahakkuk ediyor ama seans
/// açılmıyor, indirim uygulanıyor ama çekin bakiyesi düşmüyordu.</item>
/// </list>
/// </summary>
public sealed class LifecycleAndScopeIntegrityTests
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
            null!, new CapturingJobQueue(), null!, user, NewAdisyon(db),
            new CustomerAccountService(db, new NoopAuditLogger(), user));
    }

    private sealed record Seed(
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceA, Guid ServiceB,
        // Başka kuruma ait kayıtlar — saldırı hedefleri.
        Guid ForeignTenantId, Guid ForeignBranchId, Guid ForeignCustomerId, Guid ForeignStaffId, Guid ForeignServiceId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Yasam QA", $"yasam-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        var foreign = new Tenant("Yabanci Kurum", $"yabanci-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var foreignBranch = foreign.AddBranch("Yabancı Şube", "Ankara", true);
        db.Tenants.AddRange(tenant, foreign);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "YAŞAM MÜŞTERİ", "0555 444 33 22", null);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        var serviceA = new ServiceDefinition(tenant.Id, branch.Id, "A Hizmeti", 60, 1000m, "Cilt");
        var serviceB = new ServiceDefinition(tenant.Id, branch.Id, "B Hizmeti", 45, 2000m, "Epilasyon");
        db.Customers.Add(customer);
        db.StaffMembers.Add(staff);
        db.ServiceDefinitions.AddRange(serviceA, serviceB);

        var foreignCustomer = new Customer(foreign.Id, foreignBranch.Id, "YABANCI MÜŞTERİ", "0555 111 00 99", null);
        var foreignStaff = new StaffMember(foreign.Id, foreignBranch.Id, "Yabancı Uzman", "Uzman");
        var foreignService = new ServiceDefinition(foreign.Id, foreignBranch.Id, "Yabancı Hizmet", 30, 900m, "Cilt");
        db.Customers.Add(foreignCustomer);
        db.StaffMembers.Add(foreignStaff);
        db.ServiceDefinitions.Add(foreignService);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, serviceA.Id, serviceB.Id,
            foreign.Id, foreignBranch.Id, foreignCustomer.Id, foreignStaff.Id, foreignService.Id);
    }

    private static CreateAppointmentRequest AppointmentRequest(Seed seed, Guid serviceId, int hourOffset = 3) =>
        new(seed.BranchId, seed.CustomerId, seed.StaffId, serviceId,
            DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(45), 0m, null);

    // ── 1) Satılan katalog öğesi randevunun hizmetini karşılamalı ──────────────────────────

    /// <summary>"A hizmetini sat + B hizmetine randevu aç" reddedilir (ne satış ne randevu oluşur).</summary>
    [Fact]
    public async Task CreateWithSale_ServiceMismatch_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId,
            new CreateAppointmentWithSaleRequest(
                AppointmentRequest(seed, seed.ServiceB),
                new AppointmentCatalogSaleDto(seed.ServiceA, null, seed.StaffId)));

        Assert.True(result.IsFailure, "Satılan hizmet randevunun hizmetinden farklı olduğu hâlde kabul edildi.");
        Assert.Equal("Validation", result.Error.Code);
        Assert.Empty(await db.Appointments.ToListAsync());
        Assert.Empty(await db.Adisyonlar.ToListAsync());
    }

    /// <summary>Randevunun hizmetini İÇERMEYEN paketle satış reddedilir.</summary>
    [Fact]
    public async Task CreateWithSale_PackageDoesNotCoverService_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid packageId;

        await using (var db = NewDb(options))
        {
            var package = new ServicePackage(seed.TenantId, seed.BranchId, "A Paketi", 5000m, 0m, 0);
            package.ReplaceItems([(seed.ServiceA, 5, 1000m)]);
            db.ServicePackages.Add(package);
            await db.SaveChangesAsync();
            packageId = package.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    AppointmentRequest(seed, seed.ServiceB),
                    new AppointmentCatalogSaleDto(null, packageId, seed.StaffId)));

            Assert.True(result.IsFailure, "Randevunun hizmetini içermeyen paket satılabildi.");
            Assert.Equal("Validation", result.Error.Code);
            Assert.Empty(await db.Appointments.ToListAsync());
        }
    }

    /// <summary>Eşleşen satış + randevu normal akışta çalışmayı sürdürür (kural fazla katı olmamalı).</summary>
    [Fact]
    public async Task CreateWithSale_MatchingService_Succeeds()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId,
            new CreateAppointmentWithSaleRequest(
                AppointmentRequest(seed, seed.ServiceA),
                new AppointmentCatalogSaleDto(seed.ServiceA, null, seed.StaffId)));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var appointment = await db.Appointments.SingleAsync();
        var adisyon = await db.Adisyonlar.SingleAsync();
        Assert.Equal(adisyon.Id, appointment.SourceAdisyonId);
    }

    // ── 2) Kurum bütünlüğü: başka kurumun kaydına randevu bağlanamaz ───────────────────────

    public static TheoryData<string> ForeignFields => new() { "customer", "branch", "staff", "service" };

    [Theory]
    [MemberData(nameof(ForeignFields))]
    public async Task CreateAppointment_WithForeignTenantEntity_IsRejected(string field)
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        var request = new CreateAppointmentRequest(
            field == "branch" ? seed.ForeignBranchId : seed.BranchId,
            field == "customer" ? seed.ForeignCustomerId : seed.CustomerId,
            field == "staff" ? seed.ForeignStaffId : seed.StaffId,
            field == "service" ? seed.ForeignServiceId : seed.ServiceA,
            DateTime.UtcNow.AddHours(4), DateTime.UtcNow.AddHours(4).AddMinutes(45), 100m, null);

        await using var db = NewDb(options);
        var result = await NewAppointments(db).CreateAsync(seed.TenantId, request);

        Assert.True(result.IsFailure, $"Başka kuruma ait {field} ile randevu açılabildi.");
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Empty(await db.Appointments.ToListAsync());
    }

    /// <summary>Adisyon kalemi de doğrulanır: başka kurumun personeli/hizmeti bağlanamaz.</summary>
    [Fact]
    public async Task AddItem_WithForeignTenantStaffOrService_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var created = await NewAdisyon(db).CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, null, null, ForceNew: true));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var service = NewAdisyon(db);

            var foreignStaff = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Service, seed.ServiceA, "A Hizmeti", 1, 1000m, seed.ForeignStaffId, false));
            Assert.True(foreignStaff.IsFailure, "Başka kurumun personeli kaleme bağlanabildi.");
            Assert.Equal("Validation", foreignStaff.Error.Code);

            var foreignService = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Service, seed.ForeignServiceId, "Yabancı Hizmet", 1, 900m, null, false));
            Assert.True(foreignService.IsFailure, "Başka kurumun hizmeti satılabildi.");
            Assert.Equal("Validation", foreignService.Error.Code);

            // Kendi kurumunun kaydı geçmeye devam etmeli.
            var own = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(AdisyonItemType.Service, seed.ServiceA, "A Hizmeti", 1, 1000m, seed.StaffId, false));
            Assert.True(own.IsSuccess, own.IsFailure ? own.Error.Message : null);
        }
    }

    // ── 3) Satış silinince/iptal edilince bağlı randevu ortada kalmaz ──────────────────────

    /// <summary>Randevu + bekleyen satış açar; (randevuId, adisyonId) döndürür.</summary>
    private static async Task<(Guid AppointmentId, Guid AdisyonId)> CreateSaleWithAppointmentAsync(
        DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        var created = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId,
            new CreateAppointmentWithSaleRequest(
                AppointmentRequest(seed, seed.ServiceA),
                new AppointmentCatalogSaleDto(seed.ServiceA, null, seed.StaffId)));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        var adisyon = await db.Adisyonlar.AsNoTracking().SingleAsync();
        return (created.Value!.Id, adisyon.Id);
    }

    [Fact]
    public async Task DeleteOpenSale_AlsoClosesBoundAppointment()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var (appointmentId, adisyonId) = await CreateSaleWithAppointmentAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var deleted = await NewAdisyon(db).DeleteAsync(seed.TenantId, adisyonId);
            Assert.True(deleted.IsSuccess, deleted.IsFailure ? deleted.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            // Randevu soft-delete edilir → varsayılan süzgeçle görünmez.
            Assert.Empty(await check.Appointments.Where(a => a.Id == appointmentId).ToListAsync());
        }
    }

    [Fact]
    public async Task CancelOpenSale_AlsoCancelsBoundAppointment()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var (appointmentId, adisyonId) = await CreateSaleWithAppointmentAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var cancelled = await NewAdisyon(db).CancelAsync(seed.TenantId, adisyonId);
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Cancelled, appointment.Status);
        }
    }

    // ── 5) Silinmiş paket / hediye çeki onayı durdurur ─────────────────────────────────────

    [Fact]
    public async Task Approve_WithDeletedPackage_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var package = new ServicePackage(seed.TenantId, seed.BranchId, "10 Seans Paket", 2000m, 0m, 0);
            package.ReplaceItems([(seed.ServiceA, 10, 200m)]);
            db.ServicePackages.Add(package);
            await db.SaveChangesAsync();

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.PackageSale, package.Id, "10 Seans Paket", 1, 2000m, null, false));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;

            // Fiş açıkken paket silinir (katalog temizliği).
            package.SoftDelete();
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsFailure, "Silinmiş paket onaylandı: bedel tahakkuk eder ama seans açılmaz.");
            Assert.Equal("Validation", approved.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            // Ne borç ne seans oluşmalı; fiş açık kalır (kullanıcı kalemi düzeltebilsin).
            Assert.Empty(await check.CustomerAccounts.ToListAsync());
            Assert.Empty(await check.CustomerPackageSessions.ToListAsync());
            Assert.Equal(AdisyonStatus.Open, (await check.Adisyonlar.SingleAsync()).Status);
        }
    }

    [Fact]
    public async Task Approve_WithDeletedGiftCard_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId;

        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "HD-TEST01", GiftCardKind.FixedAmount, 300m, null, 1, null, null);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceA, "A Hizmeti", 1, 1000m, null, false));
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Discount, card.Id, "Hediye çeki", 1, 300m, null, false));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;

            card.SoftDelete();
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsFailure, "Silinmiş hediye çekiyle indirim uygulandı: bakiye düşmeden bedava indirim.");
            Assert.Equal("Validation", approved.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            Assert.Empty(await check.CustomerAccounts.ToListAsync());
        }
    }

    /// <summary>Açık fişte kullanılan hediye çeki silinemez (sorunun kaynağı kapatılır).</summary>
    [Fact]
    public async Task DeleteGiftCard_UsedInOpenAdisyon_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid cardId;

        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "HD-TEST02", GiftCardKind.FixedAmount, 300m, null, 1, null, null);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            cardId = card.Id;

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Discount, card.Id, "Hediye çeki", 1, 300m, null, false));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var user = new TestCurrentUser(UserRole.InstitutionOwner);
            var service = new GiftCardService(db, new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser());
            var result = await service.DeleteAsync(seed.TenantId, cardId);
            Assert.True(result.IsFailure, "Açık fişte kullanılan hediye çeki silinebildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }
    }
}

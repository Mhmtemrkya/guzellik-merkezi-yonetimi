using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÜCRETSİZ RANDEVU HAKKI İSTENEN HİZMETE AİT OLMALI.
///
/// <para>
/// Eski kontrol yalnız "müşterinin herhangi bir satışı var mı" diye bakıyordu: kalan seansı 0 olan
/// paket, BAŞKA hizmete ait paket, hatta yalnız ürün satışı bile paketten randevu hakkı veriyordu.
/// Şampuan alan müşteri bakım hizmetine randevu alıp hizmeti bedava alabiliyordu (tamamlamada
/// düşecek seans bulunamıyor, randevu yine tamamlanıyordu).
/// </para>
///
/// <para>
/// Ayrıca seans bağı REZERVASYON değildi: kalan 1 seansa üç gelecek randevu bağlanabiliyordu.
/// </para>
/// </summary>
public sealed class AppointmentEntitlementTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AppointmentService NewService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
        // Bekleme listesi / bildirim yalnız iptal ve personel-atama yollarında kullanılır; bu
        // testler o yollara girmez (personele bağlı TenantUser yok → bildirim erken döner).
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon);
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceA, Guid ServiceB);

    /// <summary>Müşterinin YALNIZ A hizmetine ait 1 seansı var; B hizmetinde hiç hakkı yok.</summary>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Hak QA", $"hak-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "HAK MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        db.StaffMembers.Add(staff);
        var serviceA = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m, "Cilt");
        var serviceB = new ServiceDefinition(tenant.Id, branch.Id, "Lazer Epilasyon", 45, 800m, "Epilasyon");
        db.ServiceDefinitions.AddRange(serviceA, serviceB);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "A paketi", 500m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        // Yalnız A hizmeti için 1 seans hakkı.
        db.CustomerPackageSessions.Add(new CustomerPackageSession(
            tenant.Id, customer.Id, account.Id, Guid.Empty, serviceA.Id, 1));
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, serviceA.Id, serviceB.Id);
    }

    private static CreateAppointmentRequest Request(Seed seed, Guid serviceId, decimal price, int hourOffset = 2) =>
        new(seed.BranchId, seed.CustomerId, seed.StaffId, serviceId,
            DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset + 1), price, null);

    /// <summary>Hakkın olduğu hizmet: randevu açılır ve KAYNAK SEANS bağlanır.</summary>
    [Fact]
    public async Task CreateAsync_FreeAppointment_BindsSessionOfRequestedService()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).CreateAsync(seed.TenantId, Request(seed, seed.ServiceA, 0m));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var appointment = await db.Appointments.SingleAsync();
        Assert.NotNull(appointment.SourceCustomerPackageSessionId);
    }

    /// <summary>BAŞKA hizmete ait paket, istenen hizmet için ücretsiz randevu hakkı VERMEZ.</summary>
    [Fact]
    public async Task CreateAsync_FreeAppointment_RejectedWhenServiceHasNoSession()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).CreateAsync(seed.TenantId, Request(seed, seed.ServiceB, 0m));

        Assert.True(result.IsFailure, "Hakkı olmayan hizmete ücretsiz randevu açılabildi.");
        Assert.Equal("Validation", result.Error.Code);
        Assert.Empty(await db.Appointments.ToListAsync());
    }

    /// <summary>Ücretli randevu paket hakkı istemez — mevcut satış akışı bozulmamalı.</summary>
    [Fact]
    public async Task CreateAsync_PaidAppointment_AllowedWithoutMatchingSession()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).CreateAsync(seed.TenantId, Request(seed, seed.ServiceB, 800m));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var appointment = await db.Appointments.SingleAsync();
        // Ücretli randevu seans tüketmez → kaynak bağı da kurulmaz.
        Assert.Null(appointment.SourceCustomerPackageSessionId);
    }

    /// <summary>
    /// REZERVASYON: kalan 1 seans zaten açık bir randevuya bağlıysa ikinci ücretsiz randevu
    /// açılamaz. Eskiden üçü de açılıp üçü de tamamlanabiliyordu.
    /// </summary>
    [Fact]
    public async Task CreateAsync_FreeAppointment_RejectedWhenRemainingSessionAlreadyReserved()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var service = NewService(db);

        var first = await service.CreateAsync(seed.TenantId, Request(seed, seed.ServiceA, 0m, hourOffset: 2));
        Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Message : null);

        var second = await service.CreateAsync(seed.TenantId, Request(seed, seed.ServiceA, 0m, hourOffset: 6));

        Assert.True(second.IsFailure, "Tek kalan seans iki gelecek randevuya birden bağlanabildi.");
        Assert.Equal("Validation", second.Error.Code);
        Assert.Single(await db.Appointments.ToListAsync());
    }
}

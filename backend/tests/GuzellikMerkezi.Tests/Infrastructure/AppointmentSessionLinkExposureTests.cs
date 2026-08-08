using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// RANDEVUNUN KAYNAK SEANSI LİSTE UCUNDA DA DÖNMELİ.
///
/// Müşteri geçmişi paneli ("Seanslar" ↔ "İşlemler") bir işin paketten mi karşılandığını bu
/// alandan bilir. Alan DTO'da vardı ama <c>ListAsync</c> kendi <c>.Select</c> projeksiyonunu
/// kullanıyor — orada atlanırsa istemciye sessizce null gelir ve panel "hizmet herhangi bir
/// pakette geçiyor mu" sezgisine düşer: müşteri aynı hizmeti hem paketten hem tekil satın
/// aldığında iş yanlış sekmede görünür. (Bu depoda aynı sınıf hata daha önce yaşandı:
/// ToDto güncellenip explicit projeksiyon unutuluyor.)
/// </summary>
public sealed class AppointmentSessionLinkExposureTests
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
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), user);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, accounts);
    }

    /// <summary>Paket seansına bağlı randevu, LİSTE ucunda da bağını taşımalı.</summary>
    [Fact]
    public async Task ListAsync_ExposesSourceSessionLink()
    {
        var options = NewOptions();
        Guid tenantId, customerId, sessionId, appointmentId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Seans Bagi QA", $"seans-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "Seans Bagi", "0555 444 55 66", null);
            db.Customers.Add(customer);
            var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Ece", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 60, 500m, "Epilasyon");
            db.ServiceDefinitions.Add(service);
            var package = new ServicePackage(tenant.Id, branch.Id, "Lazer Paketi", 2000m, 0m, 0);
            db.ServicePackages.Add(package);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, package.Id, "Lazer Paketi", 2000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            var session = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, package.Id, service.Id, 4);
            db.CustomerPackageSessions.Add(session);

            // Paketten karşılanan randevu → ücretsiz + kaynak seansa bağlı.
            var start = DateTime.UtcNow.AddHours(2);
            var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
                start, start.AddHours(1), 0m, null);
            appointment.LinkToPackageSession(session.Id);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            customerId = customer.Id;
            sessionId = session.Id;
            appointmentId = appointment.Id;
        }

        await using var verify = NewDb(options);
        var list = await NewService(verify).ListAsync(tenantId, null, null, new PageRequest(1, 50), customerId: customerId);

        Assert.True(list.IsSuccess, list.IsFailure ? list.Error.Message : null);
        var dto = Assert.Single(list.Value!.Items);
        Assert.Equal(appointmentId, dto.Id);
        // ASIL İDDİA: liste projeksiyonu bağı taşır (null dönerse panel sezgiye düşer).
        Assert.Equal(sessionId, dto.SourceCustomerPackageSessionId);
    }
}

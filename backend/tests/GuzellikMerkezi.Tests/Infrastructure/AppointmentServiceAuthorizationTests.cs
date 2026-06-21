using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;

namespace GuzellikMerkezi.Tests.Infrastructure;

public sealed class AppointmentServiceAuthorizationTests
{
    [Fact]
    public async Task ListAsync_WhenStaffScopeProvided_ReturnsOnlyAppointmentsLinkedToThatTenantUser()
    {
        var fixture = await SeedTwoStaffAppointmentsAsync();

        await using var db = new GuzellikDbContext(fixture.Options);
        var service = new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger());

        var result = await service.ListAsync(
            fixture.TenantId,
            null,
            null,
            new PageRequest(1, 20),
            staffTenantUserId: fixture.AliceTenantUserId);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
        var page = result.Value!;
        var item = Assert.Single(page.Items);
        Assert.Equal(fixture.AliceAppointmentId, item.Id);
        Assert.Equal(fixture.AliceStaffMemberId, item.StaffMemberId);
        Assert.Equal(1, page.TotalCount);
    }

    [Fact]
    public async Task GetAsync_WhenStaffScopeProvided_CannotReadAnotherStaffAppointment()
    {
        var fixture = await SeedTwoStaffAppointmentsAsync();

        await using var db = new GuzellikDbContext(fixture.Options);
        var service = new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger());

        var result = await service.GetAsync(
            fixture.TenantId,
            fixture.BobAppointmentId,
            staffTenantUserId: fixture.AliceTenantUserId);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
    }

    [Fact]
    public async Task ChangeStatusAsync_WhenStaffScopeProvided_CannotUpdateAnotherStaffAppointment()
    {
        var fixture = await SeedTwoStaffAppointmentsAsync();

        await using (var db = new GuzellikDbContext(fixture.Options))
        {
            var service = new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger());

            var result = await service.ChangeStatusAsync(
                fixture.TenantId,
                fixture.BobAppointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null),
                staffTenantUserId: fixture.AliceTenantUserId);

            Assert.True(result.IsFailure);
            Assert.Equal("NotFound", result.Error.Code);
        }

        await using (var verifyDb = new GuzellikDbContext(fixture.Options))
        {
            var bobAppointment = await verifyDb.Appointments.AsNoTracking().SingleAsync(a => a.Id == fixture.BobAppointmentId);
            Assert.Equal(AppointmentStatus.Scheduled, bobAppointment.Status);
        }
    }

    private static async Task<AppointmentAuthorizationFixture> SeedTwoStaffAppointmentsAsync()
    {
        var databaseRoot = new InMemoryDatabaseRoot();
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), databaseRoot)
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        Guid tenantId;
        Guid aliceTenantUserId;
        Guid bobTenantUserId;
        Guid aliceStaffMemberId;
        Guid bobStaffMemberId;
        Guid aliceAppointmentId;
        Guid bobAppointmentId;

        await using (var seedDb = new GuzellikDbContext(options))
        {
            var tenant = new Tenant("QA Beauty", "qa-beauty", "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            var aliceUser = tenant.GrantAccess("alice@qa.test", UserRole.Staff, branch.Id, "Alice Estetisyen");
            var bobUser = tenant.GrantAccess("bob@qa.test", UserRole.Staff, branch.Id, "Bob Estetisyen");

            var aliceStaff = new StaffMember(tenant.Id, branch.Id, "Alice Estetisyen", "Uzman");
            aliceStaff.LinkTenantUser(aliceUser.Id);
            var bobStaff = new StaffMember(tenant.Id, branch.Id, "Bob Estetisyen", "Uzman");
            bobStaff.LinkTenantUser(bobUser.Id);

            var aliceCustomer = new Customer(tenant.Id, branch.Id, "Alice Müşteri", "+90 555 000 00 01");
            var bobCustomer = new Customer(tenant.Id, branch.Id, "Bob Müşteri", "+90 555 000 00 02");
            var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 45, 1200m);

            var start = DateTime.UtcNow.Date.AddHours(9);
            var aliceAppointment = new Appointment(tenant.Id, branch.Id, aliceCustomer.Id, aliceStaff.Id, service.Id, start, start.AddMinutes(45), 1200m);
            var bobAppointment = new Appointment(tenant.Id, branch.Id, bobCustomer.Id, bobStaff.Id, service.Id, start.AddHours(1), start.AddHours(1).AddMinutes(45), 1200m);

            seedDb.Tenants.Add(tenant);
            seedDb.StaffMembers.AddRange(aliceStaff, bobStaff);
            seedDb.Customers.AddRange(aliceCustomer, bobCustomer);
            seedDb.ServiceDefinitions.Add(service);
            seedDb.Appointments.AddRange(aliceAppointment, bobAppointment);
            await seedDb.SaveChangesAsync();

            tenantId = tenant.Id;
            aliceTenantUserId = aliceUser.Id;
            bobTenantUserId = bobUser.Id;
            aliceStaffMemberId = aliceStaff.Id;
            bobStaffMemberId = bobStaff.Id;
            aliceAppointmentId = aliceAppointment.Id;
            bobAppointmentId = bobAppointment.Id;
        }

        return new AppointmentAuthorizationFixture(
            options,
            tenantId,
            aliceTenantUserId,
            bobTenantUserId,
            aliceStaffMemberId,
            bobStaffMemberId,
            aliceAppointmentId,
            bobAppointmentId);
    }

    private sealed record AppointmentAuthorizationFixture(
        DbContextOptions<GuzellikDbContext> Options,
        Guid TenantId,
        Guid AliceTenantUserId,
        Guid BobTenantUserId,
        Guid AliceStaffMemberId,
        Guid BobStaffMemberId,
        Guid AliceAppointmentId,
        Guid BobAppointmentId);
}

using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Security;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;

namespace GuzellikMerkezi.Tests.Infrastructure;

public sealed class StaffServiceTests
{
    [Fact]
    public async Task CreateAsync_AddsTenantUserAndLinksStaffMember()
    {
        var databaseRoot = new InMemoryDatabaseRoot();
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), databaseRoot)
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        var passwordHasher = new PasswordHasher();
        Guid tenantId;
        Guid branchId;

        await using (var seedDb = new GuzellikDbContext(options))
        {
            var tenant = new Tenant("QA Beauty", "qa-beauty", "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            seedDb.Tenants.Add(tenant);
            await seedDb.SaveChangesAsync();
            tenantId = tenant.Id;
            branchId = branch.Id;
        }

        await using (var db = new GuzellikDbContext(options))
        {
            var service = new StaffService(db, passwordHasher, new AlwaysAllowUsageService(), new NoopAuditLogger());

            var result = await service.CreateAsync(
                tenantId,
                new CreateStaffRequest(
                    branchId,
                    "Hermes Personel",
                    "Estetisyen",
                    "+90 555 000 00 01",
                    "Cilt bakımı",
                    10m,
                    true,
                    "hermes.personel@qa.test",
                    new[] { Permissions.Customers, Permissions.Appointments }));

            Assert.True(result.IsSuccess);
            var created = Assert.IsType<StaffWithCredentialsDto>(result.Value);
            Assert.NotNull(created.Credentials);
            Assert.Equal("hermes.personel@qa.test", created.Staff.Email);
            Assert.Contains(Permissions.Customers, created.Staff.Permissions);
            Assert.False(string.IsNullOrWhiteSpace(created.Credentials!.InitialPassword));
        }

        await using (var verifyDb = new GuzellikDbContext(options))
        {
            var tenantUser = await verifyDb.TenantUsers
                .AsNoTracking()
                .SingleAsync(user => user.Email == "hermes.personel@qa.test" && user.TenantId == tenantId);
            var staff = await verifyDb.StaffMembers
                .AsNoTracking()
                .SingleAsync(member => member.TenantId == tenantId && member.FullName == "Hermes Personel");

            Assert.Equal(UserRole.Staff, tenantUser.Role);
            Assert.True(tenantUser.MustChangePassword);
            Assert.Equal($"{Permissions.Customers},{Permissions.Appointments}", tenantUser.Permissions);
            Assert.Equal(tenantUser.Id, staff.TenantUserId);
        }
    }
}

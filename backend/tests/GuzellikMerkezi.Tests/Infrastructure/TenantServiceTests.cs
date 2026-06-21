using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Security;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace GuzellikMerkezi.Tests.Infrastructure;

public sealed class TenantServiceTests
{
    [Fact]
    public async Task GrantAccessAsync_AddsUserToExistingTenant()
    {
        var databaseRoot = new InMemoryDatabaseRoot();
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), databaseRoot)
            .Options;
        var passwordHasher = new PasswordHasher();
        Guid tenantId;

        await using (var seedDb = new GuzellikDbContext(options))
        {
            var tenant = new Tenant("QA Beauty", "qa-beauty", "Premium", TenantStatus.Active);
            tenant.AddBranch("Merkez", "İstanbul", true);
            var owner = tenant.GrantAccess("owner@qa.test", UserRole.InstitutionOwner, fullName: "Owner");
            owner.SetPasswordHash(passwordHasher.Hash("Guzellik123!"));
            seedDb.Tenants.Add(tenant);
            await seedDb.SaveChangesAsync();
            tenantId = tenant.Id;
        }

        await using (var db = new GuzellikDbContext(options))
        {
            var service = new TenantService(db, passwordHasher);

            var result = await service.GrantAccessAsync(
                tenantId,
                new GrantTenantAccessRequest(
                    "new-owner@qa.test",
                    "New Owner",
                    UserRole.InstitutionOwner,
                    null,
                    "Guzellik123!"));

            Assert.True(result.IsSuccess);
        }

        await using (var verifyDb = new GuzellikDbContext(options))
        {
            var grantedUser = await verifyDb.TenantUsers
                .AsNoTracking()
                .SingleAsync(user => user.Email == "new-owner@qa.test" && user.TenantId == tenantId);

            Assert.Equal(UserRole.InstitutionOwner, grantedUser.Role);
            Assert.False(string.IsNullOrWhiteSpace(grantedUser.PasswordHash));
        }
    }
}

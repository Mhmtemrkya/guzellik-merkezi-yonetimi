using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// KAPSAM SIZINTISI + SATIŞ ÖNKOŞULU (denetim raporu).
///
/// <para>1) <c>/login-scope</c> "parola HERHANGİ bir kullanıcıyla eşleşiyorsa hepsini döndür"
/// diyordu: aynı e-posta iki kurumda FARKLI parolalarla kayıtlıysa, birinin parolasını bilen
/// kişi diğer kurumun adını ve şubelerini görüyordu (giriş yine o hesabın parolasını istediği
/// için hesap ele geçirme değil — bilgi sızıntısı ve giremeyeceği kurumu listeleyen modal).</para>
///
/// <para>2) "Randevu için onaylı PAKET/HİZMET satışı olmalı" kuralı Product ve Extra kalemlerini
/// de kabul ediyordu: yalnız şampuan alan müşteri hizmet almış sayılıyordu.</para>
/// </summary>
public sealed class LoginScopeAndEntitlementTests
{
    private const string Email = "ortak@ornek.test";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AuthService NewAuth(GuzellikDbContext db) =>
        new(db, new PlainPasswordHasher(), new StubTokenService(), new FixedClock(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), null!, TestSearchIndex.Create());

    /// <summary>Aynı e-posta, iki kurum, FARKLI parolalar.</summary>
    [Fact]
    public async Task GetLoginScopeAsync_ReturnsOnlyTenantsMatchingThatPassword()
    {
        var options = NewOptions();
        Guid firstId, secondId;

        await using (var db = NewDb(options))
        {
            var first = new Tenant("Birinci", $"bir-{Guid.NewGuid():N}"[..18], "Premium", TenantStatus.Active);
            first.AddBranch("Merkez", "İstanbul", true);
            first.GrantAccess(Email, UserRole.InstitutionOwner, null, "Sahip").SetPasswordHash("parola-A");

            var second = new Tenant("İkinci", $"iki-{Guid.NewGuid():N}"[..18], "Premium", TenantStatus.Active);
            second.AddBranch("Merkez", "Ankara", true);
            second.GrantAccess(Email, UserRole.InstitutionOwner, null, "Sahip").SetPasswordHash("parola-B");

            db.Tenants.AddRange(first, second);
            await db.SaveChangesAsync();
            firstId = first.Id;
            secondId = second.Id;
        }

        await using (var db = NewDb(options))
        {
            var scope = await NewAuth(db).GetLoginScopeAsync(new LoginScopeRequest(Email, null, "parola-A"));
            Assert.True(scope.IsSuccess);
            // Yalnız parolası eşleşen kurum listelenmeli.
            var tenant = Assert.Single(scope.Value!.Tenants);
            Assert.Equal(firstId, tenant.TenantId);
            Assert.DoesNotContain(scope.Value.Tenants, t => t.TenantId == secondId);
        }
    }

    /// <summary>Yalnız ÜRÜN satışı olan müşteriye randevu açılamaz.</summary>
    [Fact]
    public async Task CreateAsync_ProductOnlySale_DoesNotSatisfySalePrerequisite()
    {
        var options = NewOptions();
        Guid tenantId, branchId, customerId, staffId, serviceId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Önkoşul", $"onk-{Guid.NewGuid():N}"[..18], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            branchId = branch.Id;

            var customer = new Customer(tenantId, branchId, "ÜRÜN MÜŞTERİ", "0555 111 22 33", null);
            db.Customers.Add(customer);
            var staff = new StaffMember(tenantId, branchId, "Uzman Elif", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(tenantId, branchId, "Cilt Bakımı", 60, 500m, "Cilt");
            db.ServiceDefinitions.Add(service);
            await db.SaveChangesAsync();
            customerId = customer.Id;
            staffId = staff.Id;
            serviceId = service.Id;

            // Onaylı ama YALNIZ ÜRÜN kalemi olan adisyon.
            var adisyon = new Adisyon(tenantId, branchId, customerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Product, Guid.CreateVersion7(), "Şampuan", 1, 250m, null, false));
            adisyon.Approve(null);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var user = new TestCurrentUser(UserRole.InstitutionOwner);
            var adisyonService = new AdisyonService(db, new NoopAuditLogger(), user,
                new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
            var service = new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
                null!, new CapturingJobQueue(), null!, user, adisyonService, null!);

            var start = DateTime.UtcNow.AddHours(2);
            var result = await service.CreateAsync(tenantId,
                new CreateAppointmentRequest(branchId, customerId, staffId, serviceId, start, start.AddHours(1), 500m, null));

            Assert.True(result.IsFailure, "Yalnız ürün satışı olan müşteriye randevu açılabildi.");
            Assert.Equal("Validation", result.Error.Code);
        }
    }
}

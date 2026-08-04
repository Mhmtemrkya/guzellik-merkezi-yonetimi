using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// BİRDEN ÇOK BEKLEYEN SATIŞTA TAHSİLAT DOĞRU CARİYE YAZILIR.
///
/// <para>
/// Randevu tamamlanınca müşterinin "ilk randevuda işle" bekleyen TÜM satışları onaylanır (Faz 2).
/// Tahsilat hedefi olarak İLK ONAYLANAN satışın carisi seçiliyordu. Senaryo: A hizmeti için
/// satış+randevu açıldı, sonra B hizmeti için satış+randevu açıldı, B randevusu ÖNCE tamamlandı →
/// B için alınan para A satışının carisine yazılıyor, B satışı ödenmemiş görünüyordu.
/// </para>
///
/// <para>
/// Gerçek MariaDB gerekir: akış satır kilitleri (<c>SELECT … FOR UPDATE</c>) ve iç içe
/// transaction/savepoint kullanır; InMemory sağlayıcı bunları yok sayar. Sunucu yoksa atlanır.
/// </para>
/// </summary>
public sealed class MultiPendingSalePaymentMySqlTests
{
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
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceA, Guid ServiceB);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Coklu Satis", $"coklu-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "ÇOKLU MÜŞTERİ", "0555 321 45 67", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        db.StaffMembers.Add(staff);
        var serviceA = new ServiceDefinition(tenant.Id, branch.Id, "A Hizmeti", 60, 1000m, "Cilt");
        var serviceB = new ServiceDefinition(tenant.Id, branch.Id, "B Hizmeti", 45, 2000m, "Epilasyon");
        db.ServiceDefinitions.AddRange(serviceA, serviceB);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, serviceA.Id, serviceB.Id);
    }

    /// <summary>Randevu + bekleyen satış açar; randevunun kimliğini döndürür.</summary>
    private static async Task<Guid> CreateSaleAndAppointmentAsync(
        MySqlTestDatabase database, Seed seed, Guid serviceId, int hourOffset)
    {
        await using var db = database.NewContext();
        var request = new CreateAppointmentWithSaleRequest(
            new CreateAppointmentRequest(
                seed.BranchId, seed.CustomerId, seed.StaffId, serviceId,
                DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(45),
                0m, null),
            new AppointmentCatalogSaleDto(serviceId, null, seed.StaffId));

        var created = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId, request);
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        return created.Value!.Id;
    }

    /// <summary>
    /// Önce A satışı+randevusu, sonra B satışı+randevusu açılır; B randevusu ÖNCE tamamlanır ve
    /// 2.000 TL tahsil edilir. Para B'nin carisine yazılmalı, A'nınki ödenmemiş kalmalı.
    /// </summary>
    [MySqlFact]
    public async Task CompleteWithPayment_PaysTheSaleOfThisAppointment_NotTheOldestPendingSale()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await CreateSaleAndAppointmentAsync(database, seed, seed.ServiceA, 2);
        var appointmentB = await CreateSaleAndAppointmentAsync(database, seed, seed.ServiceB, 6);

        await using (var db = database.NewContext())
        {
            var complete = new CompleteAppointmentRequest(null,
                new CompleteAppointmentPaymentDto(2000m, "cash", "Randevu tahsilatı", null, DateTime.UtcNow));
            var done = await NewAppointments(db).CompleteWithPaymentAsync(seed.TenantId, appointmentB, complete);
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var accounts = await check.CustomerAccounts
                .Include(a => a.Payments)
                .Where(a => a.CustomerId == seed.CustomerId)
                .ToListAsync();

            // Her satış kendi kartını açar → iki cari.
            Assert.Equal(2, accounts.Count);

            var saleB = accounts.Single(a => a.TotalAmount == 2000m);
            var saleA = accounts.Single(a => a.TotalAmount == 1000m);

            Assert.Equal(2000m, saleB.Payments.Sum(p => p.Amount));
            Assert.Equal(0m, saleA.Payments.Sum(p => p.Amount));
        }
    }
}

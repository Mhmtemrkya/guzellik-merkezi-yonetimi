using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// HAKKI OLMAYAN MÜŞTERİDE BEKLEME KAYDI RANDEVUYA DÖNEBİLMELİ.
///
/// <para>
/// Hakkı olmayan müşteride normal akış "satış + randevu"yu tek uçtan açar. Slot doluysa randevu
/// adımı düşer, satış geri alınır ve bekleme kaydına yalnız hizmet/slot bilgisi yazılır. Yer
/// açıldığında bekleme servisi ÜCRETSİZ randevu açmaya çalışıyordu ve "kullanılabilir seansı yok"
/// doğrulama hatası alıyordu — kayıt KALICI OLARAK dönüşemez hâlde kalıyordu.
/// </para>
///
/// <para>
/// Düzeltme: hak yoksa randevu satışla birlikte açılır (satış cariye şimdi işlenmez, randevu
/// tamamlanınca işlenir). Gerçek MariaDB gerekir — akış iç içe transaction/savepoint kullanır.
/// </para>
/// </summary>
public sealed class WaitlistEntitlementMySqlTests
{
    private static AppointmentService NewAppointments(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon,
            new CustomerAccountService(db, new NoopAuditLogger(), user));
    }

    /// <summary>WaitlistService randevu servisini <c>IServiceProvider</c>'dan çözer.</summary>
    private static WaitlistService NewWaitlist(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        var provider = new ServiceCollection()
            .AddSingleton<IAppointmentService>(NewAppointments(db))
            .BuildServiceProvider();
        return new WaitlistService(db, new NoopAuditLogger(), new AllowAllFeatureService(),
            new NoopAppNotificationService(), user, provider);
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId, Guid EntryId);

    /// <summary>Müşterinin HİÇBİR seansı / bekleyen satışı yok; yalnız bekleme kaydı var.</summary>
    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Bekleme QA", $"bekleme-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "BEKLEYEN MÜŞTERİ", "0555 777 11 22", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer Epilasyon", 45, 1500m, "Epilasyon");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var startUtc = DateTime.UtcNow.AddDays(1);
        var entry = new WaitlistEntry(tenant.Id, branch.Id, customer.Id, service.Id, staff.Id,
            DateOnly.FromDateTime(startUtc), "Yer açılırsa arayın",
            DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), 45);
        db.WaitlistEntries.Add(entry);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, entry.Id);
    }

    [MySqlFact]
    public async Task ScheduleAsync_WithoutEntitlement_OpensSaleAndBooksAppointment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var startUtc = DateTime.SpecifyKind(DateTime.UtcNow.AddDays(1), DateTimeKind.Utc);

        await using (var db = database.NewContext())
        {
            var result = await NewWaitlist(db).ScheduleAsync(seed.TenantId, seed.EntryId,
                new ScheduleWaitlistRequest(startUtc, 45, seed.StaffId, seed.ServiceId));
            Assert.True(result.IsSuccess,
                result.IsFailure ? $"Hakkı olmayan müşteride bekleme kaydı randevuya dönemedi: {result.Error.Message}" : null);
        }

        await using (var check = database.NewContext())
        {
            // 1) Randevu gerçekten açıldı ve kayıt Booked oldu.
            var appointment = await check.Appointments.SingleAsync(a => a.CustomerId == seed.CustomerId);
            Assert.Equal(seed.ServiceId, appointment.ServiceDefinitionId);
            Assert.Equal(0m, appointment.Price);   // bedeli satış adisyonu taşır

            var entry = await check.WaitlistEntries.SingleAsync(w => w.Id == seed.EntryId);
            Assert.Equal(WaitlistStatus.Booked, entry.Status);

            // 2) Satış AÇIK ve "ilk randevuda işle" bayrağıyla bekliyor (cariye şimdi işlenmez).
            var sale = await check.Adisyonlar.SingleAsync(a => a.CustomerId == seed.CustomerId);
            Assert.Equal(AdisyonStatus.Open, sale.Status);
            Assert.True(sale.AutoApproveOnFirstAppointment);

            var item = await check.AdisyonItems.SingleAsync(i => i.AdisyonId == sale.Id);
            Assert.Equal(AdisyonItemType.Service, item.Type);
            Assert.Equal(seed.ServiceId, item.RefId);
            Assert.Equal(1500m, item.LineTotal);   // fiyat SUNUCUDAN okunur
        }
    }
}

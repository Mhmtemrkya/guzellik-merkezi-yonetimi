using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// RANDEVU DURUM GEÇİŞİ — GERÇEK VERİTABANI YARIŞI.
///
/// <para>
/// Randevu eskiden transaction ve satır kilidinden ÖNCE okunup <c>Complete()</c> ediliyordu.
/// İki eşzamanlı "Tamamlandı" isteği (çift tıklama, iki cihaz, yeniden gönderilen istek)
/// randevuyu AYNI bayat durumda okuyup ikisi de <c>isCompleting=true</c> hesaplıyordu: ilki bir
/// paket seansını tüketiyor, ikincisi kilidi sonra alıp BAŞKA bir kullanılabilir seansı
/// tüketiyordu. Tek randevu iki seans düşürüyordu ve randevu satırında concurrency token da yok.
/// </para>
///
/// <para>
/// InMemory sağlayıcı transaction ve <c>SELECT … FOR UPDATE</c> taklit etmediği için bu hata
/// yalnız gerçek MySQL/MariaDB üzerinde görülebilir. Sunucu yoksa test atlanır.
/// </para>
/// </summary>
public sealed class AppointmentConcurrencyMySqlTests
{
    private static AppointmentService NewService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, null!);
    }

    private sealed record Seed(Guid TenantId, Guid AppointmentId, Guid SessionId, Guid SecondSessionId);

    /// <summary>
    /// Müşteride AYNI hizmet için İKİ ayrı paket bakiyesi (1'er seans) ve tek bir onaylı randevu.
    /// İkinci bakiye kasten var: hatalı sürümde ikinci istek "başka kullanılabilir seans" bulup
    /// onu tüketiyordu; doğru davranışta ikinci bakiyeye HİÇ dokunulmamalı.
    /// </summary>
    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Randevu Yarış", $"rnd-yaris-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "YARIŞ MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 1000m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        var first = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1);
        var second = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1);
        db.CustomerPackageSessions.AddRange(first, second);
        await db.SaveChangesAsync();

        var start = DateTime.UtcNow.AddHours(1);
        var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
            start, start.AddHours(1), 0m, null);
        appointment.LinkToPackageSession(first.Id);
        appointment.Confirm();
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, appointment.Id, first.Id, second.Id);
    }

    /// <summary>
    /// İki eşzamanlı "Tamamlandı" isteği TOPLAM BİR seans tüketmeli. İkinci istek kilit altında
    /// durumu taze okuyup no-op'a düşer (idempotent) — ikinci pakete dokunmaz.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentComplete_ConsumesExactlyOneSession()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        async Task CompleteAsync()
        {
            await using var db = database.NewContext();
            await NewService(db).ChangeStatusAsync(
                seed.TenantId, seed.AppointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
        }

        await Task.WhenAll(CompleteAsync(), CompleteAsync());

        await using var check = database.NewContext();
        var appointment = await check.Appointments.SingleAsync(a => a.Id == seed.AppointmentId);
        Assert.Equal(AppointmentStatus.Completed, appointment.Status);

        var sessions = await check.CustomerPackageSessions.ToListAsync();
        Assert.Equal(2, sessions.Count);
        Assert.Equal(1, sessions.Sum(s => s.UsedSessions));
        // Bağlı olduğu bakiyeden düşmeli; ikinci pakete dokunulmamalı.
        Assert.Equal(1, sessions.Single(s => s.Id == seed.SessionId).UsedSessions);
        Assert.Equal(0, sessions.Single(s => s.Id == seed.SecondSessionId).UsedSessions);
    }
}

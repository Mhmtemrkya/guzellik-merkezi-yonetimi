using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// RANDEVU YAŞAM DÖNGÜSÜ REGRESYONLARI (denetim raporu).
///
/// <para>1) ÜCRETLİ randevu tamamlanınca paket seansı TÜKETMEMELİ: bağsız randevuda "aynı hizmetten
/// herhangi bir seans" fallback'i çalışıyordu — müşteri ücretli randevu açıp arada paket alırsa
/// hem ücret tahakkuk ediyor hem seans düşüyordu (aynı iş iki kez ödetiliyordu).</para>
///
/// <para>2) TAMAMLANMIŞ randevu silinemez: seans tüketildi, prim/rapor ona dayanıyor. Silme
/// tüketimi geride bırakıp geçmişi yok ediyordu.</para>
///
/// <para>3) Numara çakışmasında yeniden deneme GERÇEKTEN yeni numara atamalı: AssignNumber
/// "yalnız bir kez" kuralı gereği dolu numarayı değiştirmiyor, retry aynı numarayla
/// tekrarlanıp başarılı olması gereken oluşturma hata alıyordu.</para>
/// </summary>
public sealed class AppointmentLifecycleTests
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
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, null!);
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId, Guid SessionId);

    /// <summary>Müşteride hizmete ait 1 seans var; randevular ayrıca kurulur.</summary>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Yaşam QA", $"yasam-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "YAŞAM MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Elif", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 500m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        var session = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 1);
        db.CustomerPackageSessions.Add(session);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, session.Id);
    }

    private static Appointment NewAppointment(Seed seed, decimal price, Guid? sourceSessionId = null)
    {
        var start = DateTime.UtcNow.AddHours(2);
        var appointment = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, seed.StaffId,
            seed.ServiceId, start, start.AddHours(1), price, null);
        if (sourceSessionId is not null) appointment.LinkToPackageSession(sourceSessionId);
        appointment.Confirm();
        return appointment;
    }

    /// <summary>Ücretli + bağsız randevu tamamlanınca paket seansı DOKUNULMAZ.</summary>
    [Fact]
    public async Task Complete_PaidAppointment_DoesNotConsumePackageSession()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed, price: 500m);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var session = await check.CustomerPackageSessions.SingleAsync(s => s.Id == seed.SessionId);
            Assert.Equal(0, session.UsedSessions);
        }
    }

    /// <summary>Ücretsiz (paketten karşılanan) randevu seansı TÜKETİR — mevcut davranış korunur.</summary>
    [Fact]
    public async Task Complete_FreeAppointment_StillConsumesSession()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed, price: 0m, sourceSessionId: seed.SessionId);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var session = await check.CustomerPackageSessions.SingleAsync(s => s.Id == seed.SessionId);
            Assert.Equal(1, session.UsedSessions);
        }
    }

    /// <summary>Tamamlanmış randevu silinemez (seans tüketimi geride kalırdı).</summary>
    [Fact]
    public async Task DeleteAsync_RejectsCompletedAppointment()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed, price: 0m, sourceSessionId: seed.SessionId);
            appointment.Complete();
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).DeleteAsync(seed.TenantId, appointmentId);
            Assert.True(result.IsFailure, "Tamamlanmış randevu silinebildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }
    }

    /// <summary>İptal edilmiş randevu silinebilmeye devam etmeli (yalnız tamamlanmış korunur).</summary>
    [Fact]
    public async Task DeleteAsync_AllowsCancelledAppointment()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed, price: 0m);
            appointment.Cancel("Test");
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).DeleteAsync(seed.TenantId, appointmentId);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }
    }

    /// <summary>
    /// Numara çakışmasında retry GERÇEKTEN yeni numara atamalı. AssignNumber dolu numarayı
    /// değiştirmez; retry yolu bunun için ayrı bir setter kullanır.
    /// </summary>
    [Fact]
    public void ReassignNumberForRetry_OverwritesExistingNumber()
    {
        var start = DateTime.UtcNow.AddHours(1);
        var appointment = new Appointment(Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(),
            Guid.CreateVersion7(), Guid.CreateVersion7(), start, start.AddHours(1), 0m, null);

        appointment.AssignNumber(10001);
        Assert.Equal(10001, appointment.Number);

        // "Yalnız bir kez" kuralı: normal yol numarayı değiştirmez.
        appointment.AssignNumber(10002);
        Assert.Equal(10001, appointment.Number);

        // Retry yolu değiştirir — aksi hâlde çakışma sonsuza dek tekrarlanırdı.
        appointment.ReassignNumberForRetry(10002);
        Assert.Equal(10002, appointment.Number);
    }
}

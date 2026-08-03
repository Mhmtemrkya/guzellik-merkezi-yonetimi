using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.Schedule;
using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Security;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DENETİM BULGULARI (3 Ağu 2026):
///
/// <para>1) Tamamlama + tahsilat atomik değildi: ekran iki ayrı HTTP çağrısı yapıyordu, ikincisi
/// düşünce "randevu tamamlandı, para alınmadı" durumu kalıcı oluyordu.</para>
///
/// <para>2) Reschedule'da hedef personel kilit ÖNCESİ hesaplanıyordu: araya giren bir personel
/// aktarımı commit ederse mesai/kapasite kontrolleri ESKİ personele uygulanıyordu.</para>
///
/// <para>3) Yetki değişimi ve şube transferi eldeki access token'ı geçersiz kılmıyordu.</para>
/// </summary>
public sealed class AppointmentAtomicityAndSessionTests
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

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId, Guid AccountId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, decimal accountTotal = 1000m)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Atomik QA", $"atomik-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "ATOMİK MÜŞTERİ", "0555 222 33 44", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Deniz", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 60, 500m, "Epilasyon");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Lazer Paketi", accountTotal, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, account.Id);
    }

    private static Appointment NewAppointment(Seed seed)
    {
        var start = DateTime.UtcNow.AddHours(2);
        var appointment = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, seed.StaffId,
            seed.ServiceId, start, start.AddHours(1), 500m, null);
        appointment.Confirm();
        return appointment;
    }

    // ---------------------------------------------------------------- 1) atomiklik

    [Fact]
    public async Task CompleteWithPayment_AppliesStatusAndPaymentTogether()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;
        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId,
                new CompleteAppointmentRequest(null, new CompleteAppointmentPaymentDto(400m, "Nakit", null, null, null)));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Completed, appointment.Status);

            var account = await check.CustomerAccounts.Include(a => a.Payments).SingleAsync(a => a.Id == seed.AccountId);
            Assert.Equal(400m, account.PaidAmount);
        }
    }

    /// <summary>Tahsilat reddedilirse randevu da tamamlanmamış kalmalı (hep ya da hiç).</summary>
    [Fact]
    public async Task CompleteWithPayment_RejectsInvalidAmount_AndLeavesAppointmentUntouched()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;
        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId,
                new CompleteAppointmentRequest(null, new CompleteAppointmentPaymentDto(0m, "Nakit", null, null, null)));
            Assert.True(result.IsFailure);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.SingleAsync(a => a.Id == appointmentId);
            Assert.NotEqual(AppointmentStatus.Completed, appointment.Status);
            var account = await check.CustomerAccounts.Include(a => a.Payments).SingleAsync(a => a.Id == seed.AccountId);
            Assert.Equal(0m, account.PaidAmount);
        }
    }

    /// <summary>Tahsilat verilmezse yalnız durum değişir (eski "sadece tamamla" davranışı).</summary>
    [Fact]
    public async Task CompleteWithPayment_WithoutPayment_OnlyCompletes()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;
        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId,
                new CompleteAppointmentRequest(null, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            Assert.Equal(AppointmentStatus.Completed,
                (await check.Appointments.SingleAsync(a => a.Id == appointmentId)).Status);
            var account = await check.CustomerAccounts.Include(a => a.Payments).SingleAsync(a => a.Id == seed.AccountId);
            Assert.Equal(0m, account.PaidAmount);
        }
    }

    // ---------------------------------------------------------------- 2) reschedule hedef personel

    /// <summary>
    /// İstek personel taşımıyorsa hedef, randevunun KİLİT ALTINDA okunan güncel personelidir.
    /// Araya giren aktarım sonrası eski personel üstünden karar verilmemeli.
    /// </summary>
    [Fact]
    public async Task Reschedule_UsesFreshlyReadStaff_WhenRequestDoesNotChangeStaff()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;
        Guid otherStaffId;

        await using (var db = NewDb(options))
        {
            var other = new StaffMember(seed.TenantId, seed.BranchId, "Uzman Kaan", "Uzman");
            db.StaffMembers.Add(other);
            var appointment = NewAppointment(seed);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
            otherStaffId = other.Id;
        }

        // Araya giren aktarım: randevu artık DİĞER personelde.
        await using (var db = NewDb(options))
        {
            var appointment = await db.Appointments.SingleAsync(a => a.Id == appointmentId);
            appointment.ReassignStaff(otherStaffId);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var start = DateTime.UtcNow.AddHours(5);
            var result = await NewService(db).RescheduleAsync(seed.TenantId, appointmentId,
                new RescheduleAppointmentRequest(start, start.AddHours(1), null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            // Personel isteğe konmadığı için DEĞİŞMEMELİ; taze okunan personel korunur.
            Assert.Equal(otherStaffId, result.Value!.StaffMemberId);
        }
    }

    /// <summary>Kapalı saate taşıma reddedilir — kontrol HEDEF personele uygulanır.</summary>
    [Fact]
    public async Task Reschedule_BlockedWhenTargetStaffHoursAreClosed()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid appointmentId;

        await using (var db = NewDb(options))
        {
            var appointment = NewAppointment(seed);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        // Hedef saat aralığını kapat (yerel 12:00–13:00).
        var targetLocal = DateTime.UtcNow.AddDays(1).Date.AddHours(12);
        var targetUtc = targetLocal.AddHours(-3);
        await using (var db = NewDb(options))
        {
            var schedule = new ScheduleService(db, new NoopAuditLogger());
            var day = DateOnly.FromDateTime(targetLocal);
            var added = await schedule.AddTimeOffAsync(seed.TenantId,
                new CreateTimeOffRequest(seed.StaffId, day, "Kapalı", 720, 780));
            Assert.True(added.IsSuccess, added.IsFailure ? added.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).RescheduleAsync(seed.TenantId, appointmentId,
                new RescheduleAppointmentRequest(targetUtc, targetUtc.AddMinutes(30), null));
            Assert.True(result.IsFailure);
        }
    }

    // ---------------------------------------------------------------- 3) oturum sertleştirme

    /// <summary>Yetki değişimi eldeki access token'ı geçersiz kılmalı (izinler JWT claim'i).</summary>
    [Fact]
    public async Task UpdateStaff_PermissionChange_InvalidatesSessions()
    {
        var options = NewOptions();
        var (tenantId, staffId, userId, _) = await SeedStaffWithLoginAsync(options);

        await using (var db = NewDb(options))
        {
            var service = NewStaffService(db);
            var result = await service.UpdateAsync(tenantId, staffId,
                new UpdateStaffRequest("Uzman Deniz", "Uzman", null, null, null, true,
                    new[] { Permissions.Customers, Permissions.Appointments }));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var user = await check.TenantUsers.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            Assert.NotNull(user.SecurityStampUtc);
        }
    }

    /// <summary>Aynı izinler yeniden gönderilirse personel boş yere oturumdan atılmamalı.</summary>
    [Fact]
    public async Task UpdateStaff_SamePermissions_DoesNotInvalidateSessions()
    {
        var options = NewOptions();
        var (tenantId, staffId, userId, _) = await SeedStaffWithLoginAsync(options, new[] { Permissions.Customers });

        await using (var db = NewDb(options))
        {
            var result = await NewStaffService(db).UpdateAsync(tenantId, staffId,
                new UpdateStaffRequest("Uzman Deniz", "Uzman", null, null, null, true,
                    new[] { Permissions.Customers }));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var user = await check.TenantUsers.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            Assert.Null(user.SecurityStampUtc);
        }
    }

    /// <summary>Şube transferi de oturumu düşürmeli (branch_id JWT claim'i).</summary>
    [Fact]
    public async Task TransferBranch_InvalidatesSessions()
    {
        var options = NewOptions();
        var (tenantId, staffId, userId, secondBranchId) = await SeedStaffWithLoginAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewStaffService(db).TransferBranchAsync(tenantId, staffId, secondBranchId);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var user = await check.TenantUsers.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            Assert.NotNull(user.SecurityStampUtc);
        }
    }

    /// <summary>Parola sıfırlama access token'ı da düşürmeli (yalnız refresh token yetmiyordu).</summary>
    [Fact]
    public async Task ResetPassword_InvalidatesAccessTokensToo()
    {
        var options = NewOptions();
        var (tenantId, staffId, userId, _) = await SeedStaffWithLoginAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewStaffService(db).ResetPasswordAsync(tenantId, staffId);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var user = await check.TenantUsers.IgnoreQueryFilters().SingleAsync(u => u.Id == userId);
            Assert.NotNull(user.SecurityStampUtc);
        }
    }

    private static StaffService NewStaffService(GuzellikDbContext db) =>
        new(db, new PasswordHasher(), new AlwaysAllowUsageService(), new NoopAuditLogger());

    private static async Task<(Guid TenantId, Guid StaffId, Guid UserId, Guid SecondBranchId)> SeedStaffWithLoginAsync(
        DbContextOptions<GuzellikDbContext> options, string[]? permissions = null)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Oturum QA", $"oturum-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        // İkinci şube burada kurulur: ayrı bir context'te aggregate'e şube eklemek InMemory
        // sağlayıcıda DbUpdateConcurrencyException üretiyor.
        var secondBranch = tenant.AddBranch("Şube 2", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var service = new StaffService(db, new PasswordHasher(), new AlwaysAllowUsageService(), new NoopAuditLogger());
        var created = await service.CreateAsync(tenant.Id, new CreateStaffRequest(
            branch.Id, "Uzman Deniz", "Uzman", null, null, null, true,
            $"deniz-{Guid.NewGuid():N}"[..12] + "@qa.test",
            permissions ?? new[] { Permissions.Customers }));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);

        var staffId = created.Value!.Staff.Id;
        var userId = await db.StaffMembers.AsNoTracking()
            .Where(s => s.Id == staffId).Select(s => s.TenantUserId).SingleAsync();
        return (tenant.Id, staffId, userId!.Value, secondBranch.Id);
    }
}

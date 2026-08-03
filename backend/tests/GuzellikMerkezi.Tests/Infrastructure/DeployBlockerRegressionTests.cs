using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DEPLOY BLOCKER REGRESYONLARI (3 Ağu 2026 denetimi).
///
/// <para>1) /complete ikinci çağrıda İKİNCİ TAHSİLAT yazıyordu: ChangeStatusAsync zaten Completed
/// randevuda başarılı no-op dönüyor, çağıran bunu "tamamladım" sanıp ödemeyi yine işliyordu.</para>
///
/// <para>2) /complete, Accounting.Collect yetkisini BYPASS ediyordu: onay kapısından muaf olduğu
/// için tahsilat yetkisi olmayan personel isteğe payment ekleyip para yazabiliyordu.</para>
///
/// <para>3) İstemcinin verdiği AccountId randevunun müşterisine bağlanmıyordu: A müşterisinin
/// randevu tahsilatı B müşterisinin carisine yazılabiliyordu.</para>
/// </summary>
public sealed class DeployBlockerRegressionTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AppointmentService NewService(GuzellikDbContext db, ICurrentUser? actor = null)
    {
        var user = actor ?? new TestCurrentUser(UserRole.InstitutionOwner);
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), user);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, accounts);
    }

    private sealed record Seed(
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId,
        Guid AccountId, Guid OtherCustomerId, Guid OtherAccountId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Blocker QA", $"blocker-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "BLOCKER MÜŞTERİ", "0555 333 44 55", null);
        var other = new Customer(tenant.Id, branch.Id, "BAŞKA MÜŞTERİ", "0555 666 77 88", null);
        db.Customers.AddRange(customer, other);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Ece", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Bakım", 60, 500m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 1000m, 0m);
        var otherAccount = new CustomerAccount(tenant.Id, branch.Id, other.Id, null, "Başka paket", 1000m, 0m);
        db.CustomerAccounts.AddRange(account, otherAccount);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
            account.Id, other.Id, otherAccount.Id);
    }

    private static async Task<Guid> NewAppointmentAsync(DbContextOptions<GuzellikDbContext> options, Seed seed)
    {
        await using var db = NewDb(options);
        var start = DateTime.UtcNow.AddHours(2);
        var appointment = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, seed.StaffId,
            seed.ServiceId, start, start.AddHours(1), 500m, null);
        appointment.Confirm();
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();
        return appointment.Id;
    }

    private static CompleteAppointmentRequest Pay(decimal amount, Guid? accountId = null) =>
        new(null, new CompleteAppointmentPaymentDto(amount, "Nakit", null, accountId, null));

    private static async Task<decimal> PaidTotalAsync(DbContextOptions<GuzellikDbContext> options, Guid accountId)
    {
        await using var db = NewDb(options);
        var account = await db.CustomerAccounts.Include(a => a.Payments).SingleAsync(a => a.Id == accountId);
        return account.PaidAmount;
    }

    // ---------------------------------------------------------------- 1) çift tahsilat

    /// <summary>
    /// İKİNCİ /complete çağrısı İKİNCİ TAHSİLAT YAZMAMALI. Idempotency anahtarı düşse ya da
    /// istemci farklı anahtarla tekrar gönderse bile tutar bir kez işlenir.
    /// </summary>
    [Fact]
    public async Task CompleteWithPayment_CalledTwice_ChargesOnlyOnce()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var first = await NewService(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId, Pay(200m));
            Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Message : null);
        }
        Assert.Equal(200m, await PaidTotalAsync(options, seed.AccountId));

        await using (var db = NewDb(options))
        {
            // Aynı randevu tekrar gönderilir (çift tıklama / yeniden deneme).
            var second = await NewService(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId, Pay(200m));
            Assert.True(second.IsSuccess, second.IsFailure ? second.Error.Message : null);
        }

        Assert.Equal(200m, await PaidTotalAsync(options, seed.AccountId));
    }

    /// <summary>Zaten tamamlanmış randevuya /complete gelirse hiç tahsilat işlenmez.</summary>
    [Fact]
    public async Task CompleteWithPayment_OnAlreadyCompletedAppointment_DoesNotCharge()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var done = await NewService(db).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId, Pay(150m));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        Assert.Equal(0m, await PaidTotalAsync(options, seed.AccountId));
    }

    // ---------------------------------------------------------------- 2) yetki bypass'ı

    /// <summary>
    /// Accounting.Collect yetkisi OLMAYAN personel, /complete'e payment ekleyerek tahsilat
    /// yapamamalı. (Uç onay kapısından muaf olduğu için kontrol serviste zorunlu.)
    /// </summary>
    [Fact]
    public async Task CompleteWithPayment_StaffWithoutCollectPermission_IsForbidden()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        var staffActor = new TestCurrentUser(UserRole.Staff, null, null, Permissions.AppointmentsStatus);
        await using (var db = NewDb(options))
        {
            var result = await NewService(db, staffActor).CompleteWithPaymentAsync(seed.TenantId, appointmentId, Pay(100m));
            Assert.True(result.IsFailure);
            Assert.Equal("Forbidden", result.Error.Code);
        }

        // Ne para yazılmalı ne randevu tamamlanmalı.
        Assert.Equal(0m, await PaidTotalAsync(options, seed.AccountId));
        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.SingleAsync(a => a.Id == appointmentId);
            Assert.NotEqual(AppointmentStatus.Completed, appointment.Status);
        }
    }

    /// <summary>Yetkisi olan personel tahsilat yapabilir; ödemesiz tamamlama zaten serbesttir.</summary>
    [Fact]
    public async Task CompleteWithPayment_StaffWithCollectPermission_Succeeds()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        var staffActor = new TestCurrentUser(UserRole.Staff, null, null, Permissions.AppointmentsStatus, Permissions.AccountingCollect);
        await using (var db = NewDb(options))
        {
            var result = await NewService(db, staffActor).CompleteWithPaymentAsync(seed.TenantId, appointmentId, Pay(100m));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        Assert.Equal(100m, await PaidTotalAsync(options, seed.AccountId));
    }

    [Fact]
    public async Task Complete_WithoutPayment_StaffWithoutCollectPermission_IsAllowed()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        var staffActor = new TestCurrentUser(UserRole.Staff, null, null, Permissions.AppointmentsStatus);
        await using (var db = NewDb(options))
        {
            var result = await NewService(db, staffActor).CompleteWithPaymentAsync(
                seed.TenantId, appointmentId, new CompleteAppointmentRequest(null, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }
    }

    // ---------------------------------------------------------------- 3) yabancı cari

    /// <summary>
    /// İstemci BAŞKA müşterinin carisini gönderirse reddedilmeli — aynı kurumda olması yetmez.
    /// </summary>
    [Fact]
    public async Task CompleteWithPayment_ForeignAccountId_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).CompleteWithPaymentAsync(
                seed.TenantId, appointmentId, Pay(100m, seed.OtherAccountId));
            Assert.True(result.IsFailure);
        }

        // Yabancı cariye para yazılmamalı, randevu da tamamlanmamalı.
        Assert.Equal(0m, await PaidTotalAsync(options, seed.OtherAccountId));
        Assert.Equal(0m, await PaidTotalAsync(options, seed.AccountId));
        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.SingleAsync(a => a.Id == appointmentId);
            Assert.NotEqual(AppointmentStatus.Completed, appointment.Status);
        }
    }

    /// <summary>Randevunun kendi carisi açıkça verilirse kabul edilir.</summary>
    [Fact]
    public async Task CompleteWithPayment_OwnAccountId_IsAccepted()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var appointmentId = await NewAppointmentAsync(options, seed);

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).CompleteWithPaymentAsync(
                seed.TenantId, appointmentId, Pay(120m, seed.AccountId));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        Assert.Equal(120m, await PaidTotalAsync(options, seed.AccountId));
        Assert.Equal(0m, await PaidTotalAsync(options, seed.OtherAccountId));
    }
}

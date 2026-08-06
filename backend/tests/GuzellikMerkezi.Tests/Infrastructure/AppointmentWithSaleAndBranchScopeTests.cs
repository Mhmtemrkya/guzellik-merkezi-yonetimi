using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DENETİM BULGULARI (3 Ağu 2026, ikinci tur):
///
/// <para>1) "Katalogdan sat + randevu" ATOMİK DEĞİLDİ: istemci adisyon aç → kalem ekle → randevu
/// diye üç ayrı çağrı yapıyordu; randevu adımı düşünce müşteriye yazılmış AÇIK SATIŞ ortada
/// kalıyor ama randevu oluşmuyordu.</para>
///
/// <para>2) ŞUBE YÖNETİCİSİ BAŞKA ŞUBENİN ONAYLARINI yönetebiliyordu: SignalR/arayüz süzgeci
/// yetkilendirme değildir; doğrudan API çağıran BranchManager listeleyip onaylayabiliyordu.</para>
/// </summary>
public sealed class AppointmentWithSaleAndBranchScopeTests
{
    private static AppointmentService NewAppointmentService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), user);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, accounts);
    }

    // ---------------------------------------------------------------- 1) satış + randevu atomik

    private sealed record SaleSeed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId);

    private static async Task<SaleSeed> SeedSaleAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Satis Randevu", $"satis-rnd-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "KATALOG MÜŞTERİ", "0555 909 80 70", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman Sena", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 60, 1500m, "Epilasyon");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        return new SaleSeed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id);
    }

    private static CreateAppointmentRequest Appointment(SaleSeed seed, DateTime startUtc) =>
        new(seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId, startUtc, startUtc.AddHours(1), 0m, null);

    /// <summary>Başarılı akış: satış AÇIK adisyon olarak oluşur ve randevu açılır.</summary>
    [MySqlFact]
    public async Task CreateWithSale_Success_CreatesBothSaleAndAppointment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedSaleAsync(database);

        await using (var db = database.NewContext())
        {
            var result = await NewAppointmentService(db).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    Appointment(seed, DateTime.UtcNow.AddDays(1)),
                    new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId)));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            Assert.Equal(1, await check.Appointments.CountAsync(a => a.CustomerId == seed.CustomerId));
            var adisyon = await check.Adisyonlar.Include(a => a.Items)
                .SingleAsync(a => a.CustomerId == seed.CustomerId);
            Assert.Equal(AdisyonStatus.Open, adisyon.Status);
            Assert.True(adisyon.AutoApproveOnFirstAppointment);
            Assert.Equal(1500m, adisyon.Items.Single().LineTotal);
        }
    }

    /// <summary>
    /// ASIL İDDİA: randevu adımı düşerse SATIŞ DA GERİ ALINIR — ortada ödemesi yazılmış ama
    /// randevusu olmayan müşteri kalmaz. Slot doluluğu ile gerçek bir başarısızlık üretilir.
    /// </summary>
    [MySqlFact]
    public async Task CreateWithSale_AppointmentFails_RollsBackTheSale()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedSaleAsync(database);
        var slot = DateTime.UtcNow.AddDays(2);

        // Aynı personelin aynı aralığında kapasiteyi doldur (en fazla 2 aktif randevu).
        await using (var db = database.NewContext())
        {
            for (var i = 0; i < 2; i++)
            {
                var blocker = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, seed.StaffId,
                    seed.ServiceId, slot, slot.AddHours(1), 0m, null);
                blocker.Confirm();
                db.Appointments.Add(blocker);
            }
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var result = await NewAppointmentService(db).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    Appointment(seed, slot),
                    new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId)));
            Assert.True(result.IsFailure);
        }

        await using (var check = database.NewContext())
        {
            // Randevu eklenmemiş (yalnız kurulumdaki 2 tanesi) VE satış hiç oluşmamış olmalı.
            Assert.Equal(2, await check.Appointments.CountAsync(a => a.CustomerId == seed.CustomerId));
            Assert.Equal(0, await check.Adisyonlar.CountAsync(a => a.CustomerId == seed.CustomerId));
        }
    }

    /// <summary>Fiyat SUNUCUDAN okunur: istemcinin gönderdiği kaleme güvenilmez.</summary>
    [MySqlFact]
    public async Task CreateWithSale_UnknownService_IsRejected()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedSaleAsync(database);

        await using var db = database.NewContext();
        var result = await NewAppointmentService(db).CreateWithSaleAsync(seed.TenantId,
            new CreateAppointmentWithSaleRequest(
                Appointment(seed, DateTime.UtcNow.AddDays(3)),
                new AppointmentCatalogSaleDto(Guid.CreateVersion7(), null, seed.StaffId)));
        Assert.True(result.IsFailure);
    }

    // ---------------------------------------------------------------- 2) şube yetki sınırı

    private sealed record BranchSeed(Guid TenantId, Guid BranchA, Guid BranchB, Guid OpInBranchB, Guid ManagerA);

    private static async Task<BranchSeed> SeedBranchesAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Sube Yetki", $"sube-yetki-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var a = tenant.AddBranch("Şube A", "İstanbul", true);
        var b = tenant.AddBranch("Şube B", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var staff = tenant.GrantAccess($"p-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.Staff, b.Id, "Personel B");
        var managerA = tenant.GrantAccess($"m-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.BranchManager, a.Id, "Yönetici A");
        db.TenantUsers.AddRange(staff, managerA);
        await db.SaveChangesAsync();

        // ŞUBE B'ye ait bekleyen işlem.
        var op = new PendingOperation(tenant.Id, b.Id, staff.Id, "Personel B",
            PendingOperationType.HttpReplay, "Şube B satışı", "POST /api/admin/adisyonlar/x/approve", "{}", DateTime.MinValue);
        db.PendingOperations.Add(op);
        await db.SaveChangesAsync();

        return new BranchSeed(tenant.Id, a.Id, b.Id, op.Id, managerA.Id);
    }

    private static PendingOperationService NewPendingService(GuzellikDbContext db) =>
        new(db, null!, null!, new NoopAuditLogger(), new NoopAppNotificationService(), new NoopRealtimeNotifier());

    [MySqlFact]
    public async Task BranchManager_CannotSeeOtherBranchOperations()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedBranchesAsync(database);

        await using var db = database.NewContext();
        var list = await NewPendingService(db).ListAsync(seed.TenantId,
            new PendingOperationFilter(null, null, null), new PageRequest(1, 50),
            UserRole.BranchManager, seed.BranchA);
        Assert.True(list.IsSuccess);
        Assert.Empty(list.Value!.Items);

        var get = await NewPendingService(db).GetAsync(seed.TenantId, seed.OpInBranchB, seed.ManagerA,
            UserRole.BranchManager, seed.BranchA);
        Assert.True(get.IsFailure);
        Assert.Equal("NotFound", get.Error.Code);
    }

    [MySqlFact]
    public async Task BranchManager_CannotApproveOrRejectOtherBranchOperation()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedBranchesAsync(database);

        await using (var db = database.NewContext())
        {
            var approve = await NewPendingService(db).ApproveAsync(seed.TenantId, seed.OpInBranchB,
                seed.ManagerA, UserRole.BranchManager, seed.BranchA);
            Assert.True(approve.IsFailure);
            Assert.Equal("NotFound", approve.Error.Code);
        }

        await using (var db = database.NewContext())
        {
            var reject = await NewPendingService(db).RejectAsync(seed.TenantId, seed.OpInBranchB,
                seed.ManagerA, new RejectPendingOperationRequest("olmaz"), UserRole.BranchManager, seed.BranchA);
            Assert.True(reject.IsFailure);
            Assert.Equal("NotFound", reject.Error.Code);
        }

        // Kayıt DOKUNULMAMIŞ kalmalı.
        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OpInBranchB);
            Assert.Equal(PendingOperationStatus.Pending, op.Status);
        }
    }

    /// <summary>Kurum yöneticisi kurumun TAMAMINI yönetir — kapsam onu kısıtlamamalı.</summary>
    [MySqlFact]
    public async Task InstitutionOwner_SeesAllBranches()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedBranchesAsync(database);

        await using var db = database.NewContext();
        var list = await NewPendingService(db).ListAsync(seed.TenantId,
            new PendingOperationFilter(null, null, null), new PageRequest(1, 50),
            UserRole.InstitutionOwner, seed.BranchA);
        Assert.True(list.IsSuccess);
        Assert.Single(list.Value!.Items);
    }
}

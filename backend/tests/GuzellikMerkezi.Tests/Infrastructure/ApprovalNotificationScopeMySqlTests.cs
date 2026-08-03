using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ONAY BİLDİRİMİ ŞUBE KAPSAMI (deploy blocker, 3 Ağu 2026 — 3. tur).
///
/// <para>
/// Şubesiz (BranchId = null) kayıt rolden bağımsız "kurum geneli yetki" sayılıyordu. Şubesi
/// atanmamış bir ŞUBE YÖNETİCİSİ böylece TÜM şubelerin onay bildirimlerini alıyordu: personel adı,
/// işlem başlığı, bekleyen işlem Id'si ve onay ekranı bağlantısı. Karar uçları onu zaten fail-closed
/// kabul ediyordu; kaçak yalnız bildirim + SignalR tarafındaydı.
/// </para>
/// </summary>
public sealed class ApprovalNotificationScopeMySqlTests
{
    private sealed class CapturingRealtimeNotifier : IRealtimeNotifier
    {
        public List<(Guid TenantId, Guid UserId, string Event)> UserEvents { get; } = [];

        public Task PublishToTenantAsync(Guid tenantId, RealtimeEvent payload, CancellationToken ct = default) =>
            Task.CompletedTask;

        public Task PublishToUserAsync(Guid tenantId, Guid userId, RealtimeEvent payload, CancellationToken ct = default)
        {
            lock (UserEvents) UserEvents.Add((tenantId, userId, payload.Kind));
            return Task.CompletedTask;
        }
    }

    private sealed class NoopPushSender : IPushSender
    {
        public bool IsConfigured => false;
        public Task<int> SendAsync(IReadOnlyCollection<PushMessage> messages, CancellationToken ct = default) =>
            Task.FromResult(0);
    }

    private sealed record Seed(
        Guid TenantId, Guid BranchA, Guid BranchB,
        Guid OwnerId, Guid ManagerAId, Guid ManagerBId, Guid BranchlessManagerId, Guid StaffId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Bildirim Kapsam", $"bildirim-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var a = tenant.AddBranch("Şube A", "İstanbul", true);
        var b = tenant.AddBranch("Şube B", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var owner = tenant.GrantAccess($"o-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.InstitutionOwner, null, "Kurum Yöneticisi");
        var managerA = tenant.GrantAccess($"a-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.BranchManager, a.Id, "Yönetici A");
        var managerB = tenant.GrantAccess($"b-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.BranchManager, b.Id, "Yönetici B");
        // ŞUBESİZ ŞUBE YÖNETİCİSİ: artık domain bunu reddediyor (bkz. Tenant.GrantAccess), ama
        // CANLIDA eski kayıtlar var. Şubeli oluşturulup şubesi SQL ile boşaltılarak taklit edilir.
        var branchless = tenant.GrantAccess($"x-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.BranchManager, b.Id, "Şubesiz Yönetici");
        var staff = tenant.GrantAccess($"p-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.Staff, b.Id, "Personel B");
        db.TenantUsers.AddRange(owner, managerA, managerB, branchless, staff);
        await db.SaveChangesAsync();

        await db.Database.ExecuteSqlRawAsync(
            "UPDATE tenant_users SET BranchId = NULL WHERE Id = {0}", branchless.Id.ToString());

        return new Seed(tenant.Id, a.Id, b.Id, owner.Id, managerA.Id, managerB.Id, branchless.Id, staff.Id);
    }

    /// <summary>Şubesiz şube yöneticisi domain kapısında reddedilmeli — yeni kayıt hiç oluşmasın.</summary>
    [Fact]
    public void BranchManagerWithoutBranch_CannotBeCreated()
    {
        var tenant = new Tenant("Kapı", "kapi-test", "Premium", TenantStatus.Active);
        Assert.Throws<BusinessRuleException>(() =>
            tenant.GrantAccess("yonetici@qa.test", UserRole.BranchManager, null, "Şubesiz"));
    }

    private static AppNotificationService NewNotificationService(
        GuzellikDbContext db, ServiceProvider provider, IRealtimeNotifier realtime) =>
        new(db,
            provider.GetRequiredService<IServiceScopeFactory>(),
            new NoopPushSender(),
            new CapturingJobQueue(),
            new FixedClock(),
            realtime,
            NullLogger<AppNotificationService>.Instance);

    /// <summary>
    /// ŞUBE B'ye ait onay isteği: kurum yöneticisi + B yöneticisi bildirim almalı;
    /// A yöneticisi ve ŞUBESİZ yönetici ALMAMALI (kalıcı bildirim + anlık SignalR olayı).
    /// </summary>
    [MySqlFact]
    public async Task PendingApproval_IsNotDeliveredToBranchlessOrForeignBranchManagers()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var realtime = new CapturingRealtimeNotifier();

        await using (var provider = database.NewServiceProvider())
        await using (var db = database.NewContext())
        {
            var notifications = NewNotificationService(db, provider, realtime);
            var service = new PendingOperationService(db, null!, null!, new NoopAuditLogger(), notifications, realtime);

            var created = await service.CreateAsync(seed.TenantId, seed.BranchB, seed.StaffId, "Personel B",
                new CreatePendingOperationRequest(PendingOperationType.HttpReplay,
                    "Şube B satışı", "POST /api/admin/adisyonlar/x/approve", "{}"));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var recipients = await check.AppNotifications
                .IgnoreQueryFilters()
                .Where(n => n.TenantId == seed.TenantId && n.Type == AppNotificationType.ApprovalPending)
                .Select(n => n.RecipientUserId)
                .ToListAsync();

            Assert.Contains(seed.OwnerId, recipients);
            Assert.Contains(seed.ManagerBId, recipients);
            Assert.DoesNotContain(seed.ManagerAId, recipients);
            Assert.DoesNotContain(seed.BranchlessManagerId, recipients);   // ASIL İDDİA
            Assert.DoesNotContain(seed.StaffId, recipients);
        }

        var approvalTargets = realtime.UserEvents.Where(e => e.Event == "approval.pending").Select(e => e.UserId).ToList();
        Assert.Contains(seed.OwnerId, approvalTargets);
        Assert.Contains(seed.ManagerBId, approvalTargets);
        Assert.DoesNotContain(seed.ManagerAId, approvalTargets);
        Assert.DoesNotContain(seed.BranchlessManagerId, approvalTargets);  // ASIL İDDİA
    }

    /// <summary>
    /// KURUM GENELİ (şubesiz) onay isteği HERKESE gider: bildirim kapsamı yetki kapsamıyla aynı
    /// olmalı ve şubesiz işlemi ListAsync/GetAsync tüm yöneticilere gösteriyor. Kaçak, ŞUBELİ
    /// işlemin şubesiz yöneticiye gitmesiydi — onu üstteki test kapatıyor.
    /// </summary>
    [MySqlFact]
    public async Task TenantWideApproval_ReachesEveryManager()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var realtime = new CapturingRealtimeNotifier();

        await using (var provider = database.NewServiceProvider())
        await using (var db = database.NewContext())
        {
            var notifications = NewNotificationService(db, provider, realtime);
            var service = new PendingOperationService(db, null!, null!, new NoopAuditLogger(), notifications, realtime);

            var created = await service.CreateAsync(seed.TenantId, null, seed.StaffId, "Personel B",
                new CreatePendingOperationRequest(PendingOperationType.HttpReplay,
                    "Kurum geneli işlem", "POST /api/admin/customers", "{}"));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        }

        await using var check = database.NewContext();
        var recipients = await check.AppNotifications
            .IgnoreQueryFilters()
            .Where(n => n.TenantId == seed.TenantId && n.Type == AppNotificationType.ApprovalPending)
            .Select(n => n.RecipientUserId)
            .ToListAsync();

        Assert.Contains(seed.OwnerId, recipients);
        Assert.Contains(seed.ManagerAId, recipients);
        Assert.Contains(seed.ManagerBId, recipients);
        Assert.Contains(seed.BranchlessManagerId, recipients);
        Assert.DoesNotContain(seed.StaffId, recipients);
    }
}

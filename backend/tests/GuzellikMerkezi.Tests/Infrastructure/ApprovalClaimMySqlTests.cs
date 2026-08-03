using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ONAY SAHİPLENME — GERÇEK VERİTABANI YARIŞI (deploy blocker, 3 Ağu 2026).
///
/// <para>
/// Onaylanan işlem (HTTP replay) AYRI bir bağlantıda çalıştığı için servisin transaction'ı onu
/// kapsamaz. Satır eskiden yalnızca yürütmeden SONRA Approved yapılıyordu: iki yönetici aynı
/// bekleyen işlemi eşzamanlı onaylarsa ikisi de Pending okuyup ikisi de replay çalıştırabiliyordu.
/// Genel HTTP replay bir satışı, tahsilatı, adisyon onayını ya da silmeyi İKİ KEZ uygulayabilirdi.
/// </para>
///
/// <para>
/// InMemory sağlayıcı <c>SELECT … FOR UPDATE</c> taklit etmediği için bu yarış yalnız gerçek
/// MySQL/MariaDB üzerinde görülebilir. Sunucu yoksa test atlanır (bkz. MySqlTestDatabase).
/// </para>
/// </summary>
public sealed class ApprovalClaimMySqlTests
{
    /// <summary>Kaç kez çağrıldığını sayan replayer — "tam olarak 1" iddiasının kanıtı.</summary>
    private sealed class CountingReplayer : IApprovalReplayer
    {
        private int _calls;
        public int Calls => Volatile.Read(ref _calls);
        public bool ShouldFail { get; init; }

        public async Task<Result<Guid?>> ReplayAsync(string payloadJson, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _calls);
            // Gerçek replay bir HTTP çağrısıdır: sahiplenmenin yarışı gerçekten kapattığını
            // görebilmek için ikinci çağrıya zaman tanıyacak kadar bekle.
            await Task.Delay(250, cancellationToken);
            return ShouldFail
                ? Result<Guid?>.Failure(Error.Validation("replay başarısız"))
                : Result<Guid?>.Success(Guid.CreateVersion7());
        }
    }

    private static PendingOperationService NewService(GuzellikDbContext db, IApprovalReplayer replayer) =>
        new(db, new ThrowingDispatcher(), replayer, new NoopAuditLogger(),
            new NoopAppNotificationService(), new NoopRealtimeNotifier());

    private sealed class ThrowingDispatcher : IApprovalDispatcher
    {
        public Task<Result<Guid?>> DispatchAsync(Guid tenantId, PendingOperationType type, string payloadJson, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Bu testte yalnız HttpReplay kullanılır.");
    }

    private static async Task<(Guid TenantId, Guid OperationId, Guid UserId)> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Onay Yarış", $"onay-yaris-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        // FK: RequestedByUserId / DecidedByUserId gerçek kullanıcılara işaret etmeli.
        var staff = tenant.GrantAccess($"personel-{Guid.NewGuid():N}"[..16] + "@qa.test", UserRole.Staff, branch.Id, "Personel");
        var manager = tenant.GrantAccess($"yonetici-{Guid.NewGuid():N}"[..16] + "@qa.test", UserRole.InstitutionOwner, null, "Yönetici");
        db.TenantUsers.AddRange(staff, manager);
        await db.SaveChangesAsync();

        var op = new PendingOperation(tenant.Id, null, staff.Id, "Personel",
            PendingOperationType.HttpReplay, "Adisyon onayı", "POST /api/admin/adisyonlar/x/approve", "{}");
        db.PendingOperations.Add(op);
        await db.SaveChangesAsync();

        return (tenant.Id, op.Id, manager.Id);
    }

    /// <summary>
    /// İki eşzamanlı onay: operasyon TAM OLARAK BİR KEZ çalışmalı, tam olarak biri başarılı
    /// olmalı ve kayıt Approved'da bitmelidir.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentApprove_RunsOperationExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);
        var replayer = new CountingReplayer();

        async Task<Result<PendingOperationDto>> ApproveAsync()
        {
            await using var db = database.NewContext();
            return await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId);
        }

        var results = await Task.WhenAll(ApproveAsync(), ApproveAsync());

        Assert.Equal(1, replayer.Calls);
        Assert.Equal(1, results.Count(r => r.IsSuccess));
        Assert.Equal(1, results.Count(r => r.IsFailure));

        await using var check = database.NewContext();
        var op = await check.PendingOperations.SingleAsync(x => x.Id == operationId);
        Assert.Equal(PendingOperationStatus.Approved, op.Status);
    }

    /// <summary>
    /// Operasyon başarısızsa sahiplenme BIRAKILMALI: kayıt Pending'e döner ve yeniden denenebilir
    /// (aksi hâlde Processing'de takılıp kalıcı olarak onaylanamaz hâle gelirdi).
    /// </summary>
    [MySqlFact]
    public async Task FailedApprove_ReleasesClaim_SoItCanBeRetried()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            var failed = await NewService(db, new CountingReplayer { ShouldFail = true })
                .ApproveAsync(tenantId, operationId, userId);
            Assert.True(failed.IsFailure);
        }

        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Pending, op.Status);
        }

        // İkinci deneme (bu kez başarılı) geçmeli.
        await using (var db = database.NewContext())
        {
            var retry = await NewService(db, new CountingReplayer()).ApproveAsync(tenantId, operationId, userId);
            Assert.True(retry.IsSuccess, retry.IsFailure ? retry.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Approved, op.Status);
        }
    }
}

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
        private int _applied;
        public int Calls => Volatile.Read(ref _calls);
        /// <summary>Hedefte GERÇEKTEN uygulanan mutasyon sayısı (idempotency taklidi ile).</summary>
        public int Applied => Volatile.Read(ref _applied);

        /// <summary>4xx benzeri KESİN iş kuralı reddi — hedef hiçbir şey uygulamaz.</summary>
        public bool DefiniteFailure { get; init; }

        /// <summary>
        /// Hedef commit eder ama YANIT KAYBOLUR (bağlantı koptu / 5xx). Sonuç bilinmez.
        /// Tekrar denemede aynı idempotency anahtarı geldiği için mutasyon TEKRARLANMAZ.
        /// </summary>
        public bool LoseResponseOnce { get; init; }

        private readonly HashSet<string> _appliedKeys = new();
        private int _responsesLost;

        public async Task<Result<Guid?>> ReplayAsync(string payloadJson, string idempotencyKey, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _calls);
            Assert.False(string.IsNullOrWhiteSpace(idempotencyKey), "Replay KARARLI idempotency anahtarı almalı.");

            // Gerçek replay bir HTTP çağrısıdır: sahiplenmenin yarışı gerçekten kapattığını
            // görebilmek için ikinci çağrıya zaman tanıyacak kadar bekle.
            await Task.Delay(250, cancellationToken);

            if (DefiniteFailure) return Result<Guid?>.Failure(Error.Validation("replay başarısız"));

            // HEDEFTEKİ IDEMPOTENCY: aynı anahtar ikinci kez gelirse iş TEKRAR YAPILMAZ.
            lock (_appliedKeys)
            {
                if (_appliedKeys.Add(idempotencyKey)) Interlocked.Increment(ref _applied);
            }

            if (LoseResponseOnce && Interlocked.Increment(ref _responsesLost) == 1)
            {
                // Commit oldu, yanıt yolda kayboldu → SONUÇ BİLİNMİYOR.
                return Result<Guid?>.Failure(new Error(IApprovalReplayer.UnknownOutcomeCode, "yanıt kayboldu"));
            }
            return Result<Guid?>.Success(Guid.CreateVersion7());
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
    /// HEDEF COMMIT ETTİ, YANIT KAYBOLDU → tekrar denendiğinde mutasyon TAM 1 kez uygulanmalı.
    ///
    /// <para>
    /// Eskiden taşıma hatası "başarısız" sayılıp kayıt Pending'e bırakılıyordu; yönetici tekrar
    /// onayladığında satış/tahsilat/silme İKİNCİ KEZ uygulanıyordu. Artık sonuç bilinmiyorsa
    /// sahiplenme bırakılmaz ve tekrar KARARLI idempotency anahtarıyla gider.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task LostResponseAfterCommit_Retry_AppliesMutationExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);
        var replayer = new CountingReplayer { LoseResponseOnce = true };

        // 1) İlk onay: hedef commit eder ama yanıt kaybolur → sonuç bilinmiyor.
        await using (var db = database.NewContext())
        {
            var first = await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId);
            Assert.True(first.IsFailure);
        }

        // Sahiplenme BIRAKILMAMALI: Pending'e dönerse ikinci onay işi tekrar uygulardı.
        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Processing, op.Status);
        }

        // 2) Hemen tekrar denemek REDDEDİLİR (sahiplenme henüz bayat değil).
        await using (var db = database.NewContext())
        {
            var tooSoon = await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId);
            Assert.True(tooSoon.IsFailure);
        }
        Assert.Equal(1, replayer.Calls);

        // 3) Sahiplenmeyi bayatlat (zaman aşımı) ve yeniden dene → bu kez sonuçlanır.
        await MakeClaimStaleAsync(database, operationId);
        await using (var db = database.NewContext())
        {
            var retry = await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId);
            Assert.True(retry.IsSuccess, retry.IsFailure ? retry.Error.Message : null);
        }

        // ASIL İDDİA: replay iki kez ÇAĞRILDI ama mutasyon TAM BİR KEZ uygulandı.
        Assert.Equal(2, replayer.Calls);
        Assert.Equal(1, replayer.Applied);

        await using (var final = database.NewContext())
        {
            var op = await final.PendingOperations.SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Approved, op.Status);
        }
    }

    /// <summary>Onay sürerken (Processing) RET yapılamaz — tek karar kalır.</summary>
    [MySqlFact]
    public async Task ApproveInProgress_ThenReject_IsRefused()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);
        var replayer = new CountingReplayer { LoseResponseOnce = true };

        await using (var db = database.NewContext())
        {
            var approve = await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId);
            Assert.True(approve.IsFailure); // yanıt kaybı → Processing'de kalır
        }

        await using (var db = database.NewContext())
        {
            var reject = await NewService(db, replayer)
                .RejectAsync(tenantId, operationId, userId, new RejectPendingOperationRequest("olmaz"));
            Assert.True(reject.IsFailure);
        }

        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == operationId);
            // Ret, sürmekte olan onayın sahiplenmesini EZMEMELİ.
            Assert.Equal(PendingOperationStatus.Processing, op.Status);
        }
    }

    /// <summary>Onay sürerken (Processing) geri çekme yapılamaz.</summary>
    [MySqlFact]
    public async Task ApproveInProgress_ThenCancel_IsRefused()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);
        var replayer = new CountingReplayer { LoseResponseOnce = true };

        await using (var db = database.NewContext())
        {
            Assert.True((await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId)).IsFailure);
        }

        await using (var db = database.NewContext())
        {
            var cancel = await NewService(db, replayer)
                .CancelAsync(tenantId, operationId, userId, UserRole.InstitutionOwner);
            Assert.True(cancel.IsFailure);
        }

        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Processing, op.Status);
        }
    }

    /// <summary>
    /// SÜREÇ ÇÖKMESİ SONRASI KURTARMA: Processing'de kalan kayıt zaman aşımından sonra yeniden
    /// denenebilir (kalıcı kilitlenme yok) ve idempotency mutasyonu tekrarlamaz.
    /// </summary>
    [MySqlFact]
    public async Task StaleProcessing_AfterCrash_CanBeRecovered()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);

        // Çökmüş süreç: kayıt Processing'de bırakılmış, hiçbir şey uygulanmamış olabilir.
        await using (var db = database.NewContext())
        {
            var op = await db.PendingOperations.SingleAsync(x => x.Id == operationId);
            op.BeginProcessing(userId);
            await db.SaveChangesAsync();
        }
        await MakeClaimStaleAsync(database, operationId);

        var replayer = new CountingReplayer();
        await using (var db = database.NewContext())
        {
            var recovered = await NewService(db, replayer).ApproveAsync(tenantId, operationId, userId);
            Assert.True(recovered.IsSuccess, recovered.IsFailure ? recovered.Error.Message : null);
        }
        Assert.Equal(1, replayer.Applied);
    }

    /// <summary>Sahiplenme damgasını zaman aşımının ötesine taşır (bayatlatır).</summary>
    private static async Task MakeClaimStaleAsync(MySqlTestDatabase database, Guid operationId)
    {
        await using var db = database.NewContext();
        var stale = DateTime.UtcNow.AddMinutes(-30);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE pending_operations SET UpdatedAtUtc = {0} WHERE Id = {1}", stale, operationId.ToString());
    }

    /// <summary>
    /// Operasyon KESİN başarısızsa (iş kuralı reddi) sahiplenme BIRAKILMALI: kayıt Pending'e döner
    /// ve yeniden denenebilir (aksi hâlde Processing'de takılıp kalıcı olarak onaylanamaz hâle gelirdi).
    /// </summary>
    [MySqlFact]
    public async Task FailedApprove_ReleasesClaim_SoItCanBeRetried()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var (tenantId, operationId, userId) = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            var failed = await NewService(db, new CountingReplayer { DefiniteFailure = true })
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

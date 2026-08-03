using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class PendingOperationService : IPendingOperationService
{
    private readonly GuzellikDbContext _db;
    private readonly IApprovalDispatcher _dispatcher;
    private readonly IApprovalReplayer _replayer;
    private readonly IAuditLogger _audit;
    private readonly IAppNotificationService _notifications;
    private readonly IRealtimeNotifier _realtime;

    public PendingOperationService(GuzellikDbContext db, IApprovalDispatcher dispatcher, IApprovalReplayer replayer, IAuditLogger audit, IAppNotificationService notifications, IRealtimeNotifier realtime)
    {
        _db = db;
        _dispatcher = dispatcher;
        _replayer = replayer;
        _audit = audit;
        _notifications = notifications;
        _realtime = realtime;
    }

    /// <summary>
    /// Karara bağlanan işlemin hangi ekranları tazelemesi gerektiği. Onay kapısı isteğin YOLUNU
    /// saklıyor; başlıktan/özetten yola çıkıp doğru konuları seçiyoruz ki istemci gereksiz yere
    /// her şeyi yeniden çekmesin.
    /// </summary>
    private static string[] TopicsFor(PendingOperation op)
    {
        var summary = op.Summary ?? string.Empty;
        bool Path(string part) => summary.Contains(part, StringComparison.OrdinalIgnoreCase);

        var topics = new List<string> { RealtimeTopics.Approvals, RealtimeTopics.Notifications };
        if (Path("/adisyonlar"))
        {
            // Adisyon onayı parayı cariye+kasaya işler ve paket satışıysa SEANS açar.
            topics.Add(RealtimeTopics.Adisyon);
            topics.Add(RealtimeTopics.Sessions);
            topics.Add(RealtimeTopics.Accounts);
        }
        if (Path("/appointments") || Path("/waitlist")) topics.Add(RealtimeTopics.Appointments);
        if (Path("/accounts")) topics.Add(RealtimeTopics.Accounts);
        return topics.Distinct().ToArray();
    }

    public async Task<Result<PagedResult<PendingOperationDto>>> ListAsync(Guid tenantId, PendingOperationFilter filter, PageRequest pageRequest, CancellationToken cancellationToken = default)
    {
        var query = _db.PendingOperations
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId);

        if (filter.Status.HasValue) query = query.Where(x => x.Status == filter.Status.Value);
        if (filter.RequestedByUserId.HasValue) query = query.Where(x => x.RequestedByUserId == filter.RequestedByUserId.Value);
        if (filter.OperationType.HasValue) query = query.Where(x => x.OperationType == filter.OperationType.Value);

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(x => x.RequestedAtUtc)
            .Skip(pageRequest.Skip)
            .Take(pageRequest.SafePageSize)
            .Select(x => x.ToDto())
            .ToArrayAsync(cancellationToken);
        return Result<PagedResult<PendingOperationDto>>.Success(new PagedResult<PendingOperationDto>(items, total, pageRequest.SafePage, pageRequest.SafePageSize));
    }

    /// <summary>
    /// Tekil bekleyen işlem. NESNE SAHİPLİĞİ SERVİSTE zorunlu tutulur: liste ucu personeli kendi
    /// isteklerine süzüyordu ama detay/iptal uçları yalnız tenant + Id ile sorguluyordu. DTO çözülmüş
    /// <c>PayloadJson</c> içerdiğinden (klinik kayıt, fotoğraf data URL'i, müşteri PII) Id'yi bilen bir
    /// personel başkasının isteğini okuyabiliyordu.
    /// </summary>
    /// <param name="actorUserId">İsteği yapan kullanıcı.</param>
    /// <param name="actorRole">Personel yalnız kendi kaydını görür; yönetici roller kurum içindeki tümünü.</param>
    public async Task<Result<PendingOperationDto>> GetAsync(Guid tenantId, Guid id, Guid actorUserId, UserRole? actorRole, CancellationToken cancellationToken = default)
    {
        var query = _db.PendingOperations.AsNoTracking().Where(x => x.TenantId == tenantId && x.Id == id);
        if (actorRole == UserRole.Staff) query = query.Where(x => x.RequestedByUserId == actorUserId);

        var op = await query.FirstOrDefaultAsync(cancellationToken);
        // Yetkisiz erişimde "yok" denir: var/yok bilgisi de sızmasın.
        return op is null ? Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı.")) : Result<PendingOperationDto>.Success(op.ToDto());
    }

    public async Task<Result<PendingOperationDto>> CreateAsync(Guid tenantId, Guid? branchId, Guid requestedByUserId, string requestedByName, CreatePendingOperationRequest request, CancellationToken cancellationToken = default)
    {
        var op = new PendingOperation(
            tenantId,
            branchId,
            requestedByUserId,
            requestedByName,
            request.OperationType,
            request.Title,
            request.Summary ?? string.Empty,
            request.PayloadJson);
        _db.PendingOperations.Add(op);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, branchId, "Submit", "PendingOperation", op.Id,
            $"Onaya gönderildi: {op.Title} ({op.OperationType})",
            new { op.OperationType, op.Title, op.Summary }, cancellationToken);

        // Kurum yöneticisi + şube yöneticisine "onay bekliyor" bildirimi (rol bazlı).
        await _notifications.NotifyRolesAsync(
            tenantId, branchId,
            new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
            AppNotificationType.ApprovalPending, AppNotificationSeverity.Warning,
            "Onay bekleyen işlem",
            $"{requestedByName}: {op.Title}",
            data: new { route = "/approvals", id = op.Id.ToString() },
            dedupeKey: $"pending:{op.Id}",
            ct: cancellationToken);

        // Yöneticinin AÇIK olan Onaylar sayfası/zil sayacı anında görsün.
        //
        // YALNIZ YETKİLİ YÖNETİCİLERE: eskiden bu olay kurum geneline (tenant grubuna) yayınlanıyor
        // ve personel adı + işlem başlığı + işlem id'sini taşıyordu — aynı kurumdaki yetkisiz
        // personel ya da BAŞKA ŞUBENİN çalışanı görmemesi gereken onay detayını alıyordu.
        var managerIds = await ApprovalManagerIdsAsync(tenantId, branchId, cancellationToken);
        foreach (var managerId in managerIds)
        {
            await _realtime.PublishToUserAsync(tenantId, managerId, new RealtimeEvent(
                "approval.pending",
                "Onay bekleyen işlem",
                $"{requestedByName}: {op.Title}",
                new[] { RealtimeTopics.Approvals, RealtimeTopics.Notifications },
                new Dictionary<string, string> { ["id"] = op.Id.ToString() }), cancellationToken);
        }

        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    /// <summary>
    /// İşlemi kilit altında SAHİPLENİR (Pending → Processing) ve HEMEN commit eder. Commit şart:
    /// asıl operasyon ayrı bir bağlantıda çalıştığından, sahiplenme onun görebileceği şekilde
    /// kalıcı olmalıdır. Dönen değer operasyonu yürütmek için gereken asgari veridir.
    /// </summary>
    private async Task<Result<(PendingOperationType Type, string PayloadJson)>> ClaimForProcessingAsync(
        Guid tenantId, Guid id, Guid decidedByUserId, CancellationToken ct)
    {
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

        if (relational) await RowLock.LockRowAsync(_db, "pending_operations", id, ct);

        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, ct);
        if (op is null)
            return Result<(PendingOperationType, string)>.Failure(Error.NotFound("İşlem bulunamadı."));
        // Kilitten önce okunmuş olabilir → kilit altında TAZE oku.
        if (relational) await _db.Entry(op).ReloadAsync(ct);

        if (op.Status != PendingOperationStatus.Pending)
        {
            return Result<(PendingOperationType, string)>.Failure(Error.Conflict(
                op.Status == PendingOperationStatus.Processing
                    ? "Bu işlem şu anda başka bir yönetici tarafından işleniyor."
                    : "Bu işlem zaten karara bağlanmış."));
        }

        op.BeginProcessing(decidedByUserId);
        await _db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return Result<(PendingOperationType, string)>.Success((op.OperationType, op.PayloadJson));
    }

    /// <summary>Operasyon başarısızsa sahiplenmeyi bırakır — işlem yeniden denenebilir kalsın.</summary>
    private async Task ReleaseClaimAsync(Guid tenantId, Guid id, CancellationToken ct)
    {
        try
        {
            var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, ct);
            if (op is null) return;
            op.ReleaseProcessing();
            await _db.SaveChangesAsync(ct);
        }
        catch
        {
            // Bırakma da başarısızsa asıl hatayı gölgeleme; işlem Processing'de kalır ve
            // yönetici listede "işleniyor" görür (veri bozulmaz, çift uygulama da olmaz).
        }
    }

    /// <summary>
    /// Onay bildirimlerinin gideceği YÖNETİCİ kullanıcıları. Onay detayı (personel adı, işlem
    /// başlığı) kurum geneline yayınlanmamalı: aynı kurumdaki yetkisiz personel ya da başka
    /// şubenin çalışanı görmemesi gereken bilgiyi alırdı. <c>NotifyRolesAsync</c> ile aynı kapsam
    /// kuralı: şube yöneticisi yalnız kendi şubesi (ya da kurum geneli kayıt) için dahil edilir.
    /// </summary>
    private async Task<List<Guid>> ApprovalManagerIdsAsync(Guid tenantId, Guid? branchId, CancellationToken ct)
    {
        var roles = new[] { UserRole.InstitutionOwner, UserRole.BranchManager };
        return await _db.TenantUsers.AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive && roles.Contains(u.Role)
                     && (u.BranchId == null || branchId == null || u.BranchId == branchId))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }

    public async Task<Result<PendingOperationDto>> ApproveAsync(Guid tenantId, Guid id, Guid decidedByUserId, CancellationToken cancellationToken = default)
    {
        // ---- 1) ATOMİK SAHİPLENME ----
        // Operasyon (HTTP replay) AYRI bir bağlantıda çalıştığı için bu metodun transaction'ı onu
        // KAPSAMAZ. Eskiden satır yalnızca yürütmeden SONRA Approved yapılıyordu: iki yönetici aynı
        // işlemi eşzamanlı onaylarsa ikisi de Pending okuyup ikisi de replay çalıştırabiliyordu —
        // satış/tahsilat/silme İKİ KEZ uygulanabilirdi. Satır kilit altında Processing'e çekilip
        // COMMIT edilir; ikinci çağrı kilidi bekler ve "zaten karara bağlanmış" görür.
        var claim = await ClaimForProcessingAsync(tenantId, id, decidedByUserId, cancellationToken);
        if (claim.IsFailure) return Result<PendingOperationDto>.Failure(claim.Error);
        var (operationType, payloadJson) = claim.Value;

        // ---- 2) ASIL OPERASYON ----
        Result<Guid?> dispatchResult;
        try
        {
            dispatchResult = operationType == PendingOperationType.HttpReplay
                ? await _replayer.ReplayAsync(payloadJson, cancellationToken)
                : await _dispatcher.DispatchAsync(tenantId, operationType, payloadJson, cancellationToken);
        }
        catch (Exception ex)
        {
            // Beklenmeyen hata da sahiplenmeyi bırakmalı; aksi hâlde işlem Processing'de takılır.
            await ReleaseClaimAsync(tenantId, id, cancellationToken);
            return Result<PendingOperationDto>.Failure(Error.Conflict($"Onaylanan işlem yürütülemedi: {ex.Message}"));
        }

        if (dispatchResult.IsFailure)
        {
            // ---- 3a) BAŞARISIZ → yeniden denenebilsin diye Pending'e geri bırak ----
            await ReleaseClaimAsync(tenantId, id, cancellationToken);
            return Result<PendingOperationDto>.Failure(dispatchResult.Error);
        }

        // ---- 3b) BAŞARILI → kesinleştir ----
        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));
        op.Approve(decidedByUserId, dispatchResult.Value);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, op.BranchId, "Approve", "PendingOperation", op.Id,
            $"Onaylandı: {op.Title} ({op.OperationType}) · gönderen {op.RequestedByName}",
            new { op.OperationType, op.Title, op.RequestedByName, op.ResultEntityId }, cancellationToken);

        // KALICI bildirim: personel o an çevrimdışı olsa bile sonucu bildirim akışında (web + mobil
        // feed + FCM push) görür. Anlık push yalnızca AÇIK ekranı hemen tazelemek içindir.
        await _notifications.NotifyUserAsync(
            tenantId, op.BranchId, op.RequestedByUserId,
            AppNotificationType.ApprovalApproved, AppNotificationSeverity.Success,
            "İşleminiz onaylandı",
            op.Title,
            data: new { route = "/approvals", id = op.Id.ToString() },
            dedupeKey: $"pending-approved:{op.Id}",
            ct: cancellationToken);

        var topics = TopicsFor(op);
        await _realtime.PublishToUserAsync(tenantId, op.RequestedByUserId, new RealtimeEvent(
            "approval.approved", "İşleminiz onaylandı", op.Title, topics,
            new Dictionary<string, string> { ["id"] = op.Id.ToString() }), cancellationToken);
        // Kurum genelinde de duyur: onaylanan işlem cariyi/seansı/randevuyu değiştirdi, açık
        // olan diğer ekranlar (yönetici listesi, ikinci sekme) bayat kalmasın.
        // SAF TAZELEME: başlık/mesaj/işlem id'si TAŞIMAZ — bu olay kurumdaki herkese gider.
        await _realtime.PublishToTenantAsync(tenantId, new RealtimeEvent(
            "approval.resolved", null, null, topics), cancellationToken);

        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    public async Task<Result<PendingOperationDto>> RejectAsync(Guid tenantId, Guid id, Guid decidedByUserId, RejectPendingOperationRequest request, CancellationToken cancellationToken = default)
    {
        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));
        if (op.Status != PendingOperationStatus.Pending) return Result<PendingOperationDto>.Failure(Error.Conflict("Bu işlem zaten karara bağlanmış."));

        op.Reject(decidedByUserId, request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, op.BranchId, "Reject", "PendingOperation", op.Id,
            $"Reddedildi: {op.Title} · {op.RejectionReason}",
            new { op.OperationType, op.RejectionReason, op.RequestedByName }, cancellationToken);

        await _notifications.NotifyUserAsync(
            tenantId, op.BranchId, op.RequestedByUserId,
            AppNotificationType.ApprovalRejected, AppNotificationSeverity.Warning,
            "İşleminiz reddedildi",
            string.IsNullOrWhiteSpace(op.RejectionReason) ? op.Title : $"{op.Title} · {op.RejectionReason}",
            data: new { route = "/approvals", id = op.Id.ToString() },
            dedupeKey: $"pending-rejected:{op.Id}",
            ct: cancellationToken);

        await _realtime.PublishToUserAsync(tenantId, op.RequestedByUserId, new RealtimeEvent(
            "approval.rejected", "İşleminiz reddedildi",
            string.IsNullOrWhiteSpace(op.RejectionReason) ? op.Title : $"{op.Title} · {op.RejectionReason}",
            new[] { RealtimeTopics.Approvals, RealtimeTopics.Notifications },
            new Dictionary<string, string> { ["id"] = op.Id.ToString() }), cancellationToken);
        // SAF TAZELEME (bkz. ApproveAsync): kurum geneline giden olay veri taşımaz.
        await _realtime.PublishToTenantAsync(tenantId, new RealtimeEvent(
            "approval.resolved", null, null,
            new[] { RealtimeTopics.Approvals, RealtimeTopics.Notifications }), cancellationToken);

        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    /// <summary>Bekleyen isteği geri çeker. Personel YALNIZ kendi isteğini iptal edebilir (bkz. <see cref="GetAsync"/>).</summary>
    public async Task<Result> CancelAsync(Guid tenantId, Guid id, Guid decidedByUserId, UserRole? actorRole, CancellationToken cancellationToken = default)
    {
        var query = _db.PendingOperations.Where(x => x.TenantId == tenantId && x.Id == id);
        if (actorRole == UserRole.Staff) query = query.Where(x => x.RequestedByUserId == decidedByUserId);

        var op = await query.FirstOrDefaultAsync(cancellationToken);
        if (op is null) return Result.Failure(Error.NotFound("İşlem bulunamadı."));
        if (op.Status != PendingOperationStatus.Pending) return Result.Failure(Error.Conflict("Bu işlem zaten karara bağlanmış."));

        op.Cancel(decidedByUserId);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

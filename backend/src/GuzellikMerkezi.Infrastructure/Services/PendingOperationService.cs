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

    /// <summary>Onay replay'inin çalışacağı İSTEK SAHİBİ kapsamı (bkz. <see cref="IApprovalRequesterScope"/>).</summary>
    private readonly IApprovalRequesterScope? _requesterScope;

    public PendingOperationService(GuzellikDbContext db, IApprovalDispatcher dispatcher, IApprovalReplayer replayer, IAuditLogger audit, IAppNotificationService notifications, IRealtimeNotifier realtime, IApprovalRequesterScope? requesterScope = null)
    {
        _db = db;
        _dispatcher = dispatcher;
        _replayer = replayer;
        _audit = audit;
        _notifications = notifications;
        _realtime = realtime;
        _requesterScope = requesterScope;
    }


    /// <summary>
    /// ŞUBE YETKİ SINIRI. Kurum yöneticisi kurumun tamamını yönetir; ŞUBE YÖNETİCİSİ yalnız kendi
    /// şubesinin (ve şubesiz = kurum geneli) işlemlerini görebilir/karara bağlayabilir.
    /// Bildirimi/arayüzü şubeye göre süzmek yetkilendirme DEĞİLDİR: doğrudan API çağıran bir şube
    /// yöneticisi başka şubenin onayını okuyabiliyor ve onaylayabiliyordu. Kapı burada.
    /// </summary>
    private static bool OutOfBranchScope(PendingOperation op, UserRole? actorRole, Guid? actorBranchId) =>
        actorRole == UserRole.BranchManager
        && op.BranchId is not null
        && op.BranchId != actorBranchId;

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

    public async Task<Result<PagedResult<PendingOperationDto>>> ListAsync(Guid tenantId, PendingOperationFilter filter, PageRequest pageRequest, UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default)
    {
        var query = _db.PendingOperations
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId);

        // Şube yöneticisi yalnız kendi şubesi + kurum geneli (şubesiz) kayıtları görür.
        if (actorRole == UserRole.BranchManager)
            query = query.Where(x => x.BranchId == null || x.BranchId == actorBranchId);

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
    public async Task<Result<PendingOperationDto>> GetAsync(Guid tenantId, Guid id, Guid actorUserId, UserRole? actorRole, Guid? actorBranchId = null, CancellationToken cancellationToken = default)
    {
        var query = _db.PendingOperations.AsNoTracking().Where(x => x.TenantId == tenantId && x.Id == id);
        if (actorRole == UserRole.Staff) query = query.Where(x => x.RequestedByUserId == actorUserId);
        if (actorRole == UserRole.BranchManager)
            query = query.Where(x => x.BranchId == null || x.BranchId == actorBranchId);

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
    /// Sahiplenmenin bayat sayılacağı süre. Bu süreden eski bir Processing kaydı yeniden
    /// denenebilir; replay idempotent olduğu için tekrar iş üretmez.
    /// <para>
    /// TEK KAYNAK <see cref="PendingOperation.ProcessingTimeout"/>: yeniden sahiplenme, "takıldı"
    /// rozeti ve elle çözüm kapısı aynı eşiği kullanmak ZORUNDA — biri diğerinden erken açılırsa
    /// elle çözüm sürmekte olan bir replay'in üzerine yazar.
    /// </para>
    /// </summary>
    private static TimeSpan ProcessingTimeout => PendingOperation.ProcessingTimeout;

    /// <summary>
    /// Replay'in KARARLI idempotency anahtarı: işlem Id'sinden türetilir, tekrarlar arasında
    /// değişmez. "sys:" ön eki anahtarın kullanıcıya değil KURUMA bağlı kapsanmasını sağlar
    /// (bkz. IdempotencyMiddleware) — onayı başlatan ve tekrar deneyen yönetici farklı olabilir.
    /// </summary>
    private static string ReplayIdempotencyKey(Guid operationId) => $"sys:pendingop:{operationId:N}";

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

        // BAYAT SAHİPLENME YENİDEN DENENEBİLİR. Replay'in sonucu bilinmediğinde (bağlantı koptu,
        // 5xx, süreç çöktü) işlem Processing'de kalır. Süresiz kilitlenmesin diye zaman aşımından
        // sonra yeniden sahiplenilebilir; tekrar KARARLI idempotency anahtarıyla gittiği için
        // hedef işi ikinci kez uygulamaz (bkz. ApproveAsync → ReplayIdempotencyKey).
        var reclaimable = op.IsClaimStale(DateTime.UtcNow);

        if (op.Status != PendingOperationStatus.Pending && !reclaimable)
        {
            return Result<(PendingOperationType, string)>.Failure(Error.Conflict(
                op.Status == PendingOperationStatus.Processing
                    ? "Bu işlem şu anda işleniyor. Sonucu belirsizse birkaç dakika sonra yeniden deneyin; "
                      + "hâlâ takılıysa \"Elle çöz\" ile kapatabilirsiniz."
                    : "Bu işlem zaten karara bağlanmış."));
        }

        op.BeginProcessing(decidedByUserId, reclaimable);
        await _db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return Result<(PendingOperationType, string)>.Success((op.OperationType, op.PayloadJson));
    }

    /// <summary>
    /// GENERIC DISPATCH'İ TAM BİR KEZ UYGULAR.
    ///
    /// <para>
    /// HttpReplay yolunda bu güvenceyi <c>IdempotencyMiddleware</c> veriyordu: replay isteği kararlı
    /// <c>sys:</c> anahtarıyla gidiyor, tekrar denemede endpoint yeniden ÇALIŞMIYORdu. Generic
    /// dispatcher ise servisleri doğrudan çağırdığı için HTTP hattına hiç uğramıyor ve hiçbir koruma
    /// altında değildi. Somut hata: tahsilat/gider/stok hareketi commit edildikten SONRA, bekleyen
    /// kayıt "Approved" yapılmadan süreç çökerse (ya da yanıt kaybolursa) kayıt Processing'de kalır;
    /// zaman aşımından sonra yeniden sahiplenilir ve AYNI hareket ikinci kez oluşurdu.
    /// </para>
    /// <para>
    /// SIRA: anahtar önce REZERVE EDİLİR (kalıcı), iş sonra yapılır. Tersi olsaydı eşzamanlı iki
    /// deneme (ya da retry ile orijinalin yarışı) rezervasyonu birlikte geçip işi iki kez yapardı.
    /// Anahtar <see cref="ReplayIdempotencyKey"/> ile aynıdır: kurum kapsamlı ve işlem kimliğinden
    /// türediği için hangi yönetici tekrar denerse denesin aynı kapıya çarpar.
    /// </para>
    /// <para>
    /// ÜÇ SONUÇ: (1) daha önce uygulanmış → iş TEKRARLANMAZ, saklanan sonuç kimliği döner ve
    /// bekleyen kayıt normal şekilde Approved'a geçer; (2) önceki deneme sürüyor / sonucu belirsiz →
    /// "sonuç doğrulanamadı" (sahiplenme bırakılmaz, insan doğrular); (3) taze rezervasyon → iş
    /// yapılır. İş kuralı reddinde (hedef hiçbir şey uygulamadı) rezervasyon SERBEST bırakılır ki
    /// düzeltilip yeniden onaylanabilsin.
    /// </para>
    /// </summary>
    private async Task<Result<Guid?>> DispatchOnceAsync(
        Guid tenantId, Guid id, PendingOperationType operationType, string payloadJson, CancellationToken ct)
    {
        var claim = await OperationIdempotency.TryBeginAsync(
            _db, tenantId, ReplayIdempotencyKey(id), "DISPATCH", $"/approvals/{operationType}", ct);

        if (claim.Kind == OperationIdempotency.ClaimKind.AlreadyApplied)
            return Result<Guid?>.Success(claim.ResultEntityId);

        if (claim.Kind == OperationIdempotency.ClaimKind.Unresolved)
        {
            return Result<Guid?>.Failure(new Error(IApprovalReplayer.UnknownOutcomeCode,
                "Bu işlemin önceki denemesi sürüyor ya da sonucu doğrulanamadı; işlem ikinci kez uygulanmadı. "
                + "Hedef kaydı kontrol edip \"Elle çöz\" ile kapatın."));
        }

        Result<Guid?> result;
        try
        {
            result = await _dispatcher.DispatchAsync(tenantId, operationType, payloadJson, ct);
        }
        catch
        {
            // SONUÇ BİLİNMİYOR: hedef commit etmiş olabilir → rezervasyonu SİLME, damgala.
            await OperationIdempotency.MarkOutcomeUnknownAsync(_db, claim.ReservationId);
            throw;
        }

        if (result.IsFailure)
        {
            // İş kuralı reddi: dispatcher hedef servisi çağırdı, servis kendi transaction'ında
            // doğrulamada durdu → hiçbir şey uygulanmadı. Anahtar dürüst tekrara açık kalmalı.
            await OperationIdempotency.ReleaseAsync(_db, claim.ReservationId);
            return result;
        }

        // İŞ UYGULANDI. Kayıt tutulamazsa (nadir) anahtarı "sonuç belirsiz" damgalarız: bu istek
        // başarıyla tamamlanacağı için tekrar beklenmiyor, ama olası bir tekrar işi yinelemesin.
        if (!await OperationIdempotency.CompleteAsync(_db, claim.ReservationId, result.Value))
            await OperationIdempotency.MarkOutcomeUnknownAsync(_db, claim.ReservationId);

        return result;
    }

    /// <summary>
    /// Kapsam dışıysa hata döndürür (yoksa null). Yetkisizde "yok" denir: var/yok bilgisi sızmasın.
    /// </summary>
    private async Task<Error?> EnsureInScopeAsync(Guid tenantId, Guid id, UserRole? actorRole, Guid? actorBranchId, CancellationToken ct)
    {
        if (actorRole != UserRole.BranchManager) return null;
        var op = await _db.PendingOperations.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, ct);
        if (op is null) return Error.NotFound("İşlem bulunamadı.");
        return OutOfBranchScope(op, actorRole, actorBranchId) ? Error.NotFound("İşlem bulunamadı.") : null;
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
        // ROL SÜZGECİ BELLEKTE. MySql.EntityFrameworkCore, yerel bir dizi üzerinden yapılan
        // .Contains() çağrısını sunucuda çeviremiyor ("Expression '@roles' ... does not have a type
        // mapping assigned") → sorgu 500 atardı ve personelin HER yazma isteği hata alırdı.
        // Kurum kullanıcı sayısı küçük; süzme bellekte yapılır (AppNotificationService ile aynı desen).
        var candidates = await _db.TenantUsers.AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive)
            .Select(u => new { u.Id, u.Role, u.BranchId })
            .ToListAsync(ct);

        return candidates
            .Where(u => u.Role is UserRole.InstitutionOwner or UserRole.BranchManager)
            .Where(u => IsApprovalAudience(u.Role, u.BranchId, branchId))
            .Select(u => u.Id)
            .ToList();
    }

    /// <summary>
    /// BİLDİRİM KAPSAMI = YETKİ KAPSAMI. Kural <see cref="OutOfBranchScope"/> / ListAsync / GetAsync
    /// ile birebir aynıdır: yönetici yalnızca GÖREBİLDİĞİ işlem için haberdar edilir.
    /// <para>
    /// Eski kural KULLANICININ şubesizliğine bakıyordu ("BranchId = null → kurum geneli yetki"):
    /// şubesi atanmamış bir ŞUBE YÖNETİCİSİ böylece TÜM şubelerin onay bildirimlerini alıyordu —
    /// personel adı, işlem başlığı, bekleyen işlem Id'si ve onay ekranı bağlantısı dâhil. Doğru
    /// ölçüt İŞLEMİN şubesidir: şubesiz işlem (kurum geneli) herkese, şubeli işlem yalnız o şubenin
    /// yöneticisine gider. Şubesiz yönetici böylece hiçbir şubenin işlemini görmez (fail-closed).
    /// </para>
    /// </summary>
    private static bool IsApprovalAudience(UserRole role, Guid? userBranchId, Guid? operationBranchId)
    {
        if (role == UserRole.InstitutionOwner) return true;   // kurumun tamamını yönetir
        return operationBranchId is null || userBranchId == operationBranchId;
    }

    public async Task<Result<PendingOperationDto>> ApproveAsync(Guid tenantId, Guid id, Guid decidedByUserId, UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default)
    {
        var scope = await EnsureInScopeAsync(tenantId, id, actorRole, actorBranchId, cancellationToken);
        if (scope is not null) return Result<PendingOperationDto>.Failure(scope);

        // ---- 0) İSTEK SAHİBİNİN KAPSAMI (yalnız HttpReplay) ----
        //
        // Replay eskiden ONAYLAYANIN token'ıyla çalışıyordu: personelin isteği kurum sahibinin
        // yetkisiyle uygulanıyor, kapsam denetimleri yanlış kimliğe göre değerlendiriliyordu
        // (bkz. IApprovalRequesterScope). Kapsam SAHİPLENMEDEN ÖNCE üretilir: doğrulama başarısızsa
        // kayıt Processing'de kalmaz, hiçbir mutasyon olmaz ve yönetici gerçek sebebi görür.
        var meta = await _db.PendingOperations.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == id)
            .Select(x => new { x.OperationType, x.RequestedByUserId, x.BranchId, x.Status })
            .FirstOrDefaultAsync(cancellationToken);
        if (meta is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));

        string? requesterAccessToken = null;
        if (meta.OperationType == PendingOperationType.HttpReplay)
        {
            if (_requesterScope is null)
            {
                return Result<PendingOperationDto>.Failure(Error.Conflict(
                    "Onay replay'i için istek sahibi kapsamı yapılandırılmamış; işlem uygulanmadı."));
            }
            var requesterScope = await _requesterScope.CreateAccessTokenAsync(
                tenantId, meta.RequestedByUserId, meta.BranchId, id, cancellationToken);
            if (requesterScope.IsFailure) return Result<PendingOperationDto>.Failure(requesterScope.Error);
            requesterAccessToken = requesterScope.Value;
        }

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
                ? await _replayer.ReplayAsync(payloadJson, ReplayIdempotencyKey(id), requesterAccessToken ?? string.Empty, cancellationToken)
                : await DispatchOnceAsync(tenantId, id, operationType, payloadJson, cancellationToken);
        }
        catch (Exception ex)
        {
            // SONUÇ BİLİNMİYOR → sahiplenmeyi BIRAKMA. İşlem uygulanmış olabilir; Pending'e
            // döndürüp yeniden onaylatmak onu ikinci kez uygulama riski taşır. Zaman aşımından
            // sonra yeniden denenebilir ve o deneme idempotent anahtarla gider.
            return Result<PendingOperationDto>.Failure(Error.Conflict(
                $"İşlemin sonucu doğrulanamadı: {ex.Message} Birkaç dakika sonra yeniden deneyin."));
        }

        if (dispatchResult.IsFailure)
        {
            // ---- 3a) BAŞARISIZ ----
            // KESİN başarısızsa (4xx: iş kuralı reddi, hedef hiçbir şey uygulamadı) Pending'e bırak.
            // SONUÇ BİLİNMİYORSA (taşıma hatası / 5xx) BIRAKMA: uygulanmış olabilir.
            if (dispatchResult.Error.Code != IApprovalReplayer.UnknownOutcomeCode)
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

    public async Task<Result<PendingOperationDto>> RejectAsync(Guid tenantId, Guid id, Guid decidedByUserId, RejectPendingOperationRequest request, UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default)
    {
        var scope = await EnsureInScopeAsync(tenantId, id, actorRole, actorBranchId, cancellationToken);
        if (scope is not null) return Result<PendingOperationDto>.Failure(scope);

        // ONAYLA AYNI KİLİT PROTOKOLÜ. Ret/iptal eskiden kilide katılmıyordu: bir yönetici
        // onaylarken (kayıt Processing, replay sürüyor) diğeri bayat okuduğu Pending nesne
        // üzerinden Rejected yazıp sahiplenmeyi EZEBİLİYORDU — iş uygulanmış ama kayıt
        // "reddedildi" görünürdü. Kilit + taze okuma bunu tek karara indirger.
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational) await RowLock.LockRowAsync(_db, "pending_operations", id, cancellationToken);

        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));
        if (relational) await _db.Entry(op).ReloadAsync(cancellationToken);
        if (op.Status != PendingOperationStatus.Pending)
        {
            return Result<PendingOperationDto>.Failure(Error.Conflict(
                op.Status == PendingOperationStatus.Processing
                    ? "Bu işlem şu anda onaylanıyor; reddedilemez."
                    : "Bu işlem zaten karara bağlanmış."));
        }

        op.Reject(decidedByUserId, request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
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

    /// <summary>
    /// TAKILI İŞLEMİN ELLE ÇÖZÜMÜ (dead-letter çıkışı).
    ///
    /// <para>
    /// SOMUT AÇIK: replay'in sonucu doğrulanamadığında (bağlantı koptu, süreç çöktü, 5xx) kayıt
    /// Processing'de, idempotency rezervasyonu da "çözülmemiş" kalır. Zaman aşımından sonra yeniden
    /// sahiplenme mümkündür ama tekrar denemesi rezervasyona çarpıp yine "sonuç doğrulanamadı" der:
    /// işlem SONSUZA DEK takılı kalır. Otomatik bir çıkış yolu YOKTUR — sistem hedefin commit edip
    /// etmediğini bilemez. Tek doğru çözüm insan kararıdır: yetkili hedef kaydı (satış, tahsilat,
    /// stok hareketi) kontrol eder ve gerçeği bildirir.
    /// </para>
    /// <para>
    /// GÜVENLİK KAPILARI: (1) yalnız zaman aşımını geçmiş kayıt — sürmekte olan replay ezilmez;
    /// (2) satır kilidi + taze okuma — karar ile yeniden sahiplenme yarışmaz; (3) zorunlu not ve
    /// denetim kaydı — kararın kim tarafından, neye bakılarak verildiği kalıcı olarak durur;
    /// (4) defterle çelişki reddedilir: rezervasyon "uygulandı" diyorken "uygulanmadı" denemez.
    /// </para>
    /// </summary>
    public async Task<Result<PendingOperationDto>> ResolveStuckAsync(
        Guid tenantId, Guid id, Guid decidedByUserId, ResolveStuckOperationRequest request,
        UserRole? actorRole = null, Guid? actorBranchId = null, CancellationToken cancellationToken = default)
    {
        // Personel kendi işlemini "uygulandı" ilan edemez — onay kapısının tamamını atlatırdı.
        if (actorRole == UserRole.Staff)
            return Result<PendingOperationDto>.Failure(Error.Forbidden("Takılı işlemi yalnızca yönetici çözebilir."));

        var scope = await EnsureInScopeAsync(tenantId, id, actorRole, actorBranchId, cancellationToken);
        if (scope is not null) return Result<PendingOperationDto>.Failure(scope);

        var note = request.Note?.Trim() ?? string.Empty;
        if (note.Length < 5)
        {
            return Result<PendingOperationDto>.Failure(Error.Validation(
                "Neyin doğrulandığını yazın (en az 5 karakter): bu karar denetim kaydına işlenir."));
        }

        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational) await RowLock.LockRowAsync(_db, "pending_operations", id, cancellationToken);

        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));
        if (relational) await _db.Entry(op).ReloadAsync(cancellationToken);

        if (!op.IsClaimStale(DateTime.UtcNow))
        {
            return Result<PendingOperationDto>.Failure(Error.Conflict(
                op.Status == PendingOperationStatus.Processing
                    ? $"İşlem hâlâ sürüyor olabilir. Elle çözüm ancak {ProcessingTimeout.TotalMinutes:0} dakikalık "
                      + "zaman aşımından sonra açılır."
                    : "Bu işlem takılı değil; elle çözüme gerek yok."));
        }

        // Rezervasyonu ÖNCE çöz: kayıt Approved'a geçtiği hâlde anahtar "çözülmemiş" kalırsa aynı
        // iş başka bir yoldan bir daha denendiğinde yine duvara çarpardı.
        if (!await OperationIdempotency.ResolveUnknownAsync(_db, tenantId, ReplayIdempotencyKey(id), request.Applied, cancellationToken))
        {
            return Result<PendingOperationDto>.Failure(Error.Conflict(
                "Kayıtlara göre bu işlem HEDEFTE UYGULANMIŞ. \"Uygulanmadı\" olarak kapatılamaz — "
                + "aksi hâlde ikinci kez uygulanabilirdi. Hedef kaydı yeniden kontrol edin."));
        }

        var previousStatus = op.Status;
        if (request.Applied) op.Approve(decidedByUserId, op.ResultEntityId);
        else op.ReleaseProcessing();

        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);

        await _audit.LogAsync(tenantId, op.BranchId, "ResolveStuck", "PendingOperation", op.Id,
            request.Applied
                ? $"Takılı işlem UYGULANMIŞ olarak kapatıldı: {op.Title} · {note}"
                : $"Takılı işlem UYGULANMAMIŞ olarak açıldı (yeniden onaylanabilir): {op.Title} · {note}",
            new { op.OperationType, op.Title, op.RequestedByName, request.Applied, Note = note, PreviousStatus = previousStatus },
            cancellationToken);

        if (request.Applied)
        {
            await _notifications.NotifyUserAsync(
                tenantId, op.BranchId, op.RequestedByUserId,
                AppNotificationType.ApprovalApproved, AppNotificationSeverity.Success,
                "İşleminiz onaylandı",
                op.Title,
                data: new { route = "/approvals", id = op.Id.ToString() },
                dedupeKey: $"pending-approved:{op.Id}",
                ct: cancellationToken);
        }

        // SAF TAZELEME (bkz. ApproveAsync): açık onay ekranları takılı kaydı bayat göstermesin.
        await _realtime.PublishToTenantAsync(tenantId, new RealtimeEvent(
            "approval.resolved", null, null, TopicsFor(op)), cancellationToken);

        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    /// <summary>Bekleyen isteği geri çeker. Personel YALNIZ kendi isteğini iptal edebilir (bkz. <see cref="GetAsync"/>).</summary>
    public async Task<Result> CancelAsync(Guid tenantId, Guid id, Guid decidedByUserId, UserRole? actorRole, Guid? actorBranchId = null, CancellationToken cancellationToken = default)
    {
        // Onay/ret ile AYNI kilit protokolü (bkz. RejectAsync): geri çekme, sürmekte olan bir
        // onayın sahiplenmesini ezmemeli.
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational) await RowLock.LockRowAsync(_db, "pending_operations", id, cancellationToken);

        var query = _db.PendingOperations.Where(x => x.TenantId == tenantId && x.Id == id);
        if (actorRole == UserRole.Staff) query = query.Where(x => x.RequestedByUserId == decidedByUserId);
        if (actorRole == UserRole.BranchManager)
            query = query.Where(x => x.BranchId == null || x.BranchId == actorBranchId);

        var op = await query.FirstOrDefaultAsync(cancellationToken);
        if (op is null) return Result.Failure(Error.NotFound("İşlem bulunamadı."));
        if (relational) await _db.Entry(op).ReloadAsync(cancellationToken);
        if (op.Status != PendingOperationStatus.Pending)
        {
            return Result.Failure(Error.Conflict(
                op.Status == PendingOperationStatus.Processing
                    ? "Bu işlem şu anda onaylanıyor; geri çekilemez."
                    : "Bu işlem zaten karara bağlanmış."));
        }

        op.Cancel(decidedByUserId);
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        return Result.Success();
    }
}

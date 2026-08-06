using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Personel tarafından yapılan ve kurum yöneticisi onayı bekleyen işlem.
/// Payload JSON formatında saklanır — onaylandığında ApprovalDispatcher tip'e göre yürütür.
/// </summary>
public sealed class PendingOperation : Entity
{
    private PendingOperation() { }

    public PendingOperation(
        Guid tenantId,
        Guid? branchId,
        Guid requestedByUserId,
        string requestedByName,
        PendingOperationType operationType,
        string title,
        string summary,
        string payloadJson,
        DateTime? requesterSecurityStampUtc = null)
    {
        RequesterSecurityStampUtc = requesterSecurityStampUtc;
        TenantId = tenantId;
        BranchId = branchId;
        RequestedByUserId = requestedByUserId;
        RequestedByName = string.IsNullOrWhiteSpace(requestedByName) ? "Personel" : requestedByName.Trim();
        OperationType = operationType;
        Title = string.IsNullOrWhiteSpace(title) ? operationType.ToString() : title.Trim();
        Summary = string.IsNullOrWhiteSpace(summary) ? null : summary.Trim();
        if (string.IsNullOrWhiteSpace(payloadJson)) throw new DomainException("Payload boş olamaz.");
        PayloadJson = payloadJson;
        Status = PendingOperationStatus.Pending;
        RequestedAtUtc = DateTime.UtcNow;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public Guid RequestedByUserId { get; private set; }
    public TenantUser? RequestedBy { get; private set; }
    public string RequestedByName { get; private set; } = string.Empty;

    /// <summary>
    /// İSTEK GÖNDERİLDİĞİ ANDAKİ GÜVENLİK DAMGASI.
    ///
    /// <para>
    /// Damga; parola değişimi, zorunlu çıkış ya da yetki değişimi gibi "bu kullanıcının tüm
    /// oturumlarını düşür" olaylarında tazelenir. Onay replay'i istek sahibi adına YENİ ve kısa
    /// ömürlü bir token üretir; damga karşılaştırılmazsa bu token iptal olayını sessizce atlar —
    /// hesabı ele geçirilmiş bir personelin kuyrukta bekleyen isteği, parola sıfırlandıktan SONRA
    /// bile uygulanabilirdi. Onay anında damga değişmişse işlem uygulanmaz (bkz. ApprovalRequesterScope).
    /// </para>
    /// <para>
    /// KOLON EKLENMEDEN ÖNCE OLUŞMUŞ KAYITLARDA BOŞTUR VE BOŞ OLMASI FAIL-CLOSED'DIR: damgası
    /// bilinmeyen bir istek onaylanamaz, personelden yeniden göndermesi istenir. Bu kayıtlara
    /// "bugünkü damga" yazmak korumayı tersine çevirirdi — iptal edilmiş bir yetki yeniden
    /// geçerli görünürdü (bkz. migration <c>PendingApprovalStampBackfillRollback</c>).
    /// </para>
    /// </summary>
    public DateTime? RequesterSecurityStampUtc { get; private set; }

    public PendingOperationType OperationType { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string? Summary { get; private set; }
    public string PayloadJson { get; private set; } = string.Empty;

    public PendingOperationStatus Status { get; private set; }
    public DateTime RequestedAtUtc { get; private set; }
    public DateTime? DecidedAtUtc { get; private set; }
    public Guid? DecidedByUserId { get; private set; }
    public TenantUser? DecidedBy { get; private set; }
    public string? RejectionReason { get; private set; }

    /// <summary>Onaylandıktan sonra üretilen kaydın ID'si (audit için)</summary>
    public Guid? ResultEntityId { get; private set; }

    /// <summary>
    /// Sahiplenmenin bayat sayılacağı süre. TEK KAYNAK: hem yeniden sahiplenme (ApproveAsync), hem
    /// "takıldı" rozeti (DTO), hem de elle çözüm kapısı bunu kullanır. Ayrı ayrı tanımlansaydı biri
    /// diğerinden önce açılır ve elle çözüm SÜRMEKTE OLAN bir replay'in üzerine yazabilirdi.
    /// </summary>
    public static readonly TimeSpan ProcessingTimeout = TimeSpan.FromMinutes(2);

    /// <summary>
    /// İşlem TAKILDI mı: sahiplenilmiş ama zaman aşımını geçmiş. Sonucu bilinmeyen bir replay
    /// (bağlantı koptu / süreç çöktü) kaydı Processing'de bırakır; bu bayrak onu hem yeniden
    /// denemeye hem de elle çözüme açar.
    /// </summary>
    public bool IsClaimStale(DateTime nowUtc) =>
        Status == PendingOperationStatus.Processing
        && (UpdatedAtUtc ?? RequestedAtUtc) <= nowUtc - ProcessingTimeout;

    /// <summary>
    /// İşlemi SAHİPLENİR (Pending → Processing). Kilit altında çağrılıp hemen commit edilmelidir:
    /// asıl operasyon ayrı bir bağlantıda (HTTP replay) çalıştığı için tek koruma budur.
    /// </summary>
    /// <param name="allowReclaim">
    /// true → bayat kalmış bir Processing kaydı yeniden sahiplenilebilir (sonucu bilinmeyen
    /// replay'in tekrarı). Replay idempotent olduğundan iş ikinci kez uygulanmaz.
    /// </param>
    public void BeginProcessing(Guid decidedByUserId, bool allowReclaim = false)
    {
        var allowed = Status == PendingOperationStatus.Pending
                      || (allowReclaim && Status == PendingOperationStatus.Processing);
        if (!allowed) throw new BusinessRuleException("Sadece bekleyen işlemler onaylanabilir.");
        Status = PendingOperationStatus.Processing;
        DecidedByUserId = decidedByUserId;
        Touch();
    }

    /// <summary>
    /// SAHİPLENMEYİ CANLI TUTAR (kalp atışı).
    ///
    /// <para>
    /// "Bayat" ölçütü sahiplenme ANINDAN itibaren sayıldığı sürece, <see cref="ProcessingTimeout"/>
    /// süresinden UZUN SÜREN ama hâlâ çalışan bir operasyon da bayat görünüyordu: yönetici onu
    /// "uygulanmadı" diye kapatıp idempotency rezervasyonunu sildirebiliyor, işlem yeniden
    /// onaylanınca AYNI finansal hareket ikinci kez oluşabiliyordu. Operasyon sürerken damga
    /// düzenli olarak tazelenir; böylece "bayat" gerçekten "artık kimse yürütmüyor" demek olur.
    /// </para>
    /// </summary>
    public void RenewClaim()
    {
        if (Status != PendingOperationStatus.Processing) return;
        Touch();
    }

    /// <summary>Operasyon başarısız oldu → yeniden denenebilmesi için Pending'e döner.</summary>
    public void ReleaseProcessing()
    {
        if (Status != PendingOperationStatus.Processing) return;
        Status = PendingOperationStatus.Pending;
        DecidedByUserId = null;
        Touch();
    }

    public void Approve(Guid decidedByUserId, Guid? resultEntityId)
    {
        // Processing: bu çağrı işlemi sahiplenmiş ve operasyonu başarıyla yürütmüştür.
        if (Status is not (PendingOperationStatus.Pending or PendingOperationStatus.Processing))
            throw new BusinessRuleException("Sadece bekleyen işlemler onaylanabilir.");
        Status = PendingOperationStatus.Approved;
        DecidedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        ResultEntityId = resultEntityId;
        Touch();
    }

    public void Reject(Guid decidedByUserId, string? reason)
    {
        if (Status != PendingOperationStatus.Pending) throw new BusinessRuleException("Sadece bekleyen işlemler reddedilebilir.");
        Status = PendingOperationStatus.Rejected;
        DecidedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        RejectionReason = string.IsNullOrWhiteSpace(reason) ? "Belirtilmedi" : reason.Trim();
        Touch();
    }

    public void Cancel(Guid decidedByUserId)
    {
        if (Status != PendingOperationStatus.Pending) throw new BusinessRuleException("Sadece bekleyen işlemler iptal edilebilir.");
        Status = PendingOperationStatus.Cancelled;
        DecidedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        Touch();
    }
}

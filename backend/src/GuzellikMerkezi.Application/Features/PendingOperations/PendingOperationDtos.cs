using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.PendingOperations;

public sealed record PendingOperationDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid RequestedByUserId,
    string RequestedByName,
    PendingOperationType OperationType,
    string Title,
    string? Summary,
    string PayloadJson,
    PendingOperationStatus Status,
    DateTime RequestedAtUtc,
    DateTime? DecidedAtUtc,
    Guid? DecidedByUserId,
    string? RejectionReason,
    Guid? ResultEntityId,
    /// <summary>
    /// TAKILDI: işlem sahiplenilmiş ama sonucu doğrulanamadan zaman aşımına uğramış. Yönetici
    /// arayüzünde ayrı rozet + "elle çöz" eylemi gösterilir; aksi hâlde kayıt sessizce
    /// "işleniyor" görünüp sonsuza dek orada kalırdı.
    /// </summary>
    bool IsStuck);

public sealed record CreatePendingOperationRequest(
    PendingOperationType OperationType,
    string Title,
    string? Summary,
    string PayloadJson);

public sealed record RejectPendingOperationRequest(string? Reason);

/// <summary>
/// Takılı kalmış (sonucu doğrulanamamış) bir işlemin İNSAN kararıyla kapatılması.
/// </summary>
/// <param name="Applied">
/// Yetkili kaydı kontrol etti: işlem hedefte GERÇEKTEN oluştu mu? true → işlem "onaylandı"
/// kapatılır, iş TEKRARLANMAZ. false → hiçbir şey uygulanmamış demektir; işlem yeniden
/// onaylanabilir duruma (Pending) döner.
/// </param>
/// <param name="Note">Neyin nasıl doğrulandığı — zorunlu; denetim kaydına yazılır.</param>
public sealed record ResolveStuckOperationRequest(bool Applied, string Note);

public sealed record PendingOperationFilter(
    PendingOperationStatus? Status,
    Guid? RequestedByUserId,
    PendingOperationType? OperationType);

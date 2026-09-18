namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Domain işlemleri için audit log yazar. Çağrı edenler bekleyemez —
/// hata olursa log atılır ama akış kesilmez. ActorUserId, IpAddress, ActorName
/// otomatik olarak <see cref="ICurrentUser"/>'dan çözümlenir.
/// </summary>
public interface IAuditLogger
{
    /// <summary>
    /// Best-effort audit kaydı. Yazma hatası loglanır ve çağırana taşınmaz.
    /// </summary>
    Task LogAsync(
        Guid? tenantId,
        Guid? branchId,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        CancellationToken ct = default);

    /// <summary>
    /// İşlemin audit kaydı olmadan tamamlanmasının kabul edilemediği akışlar için kayıt yazar.
    /// Yazma hatası çağırana taşınır; çağıran aynı transaction'ı geri almalıdır.
    /// </summary>
    Task LogRequiredAsync(
        Guid? tenantId,
        Guid? branchId,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        CancellationToken ct = default);

    Task LogActorAsync(
        Guid? tenantId,
        Guid? branchId,
        Guid? actorUserId,
        string? actorName,
        string? actorRole,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        string? ipAddress = null,
        CancellationToken ct = default);
}

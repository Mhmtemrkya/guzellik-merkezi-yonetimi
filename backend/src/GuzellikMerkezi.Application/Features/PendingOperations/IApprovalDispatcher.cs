using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.PendingOperations;

/// <summary>
/// Onaylanan PendingOperation'ın payload'unu deserialize edip ilgili servisi çağırır.
/// Sonuçta üretilen entity ID'sini döner (audit için).
/// </summary>
public interface IApprovalDispatcher
{
    Task<Result<Guid?>> DispatchAsync(Guid tenantId, PendingOperationType type, string payloadJson, CancellationToken cancellationToken = default);
}

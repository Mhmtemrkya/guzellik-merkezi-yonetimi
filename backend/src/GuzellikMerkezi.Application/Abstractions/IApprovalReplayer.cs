using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Evrensel onay kapısının yakaladığı HTTP isteğini (PendingOperationType.HttpReplay payload'u),
/// kurum yöneticisi onayladığında aynen yeniden çalıştırır (replay). Başarısızsa onay commit edilmez.
/// </summary>
public interface IApprovalReplayer
{
    Task<Result<Guid?>> ReplayAsync(string payloadJson, CancellationToken cancellationToken = default);
}

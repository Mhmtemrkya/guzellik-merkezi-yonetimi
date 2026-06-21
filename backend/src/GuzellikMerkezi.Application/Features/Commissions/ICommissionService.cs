using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Commissions;

public interface ICommissionService
{
    Task<Result<IReadOnlyCollection<StaffCommissionDto>>> ListAsync(Guid tenantId, CommissionFilter filter, CancellationToken cancellationToken = default);
    Task<Result<CommissionSummaryDto>> SummaryAsync(Guid tenantId, CommissionFilter filter, CancellationToken cancellationToken = default);

    /// <summary>Bir personelin (opsiyonel dönem) ödenmemiş primlerini öder + gider (Salary) kaydı oluşturur.</summary>
    Task<Result> PayAsync(Guid tenantId, Guid staffMemberId, DateTime? fromUtc, DateTime? toUtc, CancellationToken cancellationToken = default);
}

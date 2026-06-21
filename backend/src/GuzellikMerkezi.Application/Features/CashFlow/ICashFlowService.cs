using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CashFlow;

public interface ICashFlowService
{
    Task<Result<IReadOnlyCollection<CashFlowEntryDto>>> ListAsync(Guid tenantId, CashFlowFilter filter, CancellationToken cancellationToken = default);
    Task<Result<CashFlowSummaryDto>> SummaryAsync(Guid tenantId, CashFlowFilter filter, CancellationToken cancellationToken = default);
}

using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CashFlow;

public interface ICashFlowService
{
    Task<Result<IReadOnlyCollection<CashFlowEntryDto>>> ListAsync(Guid tenantId, CashFlowFilter filter, CancellationToken cancellationToken = default);
    Task<Result<CashFlowSummaryDto>> SummaryAsync(Guid tenantId, CashFlowFilter filter, CancellationToken cancellationToken = default);
    /// <summary>Kâr raporu: son N ayın gelir/gider/net kırılımı + hizmet kârlılığı (prim düşülmüş).</summary>
    Task<Result<ProfitReportDto>> ProfitReportAsync(Guid tenantId, int months, CancellationToken cancellationToken = default);
}

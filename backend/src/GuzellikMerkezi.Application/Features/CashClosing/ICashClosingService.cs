using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CashClosing;

public interface ICashClosingService
{
    Task<Result<IReadOnlyCollection<CashClosingDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<CashClosingPreviewDto>> GetPreviewAsync(Guid tenantId, DateOnly businessDate, DateTime fromUtc, DateTime toUtc, decimal? openingBalance, CancellationToken cancellationToken = default);
    Task<Result<CashClosingDto>> CreateAsync(Guid tenantId, CreateCashClosingRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}

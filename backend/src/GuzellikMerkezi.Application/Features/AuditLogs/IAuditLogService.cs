using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.AuditLogs;

public interface IAuditLogService
{
    Task<Result<PagedResult<AuditLogDto>>> ListAsync(Guid tenantId, AuditLogFilter filter, PageRequest page, CancellationToken ct = default);
    Task<Result<PagedResult<AuditLogDto>>> ListAllAsync(Guid tenantId, AuditLogFilter filter, CancellationToken ct = default);
    Task<Result<AuditLogDeleteResultDto>> DeleteAllAsync(Guid tenantId, CancellationToken ct = default);
}

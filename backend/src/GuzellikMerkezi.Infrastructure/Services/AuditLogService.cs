using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AuditLogs;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AuditLogService : IAuditLogService
{
    private readonly GuzellikDbContext _db;

    public AuditLogService(GuzellikDbContext db) => _db = db;

    public async Task<Result<PagedResult<AuditLogDto>>> ListAsync(Guid tenantId, AuditLogFilter filter, PageRequest page, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(tenantId, filter).AsNoTracking();

        var total = await query.CountAsync(ct);
        var rows = await query
            .OrderByDescending(x => x.CreatedAtUtc)
            .Skip(page.Skip)
            .Take(page.SafePageSize)
            .ToListAsync(ct);

        var items = rows.Select(ToDto).ToArray();

        return Result<PagedResult<AuditLogDto>>.Success(new PagedResult<AuditLogDto>(items, total, page.SafePage, page.SafePageSize));
    }

    public async Task<Result<PagedResult<AuditLogDto>>> ListAllAsync(Guid tenantId, AuditLogFilter filter, CancellationToken ct = default)
    {
        var rows = await BuildFilteredQuery(tenantId, filter)
            .AsNoTracking()
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(ct);

        var items = rows.Select(ToDto).ToArray();
        return Result<PagedResult<AuditLogDto>>.Success(new PagedResult<AuditLogDto>(items, items.Length, 1, items.Length));
    }

    public async Task<Result<AuditLogDeleteResultDto>> DeleteAllAsync(Guid tenantId, CancellationToken ct = default)
    {
        var deleted = await _db.AuditLogs
            .Where(x => x.TenantId == tenantId)
            .ExecuteDeleteAsync(ct);

        return Result<AuditLogDeleteResultDto>.Success(new AuditLogDeleteResultDto(deleted));
    }

    private IQueryable<AuditLog> BuildFilteredQuery(Guid tenantId, AuditLogFilter filter)
    {
        var query = _db.AuditLogs.Where(x => x.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(filter.Action))
            query = query.Where(x => x.Action == filter.Action);
        if (!string.IsNullOrWhiteSpace(filter.EntityName))
            query = query.Where(x => x.EntityName == filter.EntityName);
        if (filter.ActorUserId.HasValue)
            query = query.Where(x => x.ActorUserId == filter.ActorUserId.Value);
        if (filter.FromUtc.HasValue)
            query = query.Where(x => x.CreatedAtUtc >= filter.FromUtc.Value);
        if (filter.ToUtc.HasValue)
            query = query.Where(x => x.CreatedAtUtc <= filter.ToUtc.Value);

        // Search şifrelenmiş alanlarda çalışmaz; sadece Action/EntityName plain.
        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var s = filter.Search.Trim();
            query = query.Where(x => x.Action.Contains(s) || x.EntityName.Contains(s));
        }

        return query;
    }

    private static AuditLogDto ToDto(AuditLog x) => new(
        x.Id, x.TenantId, x.BranchId, x.ActorUserId, x.ActorName, x.ActorRole,
        x.Action, x.EntityName, x.EntityId, x.Summary, x.DataJson, x.IpAddress, x.CreatedAtUtc);
}

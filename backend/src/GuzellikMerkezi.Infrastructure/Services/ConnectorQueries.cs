using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <inheritdoc cref="IConnectorQueries"/>
public sealed class ConnectorQueries(GuzellikDbContext db) : IConnectorQueries
{
    public const int MaxPageSize = 200;

    public async Task<PagedResult<ConnectorTenantDto>> ListTenantsAsync(int page, int pageSize, CancellationToken ct = default)
    {
        var request = new PageRequest(page, Math.Clamp(pageSize, 1, MaxPageSize));
        var query = db.Tenants.AsNoTracking();
        var total = await query.CountAsync(ct);
        var rows = await Project(query.OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id).Skip(request.Skip).Take(request.SafePageSize))
            .ToListAsync(ct);
        return new PagedResult<ConnectorTenantDto>(rows.Select(ToDto).ToList(), total, request.SafePage, request.SafePageSize);
    }

    public async Task<ConnectorTenantDto?> GetTenantAsync(Guid id, CancellationToken ct = default)
    {
        var row = await Project(db.Tenants.AsNoTracking().Where(x => x.Id == id)).SingleOrDefaultAsync(ct);
        return row is null ? null : ToDto(row);
    }

    private sealed record Row(Guid Id, string? Code, string Name, TenantStatus Status, string? PlanKey, BillingPeriod? Period,
        DateTime? TrialEndsAtUtc, DateTime? SubscriptionEndsAtUtc, int BranchCount, bool IsSelfSignup, DateTime CreatedAtUtc);

    // Yalnız gereken kolonlar okunur: şifreli kişisel alanlar (telefon, vergi no) belleğe de alınmaz.
    private static IQueryable<Row> Project(IQueryable<Domain.Entities.Tenant> query) =>
        query.Select(x => new Row(x.Id, x.Code, x.Name, x.Status,
            x.SubscriptionPlan == null ? null : x.SubscriptionPlan.PlanKey,
            x.SubscriptionPeriod, x.TrialEndsAtUtc, x.SubscriptionEndsAtUtc,
            x.Branches.Count(), x.IsSelfSignup, x.CreatedAtUtc));

    private static ConnectorTenantDto ToDto(Row r) => new(r.Id, r.Code, r.Name, StatusText(r.Status), r.PlanKey,
        r.Period switch { BillingPeriod.Monthly => "monthly", BillingPeriod.Yearly => "yearly", _ => null },
        r.TrialEndsAtUtc, r.SubscriptionEndsAtUtc, r.BranchCount, r.IsSelfSignup, r.CreatedAtUtc);

    public static string StatusText(TenantStatus status) => status switch
    {
        TenantStatus.Trial => "trial",
        TenantStatus.Active => "active",
        TenantStatus.Suspended => "suspended",
        TenantStatus.Cancelled => "cancelled",
        _ => "unknown",
    };
}

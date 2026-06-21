using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Commissions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CommissionService : ICommissionService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public CommissionService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result<IReadOnlyCollection<StaffCommissionDto>>> ListAsync(Guid tenantId, CommissionFilter filter, CancellationToken cancellationToken = default)
    {
        var rows = await QueryAsync(tenantId, filter, cancellationToken);
        var staffMap = await StaffMapAsync(tenantId, cancellationToken);
        var dtos = rows
            .OrderByDescending(c => c.EarnedAtUtc)
            .Select(c => ToDto(c, staffMap))
            .ToArray();
        return Result<IReadOnlyCollection<StaffCommissionDto>>.Success(dtos);
    }

    public async Task<Result<CommissionSummaryDto>> SummaryAsync(Guid tenantId, CommissionFilter filter, CancellationToken cancellationToken = default)
    {
        var rows = await QueryAsync(tenantId, filter, cancellationToken);
        var staffMap = await StaffMapAsync(tenantId, cancellationToken);

        var byStaff = rows
            .GroupBy(c => c.StaffMemberId)
            .Select(g => new StaffCommissionTotalDto(
                g.Key,
                staffMap.TryGetValue(g.Key, out var n) ? n : null,
                g.Sum(x => x.Amount),
                g.Where(x => x.IsPaid).Sum(x => x.Amount),
                g.Where(x => !x.IsPaid).Sum(x => x.Amount),
                g.Count()))
            .OrderByDescending(s => s.EarnedTotal)
            .ToArray();

        var summary = new CommissionSummaryDto(
            rows.Sum(c => c.Amount),
            rows.Where(c => c.IsPaid).Sum(c => c.Amount),
            rows.Where(c => !c.IsPaid).Sum(c => c.Amount),
            rows.Count,
            byStaff);
        return Result<CommissionSummaryDto>.Success(summary);
    }

    public async Task<Result> PayAsync(Guid tenantId, Guid staffMemberId, DateTime? fromUtc, DateTime? toUtc, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == staffMemberId, cancellationToken);
        if (staff is null) return Result.Failure(Error.NotFound("Personel bulunamadı."));

        var query = _db.StaffCommissions.Where(c => c.TenantId == tenantId && c.StaffMemberId == staffMemberId && !c.IsPaid);
        if (fromUtc.HasValue) { var f = Normalize(fromUtc.Value); query = query.Where(c => c.EarnedAtUtc >= f); }
        if (toUtc.HasValue) { var t = Normalize(toUtc.Value); query = query.Where(c => c.EarnedAtUtc < t); }

        var unpaid = await query.Select(c => new { c.Id, c.Amount }).ToListAsync(cancellationToken);
        if (unpaid.Count == 0) return Result.Failure(Error.Validation("Ödenecek prim yok."));
        var total = unpaid.Sum(c => c.Amount);
        var nowUtc = DateTime.UtcNow;

        // Primleri ödenmiş işaretle (bulk).
        await _db.StaffCommissions
            .Where(c => c.TenantId == tenantId && c.StaffMemberId == staffMemberId && !c.IsPaid
                     && (!fromUtc.HasValue || c.EarnedAtUtc >= Normalize(fromUtc.Value))
                     && (!toUtc.HasValue || c.EarnedAtUtc < Normalize(toUtc.Value)))
            .ExecuteUpdateAsync(s => s
                .SetProperty(c => c.IsPaid, true)
                .SetProperty(c => c.PaidAtUtc, (DateTime?)nowUtc)
                .SetProperty(c => c.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);

        // Kasaya gider olarak yansıt (Salary kategorisi).
        var expense = new BusinessExpense(
            tenantId, staff.BranchId, ExpenseCategory.Salary, total, nowUtc,
            ExpensePaymentMethod.Cash, $"Prim ödemesi: {staff.FullName}", staffMemberId,
            periodLabel: $"{nowUtc:yyyy-MM}", reference: "PRIM");
        expense.Approve();
        _db.BusinessExpenses.Add(expense);
        await _db.SaveChangesAsync(cancellationToken);

        await _audit.LogAsync(tenantId, staff.BranchId, "PayCommission", "StaffCommission", staffMemberId,
            $"Prim ödendi: {staff.FullName} · {total:N2}", new { staffMemberId, total, unpaid.Count }, cancellationToken);
        return Result.Success();
    }

    private async Task<List<StaffCommission>> QueryAsync(Guid tenantId, CommissionFilter filter, CancellationToken cancellationToken)
    {
        var query = _db.StaffCommissions.AsNoTracking().Where(c => c.TenantId == tenantId);
        if (filter.FromUtc.HasValue) { var f = Normalize(filter.FromUtc.Value); query = query.Where(c => c.EarnedAtUtc >= f); }
        if (filter.ToUtc.HasValue) { var t = Normalize(filter.ToUtc.Value); query = query.Where(c => c.EarnedAtUtc < t); }
        if (filter.StaffMemberId.HasValue) query = query.Where(c => c.StaffMemberId == filter.StaffMemberId.Value);
        if (filter.UnpaidOnly == true) query = query.Where(c => !c.IsPaid);
        return await query.ToListAsync(cancellationToken);
    }

    private async Task<Dictionary<Guid, string>> StaffMapAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var rows = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(s => s.Id, s => s.FullName);
    }

    private static DateTime Normalize(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static StaffCommissionDto ToDto(StaffCommission c, IReadOnlyDictionary<Guid, string> staffMap) => new(
        c.Id, c.TenantId, c.BranchId, c.StaffMemberId,
        staffMap.TryGetValue(c.StaffMemberId, out var n) ? n : null,
        c.SourceAdisyonId, c.SourceType, c.Description, c.BaseAmount, c.RatePercent, c.Amount,
        c.EarnedAtUtc, c.IsPaid, c.PaidAtUtc);
}

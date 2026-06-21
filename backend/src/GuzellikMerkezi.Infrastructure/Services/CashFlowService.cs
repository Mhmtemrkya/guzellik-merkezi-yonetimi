using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CashFlowService : ICashFlowService
{
    private readonly GuzellikDbContext _db;

    public CashFlowService(GuzellikDbContext db) => _db = db;

    public async Task<Result<IReadOnlyCollection<CashFlowEntryDto>>> ListAsync(Guid tenantId, CashFlowFilter filter, CancellationToken cancellationToken = default)
    {
        var (from, to) = NormalizeRange(filter);

        // ---------- GELİR: AccountPayment'lar ----------
        // Önce tüm tenant payments'ı sade kolonlarla çek (provider join bug'ından kaçınmak için)
        var paymentRows = await _db.AccountPayments
            .AsNoTracking()
            .Where(p => p.OccurredAtUtc >= from && p.OccurredAtUtc < to)
            .Select(p => new
            {
                p.Id,
                p.CustomerAccountId,
                p.Amount,
                p.Method,
                p.Reference,
                p.OccurredAtUtc,
            })
            .ToListAsync(cancellationToken);

        // Hangi account'lar tenant'a ait + isim & müşteri bilgisini al
        var accountIds = paymentRows.Select(p => p.CustomerAccountId).Distinct().ToList();
        var accountsMeta = new Dictionary<Guid, (string AccountName, string? CustomerName, Guid? CustomerId)>();
        if (accountIds.Count > 0)
        {
            var all = await _db.CustomerAccounts
                .AsNoTracking()
                .Where(a => a.TenantId == tenantId)
                .Select(a => new { a.Id, a.Name, CustomerName = a.Customer != null ? a.Customer.FullName : null, a.CustomerId })
                .ToListAsync(cancellationToken);
            accountsMeta = all
                .Where(a => accountIds.Contains(a.Id))
                .ToDictionary(a => a.Id, a => (a.Name, a.CustomerName, (Guid?)a.CustomerId));
        }

        var incomeEntries = paymentRows
            .Where(p => accountsMeta.ContainsKey(p.CustomerAccountId))
            .Select(p =>
            {
                var meta = accountsMeta[p.CustomerAccountId];
                return new CashFlowEntryDto(
                    p.Id,
                    CashFlowEntryType.Income,
                    p.OccurredAtUtc,
                    p.Amount,
                    p.Method,
                    "Tahsilat",
                    meta.AccountName,
                    p.Reference,
                    meta.CustomerName,
                    null,
                    meta.AccountName,
                    true);
            })
            .ToList();

        // ---------- GİDER: BusinessExpense'ler ----------
        var expenseRows = await _db.BusinessExpenses
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.OccurredAtUtc >= from && e.OccurredAtUtc < to)
            .Select(e => new
            {
                e.Id,
                e.Category,
                e.Amount,
                e.PaymentMethod,
                e.OccurredAtUtc,
                e.Description,
                e.Reference,
                e.StaffMemberId,
                e.IsApproved,
            })
            .ToListAsync(cancellationToken);

        var staffIds = expenseRows.Where(r => r.StaffMemberId.HasValue).Select(r => r.StaffMemberId!.Value).Distinct().ToList();
        var staffMap = new Dictionary<Guid, string>();
        if (staffIds.Count > 0)
        {
            var staffList = await _db.StaffMembers
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .Select(s => new { s.Id, s.FullName })
                .ToListAsync(cancellationToken);
            staffMap = staffList
                .Where(s => staffIds.Contains(s.Id))
                .ToDictionary(s => s.Id, s => s.FullName);
        }

        var expenseEntries = expenseRows.Select(e => new CashFlowEntryDto(
            e.Id,
            CashFlowEntryType.Expense,
            e.OccurredAtUtc,
            e.Amount,
            e.PaymentMethod.ToString(),
            e.Category.ToString(),
            e.Description,
            e.Reference,
            null,
            e.StaffMemberId.HasValue && staffMap.TryGetValue(e.StaffMemberId.Value, out var sn) ? sn : null,
            null,
            e.IsApproved)).ToList();

        // Birleştir + tarih sırasına göre desc
        var all2 = incomeEntries.Concat(expenseEntries)
            .OrderByDescending(x => x.OccurredAtUtc)
            .ToArray();

        return Result<IReadOnlyCollection<CashFlowEntryDto>>.Success(all2);
    }

    public async Task<Result<CashFlowSummaryDto>> SummaryAsync(Guid tenantId, CashFlowFilter filter, CancellationToken cancellationToken = default)
    {
        var listResult = await ListAsync(tenantId, filter, cancellationToken);
        if (listResult.IsFailure || listResult.Value is null)
            return Result<CashFlowSummaryDto>.Failure(listResult.Error);

        var entries = listResult.Value;
        var income = entries.Where(e => e.Type == CashFlowEntryType.Income).Sum(e => e.Amount);
        var expense = entries.Where(e => e.Type == CashFlowEntryType.Expense).Sum(e => e.Amount);

        var byMethod = entries
            .GroupBy(e => NormalizeMethod(e.Method))
            .Select(g => new CashFlowMethodTotalDto(
                g.Key,
                g.Where(e => e.Type == CashFlowEntryType.Income).Sum(e => e.Amount),
                g.Where(e => e.Type == CashFlowEntryType.Expense).Sum(e => e.Amount),
                g.Count()))
            .OrderByDescending(m => m.IncomeAmount)
            .ToArray();

        return Result<CashFlowSummaryDto>.Success(new CashFlowSummaryDto(
            income,
            expense,
            income - expense,
            entries.Count(e => e.Type == CashFlowEntryType.Income),
            entries.Count(e => e.Type == CashFlowEntryType.Expense),
            byMethod));
    }

    private static string NormalizeMethod(string? method)
    {
        if (string.IsNullOrWhiteSpace(method)) return "unknown";
        var m = method.ToLowerInvariant();
        if (m.Contains("cash") || m.Contains("nakit")) return "cash";
        if (m.Contains("card") || m.Contains("kart")) return "card";
        if (m.Contains("transfer") || m.Contains("eft") || m.Contains("havale") || m.Contains("bank")) return "transfer";
        if (m.Contains("check") || m.Contains("çek")) return "check";
        return m;
    }

    private static (DateTime From, DateTime To) NormalizeRange(CashFlowFilter filter)
    {
        var now = DateTime.UtcNow;
        var from = filter.FromUtc ?? new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var to = filter.ToUtc ?? from.AddMonths(1);
        if (from.Kind != DateTimeKind.Utc) from = DateTime.SpecifyKind(from, DateTimeKind.Utc);
        if (to.Kind != DateTimeKind.Utc) to = DateTime.SpecifyKind(to, DateTimeKind.Utc);
        return (from, to);
    }
}

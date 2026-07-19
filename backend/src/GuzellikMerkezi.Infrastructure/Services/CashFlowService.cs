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

    public async Task<Result<ProfitReportDto>> ProfitReportAsync(Guid tenantId, int months, CancellationToken cancellationToken = default)
    {
        if (months is < 1 or > 24) months = 6;
        var offset = TimeSpan.FromHours(3); // TR yerel ay kırılımı
        var nowLocal = DateTime.UtcNow + offset;
        var firstMonthLocal = new DateTime(nowLocal.Year, nowLocal.Month, 1).AddMonths(-(months - 1));
        var fromUtc = firstMonthLocal - offset;

        static string MonthKey(DateTime utc, TimeSpan off)
        {
            var local = utc + off;
            return $"{local.Year:0000}-{local.Month:00}";
        }

        // GELİR — tahsilatlar (AccountPayments, tenant hesapları üzerinden).
        var paymentRows = await _db.AccountPayments.AsNoTracking()
            .Where(p => p.OccurredAtUtc >= fromUtc)
            .Select(p => new { p.CustomerAccountId, p.Amount, p.OccurredAtUtc })
            .ToListAsync(cancellationToken);
        var tenantAccountIds = (await _db.CustomerAccounts.AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .Select(a => a.Id)
            .ToListAsync(cancellationToken)).ToHashSet();
        var incomeByMonth = paymentRows
            .Where(p => tenantAccountIds.Contains(p.CustomerAccountId))
            .GroupBy(p => MonthKey(p.OccurredAtUtc, offset))
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));

        // GİDER — işletme giderleri (maaş/kira/prim ödemeleri dahil).
        var expenseRows = await _db.BusinessExpenses.AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.OccurredAtUtc >= fromUtc)
            .Select(e => new { e.Amount, e.OccurredAtUtc })
            .ToListAsync(cancellationToken);
        var expenseByMonth = expenseRows
            .GroupBy(e => MonthKey(e.OccurredAtUtc, offset))
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));

        var monthRows = new List<ProfitMonthDto>(months);
        for (var i = 0; i < months; i++)
        {
            var m = firstMonthLocal.AddMonths(i);
            var key = $"{m.Year:0000}-{m.Month:00}";
            var income = incomeByMonth.TryGetValue(key, out var inc) ? inc : 0m;
            var expense = expenseByMonth.TryGetValue(key, out var exp) ? exp : 0m;
            monthRows.Add(new ProfitMonthDto(key, income, expense, income - expense));
        }

        // HİZMET KÂRLILIĞI — dönemdeki tamamlanan randevular; prim maliyeti personel oranından tahmin edilir.
        var appts = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.StartUtc >= fromUtc && a.Status == Domain.Enums.AppointmentStatus.Completed)
            .Select(a => new
            {
                a.Price,
                ServiceName = a.ServiceDefinition != null ? a.ServiceDefinition.Name : "Hizmet",
                CommissionRate = a.StaffMember != null ? a.StaffMember.CommissionRate : null,
            })
            .ToListAsync(cancellationToken);
        var services = appts
            .GroupBy(a => a.ServiceName)
            .Select(g =>
            {
                var revenue = g.Sum(x => x.Price);
                var commission = g.Sum(x => x.Price * ((x.CommissionRate ?? 0m) / 100m));
                return new ServiceProfitDto(g.Key, g.Count(), revenue, Math.Round(commission, 2), revenue - Math.Round(commission, 2));
            })
            .OrderByDescending(s => s.Revenue)
            .Take(20)
            .ToArray();

        var totalIncome = monthRows.Sum(m => m.Income);
        var totalExpense = monthRows.Sum(m => m.Expense);
        return Result<ProfitReportDto>.Success(new ProfitReportDto(
            monthRows, totalIncome, totalExpense, totalIncome - totalExpense, services));
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

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.CashClosing;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CashClosingService : ICashClosingService
{
    private readonly GuzellikDbContext _db;
    private readonly ICashFlowService _cashFlow;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;
    private readonly IAppNotificationService _notifications;

    public CashClosingService(GuzellikDbContext db, ICashFlowService cashFlow, IAuditLogger audit, IFeatureService features, IAppNotificationService notifications)
    {
        _db = db;
        _cashFlow = cashFlow;
        _audit = audit;
        _features = features;
        _notifications = notifications;
    }

    private const string FeatureDeniedMessage = "Gün sonu kasa kapanışı özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz.";

    public async Task<Result<IReadOnlyCollection<CashClosingDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.FinanceCashClosing, cancellationToken))
            return Result<IReadOnlyCollection<CashClosingDto>>.Failure(Error.Conflict(FeatureDeniedMessage));
        var rows = await _db.CashRegisterClosings.AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .ToListAsync(cancellationToken);
        var dtos = rows
            .OrderByDescending(c => c.BusinessDate)
            .ThenByDescending(c => c.CreatedAtUtc)
            .Select(ToDto)
            .ToArray();
        return Result<IReadOnlyCollection<CashClosingDto>>.Success(dtos);
    }

    public async Task<Result<CashClosingPreviewDto>> GetPreviewAsync(Guid tenantId, DateOnly businessDate, DateTime fromUtc, DateTime toUtc, decimal? openingBalance, CancellationToken cancellationToken = default)
    {
        var (cashIncome, cashExpense) = await CashTotalsAsync(tenantId, fromUtc, toUtc, cancellationToken);
        var closings = await _db.CashRegisterClosings.AsNoTracking().Where(c => c.TenantId == tenantId).ToListAsync(cancellationToken);

        var suggestedOpening = openingBalance
            ?? closings.Where(c => c.BusinessDate < businessDate).OrderByDescending(c => c.BusinessDate).FirstOrDefault()?.CountedCash
            ?? 0m;
        var alreadyClosed = closings.Any(c => c.BusinessDate == businessDate);
        var systemCash = suggestedOpening + cashIncome - cashExpense;

        return Result<CashClosingPreviewDto>.Success(new CashClosingPreviewDto(
            businessDate, cashIncome, cashExpense, suggestedOpening, systemCash, alreadyClosed));
    }

    public async Task<Result<CashClosingDto>> CreateAsync(Guid tenantId, CreateCashClosingRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.FinanceCashClosing, cancellationToken))
            return Result<CashClosingDto>.Failure(Error.Conflict(FeatureDeniedMessage));
        var (cashIncome, cashExpense) = await CashTotalsAsync(tenantId, request.FromUtc, request.ToUtc, cancellationToken);

        // Gün başına tek kapanış — varsa güncelle (yeniden say), yoksa oluştur.
        var existing = await _db.CashRegisterClosings
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.BusinessDate == request.BusinessDate, cancellationToken);

        CashRegisterClosing closing;
        if (existing is null)
        {
            closing = new CashRegisterClosing(tenantId, request.BranchId, request.BusinessDate,
                request.OpeningBalance, cashIncome, cashExpense, request.CountedCash, request.Note);
            _db.CashRegisterClosings.Add(closing);
        }
        else
        {
            existing.Set(request.OpeningBalance, cashIncome, cashExpense, request.CountedCash, request.Note);
            closing = existing;
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, closing.BranchId, existing is null ? "Create" : "Update", "CashRegisterClosing", closing.Id,
            $"Gün sonu kasa kapanışı {closing.BusinessDate:yyyy-MM-dd} · fark {closing.Difference:0.##}", null, cancellationToken);

        // İlk kapanışta kurum/şube yöneticisine bildirim (yeniden say güncellemelerinde tekrar etmez → dedupe).
        var severity = closing.Difference == 0 ? AppNotificationSeverity.Success : AppNotificationSeverity.Warning;
        var farkText = closing.Difference == 0 ? "kasa tuttu" : $"fark {closing.Difference:0.##}₺";
        await _notifications.NotifyRolesAsync(
            tenantId, closing.BranchId,
            new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
            AppNotificationType.CashClosing, severity,
            "Gün sonu kasa kapanışı",
            $"{closing.BusinessDate:dd.MM.yyyy} · Sayılan {closing.CountedCash:0.##}₺ · {farkText}",
            data: new { route = "/cash-closing", id = closing.Id.ToString() },
            dedupeKey: $"cashclosing:{closing.Id}",
            ct: cancellationToken);

        return Result<CashClosingDto>.Success(ToDto(closing));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var closing = await _db.CashRegisterClosings.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id, cancellationToken);
        if (closing is null) return Result.Failure(Error.NotFound("Kapanış kaydı bulunamadı."));
        closing.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    // Verilen aralıktaki NAKİT tahsilat ve gideri (cashflow özetinden, method='cash').
    private async Task<(decimal Income, decimal Expense)> CashTotalsAsync(Guid tenantId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var summary = await _cashFlow.SummaryAsync(tenantId, new CashFlowFilter(fromUtc, toUtc), cancellationToken);
        if (summary.IsFailure || summary.Value is null) return (0m, 0m);
        var cash = summary.Value.ByMethod.FirstOrDefault(m => m.Method == "cash");
        return (cash?.IncomeAmount ?? 0m, cash?.ExpenseAmount ?? 0m);
    }

    private static CashClosingDto ToDto(CashRegisterClosing c) => new(
        c.Id, c.BranchId, c.BusinessDate, c.OpeningBalance, c.CashIncome, c.CashExpense,
        c.SystemCash, c.CountedCash, c.Difference, c.Note, c.CreatedAtUtc);
}

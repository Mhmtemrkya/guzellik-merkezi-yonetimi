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

    /// <summary>İsteğin ETKİN şube kapsamı — kapanışın şubesi buradan gelir, gövdeden değil.</summary>
    private readonly ITenantContext? _tenantContext;

    public CashClosingService(GuzellikDbContext db, ICashFlowService cashFlow, IAuditLogger audit, IFeatureService features, IAppNotificationService notifications, ITenantContext? tenantContext = null)
    {
        _db = db;
        _cashFlow = cashFlow;
        _audit = audit;
        _features = features;
        _notifications = notifications;
        _tenantContext = tenantContext;
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
        // ÖNİZLEMEDE DE HATA YUTULMAZ: ekranda 0/0 göstermek kullanıcıyı yanlış sayıma yönlendirir.
        var totals = await CashTotalsAsync(tenantId, fromUtc, toUtc, cancellationToken);
        if (totals.IsFailure) return Result<CashClosingPreviewDto>.Failure(totals.Error);
        var (cashIncome, cashExpense) = totals.Value;
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
        var totals = await CashTotalsAsync(tenantId, request.FromUtc, request.ToUtc, cancellationToken);
        if (totals.IsFailure) return Result<CashClosingDto>.Failure(totals.Error);
        var (cashIncome, cashExpense) = totals.Value;

        // KAPANIŞIN ŞUBESİ HESABIN KAPSAMIYLA AYNI OLMALI.
        //
        // Şube gövdeden geliyordu, tutarlar ise isteğin ETKİN kapsamından (aktif şube süzgeci)
        // hesaplanıyor: kurum genelinde çalışan bir kullanıcı gövdeye Şube A yazarak KURUM
        // toplamını A'nın kapanışına yazdırabiliyordu (A=1.000, B=2.000 iken A'ya 3.000).
        // Kapanış artık hesabın yapıldığı kapsamı taşır: şube süzgeci varsa o şube, yoksa
        // kurum geneli (şubesiz) kayıt.
        var effectiveBranchId = _tenantContext?.BranchId;
        if (effectiveBranchId is not null && request.BranchId is not null && request.BranchId != effectiveBranchId)
        {
            await _audit.LogAsync(tenantId, effectiveBranchId, "BranchScopeOverride", "CashRegisterClosing", null,
                "Kasa kapanışı isteğinde başka şube gönderildi; hesabın yapıldığı şubeye sabitlendi.",
                new { RequestedBranchId = request.BranchId, EffectiveBranchId = effectiveBranchId }, cancellationToken);
        }

        // Gün başına tek kapanış — varsa güncelle (yeniden say), yoksa oluştur.
        var existing = await _db.CashRegisterClosings
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.BusinessDate == request.BusinessDate, cancellationToken);

        CashRegisterClosing closing;
        if (existing is null)
        {
            closing = new CashRegisterClosing(tenantId, effectiveBranchId, request.BusinessDate,
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

    /// <summary>
    /// Verilen aralıktaki NAKİT tahsilat ve gideri (cashflow özetinden, method='cash').
    ///
    /// <para>
    /// HATA YUTULMAZ. Eskiden cashflow başarısız olduğunda sessizce <c>(0, 0)</c> dönülüyordu:
    /// kapanış kaydı KALICI olarak "0 gelir / 0 gider" yazılıyor, gün sonu farkı tamamen yanlış
    /// hesaplanıyordu. Kasa kapanışı muhasebe kaydıdır; hesaplanamıyorsa yazılmamalıdır.
    /// </para>
    /// </summary>
    private async Task<Result<(decimal Income, decimal Expense)>> CashTotalsAsync(Guid tenantId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var summary = await _cashFlow.SummaryAsync(tenantId, new CashFlowFilter(fromUtc, toUtc), cancellationToken);
        if (summary.IsFailure)
            return Result<(decimal, decimal)>.Failure(summary.Error);
        if (summary.Value is null)
            return Result<(decimal, decimal)>.Failure(Error.Conflict("Kasa hareketleri hesaplanamadı; kapanış kaydedilmedi."));

        var cash = summary.Value.ByMethod.FirstOrDefault(m => m.Method == "cash");
        return Result<(decimal, decimal)>.Success((cash?.IncomeAmount ?? 0m, cash?.ExpenseAmount ?? 0m));
    }

    private static CashClosingDto ToDto(CashRegisterClosing c) => new(
        c.Id, c.BranchId, c.BusinessDate, c.OpeningBalance, c.CashIncome, c.CashExpense,
        c.SystemCash, c.CountedCash, c.Difference, c.Note, c.CreatedAtUtc);
}

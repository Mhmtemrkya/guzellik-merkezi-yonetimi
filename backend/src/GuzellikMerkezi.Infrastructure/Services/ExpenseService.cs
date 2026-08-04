using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class ExpenseService : IExpenseService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;

    public ExpenseService(GuzellikDbContext db, IAuditLogger audit, ICurrentUser currentUser)
    {
        _db = db;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<PagedResult<BusinessExpenseDto>>> ListAsync(Guid tenantId, ExpenseFilter filter, PageRequest pageRequest, CancellationToken cancellationToken = default)
    {
        // Önce sadeleştirilmiş Where uygula, materialize et, sonra in-memory'de Include + Sort + Project
        // Bu MySql.EntityFrameworkCore'un Include+Select+OrderBy kombinasyonundaki SQL bug'ından kaçınır.
        var baseQuery = _db.BusinessExpenses
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId);

        if (filter.FromUtc.HasValue)
        {
            var from = filter.FromUtc.Value.Kind == DateTimeKind.Utc ? filter.FromUtc.Value : DateTime.SpecifyKind(filter.FromUtc.Value, DateTimeKind.Utc);
            baseQuery = baseQuery.Where(x => x.OccurredAtUtc >= from);
        }
        if (filter.ToUtc.HasValue)
        {
            var to = filter.ToUtc.Value.Kind == DateTimeKind.Utc ? filter.ToUtc.Value : DateTime.SpecifyKind(filter.ToUtc.Value, DateTimeKind.Utc);
            baseQuery = baseQuery.Where(x => x.OccurredAtUtc < to);
        }
        if (filter.Category.HasValue) baseQuery = baseQuery.Where(x => x.Category == filter.Category.Value);
        if (filter.StaffMemberId.HasValue) baseQuery = baseQuery.Where(x => x.StaffMemberId == filter.StaffMemberId.Value);

        // MÜŞTERİ İADELERİ LİSTEDE DE GÖRÜNÜR. Gider ÖZETİ (bkz. SummaryAsync) iadeleri gider
        // sayıyordu ama liste saymıyordu: kullanıcı aynı dönemde özet 1.000 TL derken satır
        // toplamını 600 TL görüyordu. Kayıtlar sistem üretimidir (IsSystemGenerated) — düzenlenemez.
        // Süzgeç kuralı özetle aynı: iade "Other" kategorisinde ve personelsizdir.
        var refundsApply = filter.StaffMemberId is null
            && (filter.Category is null || filter.Category == ExpenseCategory.Other);
        var refundRows = new List<BusinessExpenseDto>();
        if (refundsApply)
        {
            var refundQuery = _db.RefundTransactions.AsNoTracking().Where(r => r.TenantId == tenantId);
            if (filter.FromUtc.HasValue)
            {
                var from = filter.FromUtc.Value.Kind == DateTimeKind.Utc ? filter.FromUtc.Value : DateTime.SpecifyKind(filter.FromUtc.Value, DateTimeKind.Utc);
                refundQuery = refundQuery.Where(r => r.RefundedAtUtc >= from);
            }
            if (filter.ToUtc.HasValue)
            {
                var to = filter.ToUtc.Value.Kind == DateTimeKind.Utc ? filter.ToUtc.Value : DateTime.SpecifyKind(filter.ToUtc.Value, DateTimeKind.Utc);
                refundQuery = refundQuery.Where(r => r.RefundedAtUtc < to);
            }
            refundRows = (await refundQuery.ToListAsync(cancellationToken))
                .Select(r => new BusinessExpenseDto(
                    r.Id, r.TenantId, r.BranchId, ExpenseCategory.Other, r.Amount,
                    ExpensePaymentMethod.Cash, r.RefundedAtUtc, null, null, null,
                    string.IsNullOrWhiteSpace(r.Reason) ? "Müşteri iadesi (iptal edilen satış)" : $"Müşteri iadesi — {r.Reason}",
                    r.Reference, true, r.RefundedAtUtc, r.CreatedAtUtc, IsSystemGenerated: true))
                .ToList();
        }

        var total = await baseQuery.CountAsync(cancellationToken) + refundRows.Count;

        // Materialize: önce row'ları çek, sonra in-memory'de order + page + project
        var rows = await baseQuery.ToListAsync(cancellationToken);

        // Personel adlarını tek seferde çek (her gider için ayrı Include yerine)
        var staffIds = rows.Where(r => r.StaffMemberId.HasValue).Select(r => r.StaffMemberId!.Value).Distinct().ToHashSet();
        var staffNames = staffIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _db.StaffMembers.AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .Select(s => new { s.Id, s.FullName })
                .ToListAsync(cancellationToken))
                .Where(s => staffIds.Contains(s.Id))
                .ToDictionary(s => s.Id, s => s.FullName);

        var items = rows
            .Select(r => new BusinessExpenseDto(
                r.Id,
                r.TenantId,
                r.BranchId,
                r.Category,
                r.Amount,
                r.PaymentMethod,
                r.OccurredAtUtc,
                r.StaffMemberId,
                r.StaffMemberId.HasValue && staffNames.TryGetValue(r.StaffMemberId.Value, out var name) ? name : null,
                r.PeriodLabel,
                r.Description,
                r.Reference,
                r.IsApproved,
                r.ApprovedAtUtc,
                r.CreatedAtUtc))
            .Concat(refundRows)
            .OrderByDescending(r => r.OccurredAtUtc)
            .Skip(pageRequest.Skip)
            .Take(pageRequest.SafePageSize)
            .ToArray();

        return Result<PagedResult<BusinessExpenseDto>>.Success(new PagedResult<BusinessExpenseDto>(items, total, pageRequest.SafePage, pageRequest.SafePageSize));
    }

    public async Task<Result<BusinessExpenseDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result<BusinessExpenseDto>.Failure(Error.NotFound("Gider bulunamadı."));
        var staffName = expense.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == expense.StaffMemberId.Value).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;
        return Result<BusinessExpenseDto>.Success(expense.ToDtoWithStaff(staffName));
    }

    public async Task<Result<BusinessExpenseDto>> CreateAsync(Guid tenantId, CreateExpenseRequest request, CancellationToken cancellationToken = default)
    {
        if (request.StaffMemberId.HasValue)
        {
            var staffExists = await _db.StaffMembers.AnyAsync(s => s.TenantId == tenantId && s.Id == request.StaffMemberId.Value, cancellationToken);
            if (!staffExists) return Result<BusinessExpenseDto>.Failure(Error.NotFound("Personel bulunamadı."));
        }

        var expense = new BusinessExpense(
            tenantId,
            request.BranchId,
            request.Category,
            request.Amount,
            request.OccurredAtUtc,
            request.PaymentMethod,
            request.Description,
            request.StaffMemberId,
            request.PeriodLabel,
            request.Reference);

        // Gideri/maaşı KAYDEDEN zaten onay makamıysa (kurum ya da şube yöneticisi) kayıt
        // "onay bekliyor" olarak durmaz — kendi kendini onaylaması anlamsız. Personelin girdiği
        // kayıt beklemede kalır; onu yönetici onaylar (personel yazma akışı zaten onay kapısından geçer).
        if (_currentUser.Role is UserRole.InstitutionOwner or UserRole.BranchManager or UserRole.PlatformAdmin)
            expense.Approve();

        _db.BusinessExpenses.Add(expense);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, expense.BranchId, "Create", "Expense", expense.Id,
            $"Gider: {expense.Category} · {expense.Amount:N2}",
            new { expense.Category, expense.Amount, expense.OccurredAtUtc, expense.Description }, cancellationToken);

        var staffName = expense.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == expense.StaffMemberId.Value).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;
        return Result<BusinessExpenseDto>.Success(expense.ToDtoWithStaff(staffName));
    }

    public async Task<Result<BusinessExpenseDto>> UpdateAsync(Guid tenantId, Guid id, UpdateExpenseRequest request, CancellationToken cancellationToken = default)
    {
        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result<BusinessExpenseDto>.Failure(Error.NotFound("Gider bulunamadı."));

        var approvalDropped = expense.Update(
            request.Category,
            request.Amount,
            request.OccurredAtUtc,
            request.PaymentMethod,
            request.Description,
            request.StaffMemberId,
            request.PeriodLabel,
            request.Reference);

        // Onayı DÜŞÜREN değişikliği yapan kişi zaten onay makamıysa (kurum ya da şube yöneticisi)
        // onay tazelenir — CreateAsync'teki "kendi kendini onaylaması anlamsız" kuralının aynısı.
        // Personelin düzenlemesi beklemede kalır; onu yönetici yeniden onaylar.
        var reApproved = false;
        if (approvalDropped && _currentUser.Role is UserRole.InstitutionOwner or UserRole.BranchManager or UserRole.PlatformAdmin)
        {
            expense.Approve();
            reApproved = true;
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, expense.BranchId, "Update", "Expense", expense.Id,
            approvalDropped && !reApproved
                ? $"Gider güncellendi ve ONAYI DÜŞTÜ (yeniden onay bekliyor): {expense.Category} · {expense.Amount:N2}"
                : $"Gider güncellendi: {expense.Category} · {expense.Amount:N2}",
            new { expense.Category, expense.Amount, approvalDropped, reApproved }, cancellationToken);
        var staffName = expense.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == expense.StaffMemberId.Value).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;
        return Result<BusinessExpenseDto>.Success(expense.ToDtoWithStaff(staffName));
    }

    public async Task<Result<BusinessExpenseDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result<BusinessExpenseDto>.Failure(Error.NotFound("Gider bulunamadı."));
        expense.Approve();
        await _db.SaveChangesAsync(cancellationToken);
        var staffName = expense.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == expense.StaffMemberId.Value).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;
        return Result<BusinessExpenseDto>.Success(expense.ToDtoWithStaff(staffName));
    }

    public async Task<Result<BusinessExpenseDto>> RevokeAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result<BusinessExpenseDto>.Failure(Error.NotFound("Gider bulunamadı."));
        expense.Revoke();
        await _db.SaveChangesAsync(cancellationToken);
        var staffName = expense.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == expense.StaffMemberId.Value).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;
        return Result<BusinessExpenseDto>.Success(expense.ToDtoWithStaff(staffName));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result.Failure(Error.NotFound("Gider bulunamadı."));
        var snapshot = new { expense.Category, expense.Amount, expense.OccurredAtUtc };
        expense.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, expense.BranchId, "Delete", "Expense", expense.Id,
            $"Gider silindi: {expense.Category} · {expense.Amount:N2}", snapshot, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<ExpenseSummaryDto>> SummaryAsync(Guid tenantId, ExpenseFilter filter, CancellationToken cancellationToken = default)
    {
        // ONAYSIZ GİDER GERÇEKLEŞMİŞ SAYILMAZ: kasa akışı (CashFlowService), kâr-zarar ve rapor
        // servisleri IsApproved süzüyordu, yalnız bu özet süzmüyordu — aynı dönem için iki farklı
        // gider rakamı çıkıyor, özet onay bekleyen kalemler kadar fazla gösteriyordu.
        var query = _db.BusinessExpenses
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsApproved);

        if (filter.FromUtc.HasValue)
        {
            var from = filter.FromUtc.Value.Kind == DateTimeKind.Utc ? filter.FromUtc.Value : DateTime.SpecifyKind(filter.FromUtc.Value, DateTimeKind.Utc);
            query = query.Where(x => x.OccurredAtUtc >= from);
        }
        if (filter.ToUtc.HasValue)
        {
            var to = filter.ToUtc.Value.Kind == DateTimeKind.Utc ? filter.ToUtc.Value : DateTime.SpecifyKind(filter.ToUtc.Value, DateTimeKind.Utc);
            query = query.Where(x => x.OccurredAtUtc < to);
        }
        // KATEGORİ/PERSONEL SÜZGEÇLERİ DE UYGULANIR: liste bunları uyguluyordu, özet aynı filtre
        // nesnesini alıp yok sayıyordu — süzülmüş listenin üstündeki toplam listeyle uyuşmuyordu.
        if (filter.Category.HasValue) query = query.Where(x => x.Category == filter.Category.Value);
        if (filter.StaffMemberId.HasValue) query = query.Where(x => x.StaffMemberId == filter.StaffMemberId.Value);

        // Önce sadece düz kolonları çek, sonra in-memory grupla (join'siz, projection'sız)
        var expenses = await query
            .Select(x => new { x.Category, x.Amount, x.StaffMemberId })
            .ToListAsync(cancellationToken);

        // Personel adlarını ayrı sorguyla bir kerede çek
        var staffIds = expenses.Where(e => e.StaffMemberId.HasValue).Select(e => e.StaffMemberId!.Value).Distinct().ToHashSet();
        var staffNames = staffIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _db.StaffMembers.AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .Select(s => new { s.Id, s.FullName })
                .ToListAsync(cancellationToken))
                .Where(s => staffIds.Contains(s.Id))
                .ToDictionary(s => s.Id, s => s.FullName);

        // MÜŞTERİ İADELERİ de giderdir: genel rapor, kasa akışı ve kasa kapanışı onları gider
        // sayıyor; özet saymazsa aynı dönem için iki farklı gider rakamı çıkıyordu.
        // Kategori olarak "Other" kullanılır (mevcut kırılım/etiket seti bozulmasın).
        var refundQuery = _db.RefundTransactions.AsNoTracking().Where(r => r.TenantId == tenantId);
        if (filter.FromUtc.HasValue)
        {
            var from = filter.FromUtc.Value.Kind == DateTimeKind.Utc ? filter.FromUtc.Value : DateTime.SpecifyKind(filter.FromUtc.Value, DateTimeKind.Utc);
            refundQuery = refundQuery.Where(r => r.RefundedAtUtc >= from);
        }
        if (filter.ToUtc.HasValue)
        {
            var to = filter.ToUtc.Value.Kind == DateTimeKind.Utc ? filter.ToUtc.Value : DateTime.SpecifyKind(filter.ToUtc.Value, DateTimeKind.Utc);
            refundQuery = refundQuery.Where(r => r.RefundedAtUtc < to);
        }
        // İadeler "Other" kategorisinde ve personelsizdir: kullanıcı başka bir kategori ya da
        // personel süzgeci uyguladıysa özetin içine girmemeli (aksi hâlde süzülmüş toplam
        // süzgeçle ilgisiz bir kalem taşırdı).
        var refundsApply = filter.StaffMemberId is null
            && (filter.Category is null || filter.Category == ExpenseCategory.Other);
        var refunds = refundsApply
            ? await refundQuery.Select(r => r.Amount).ToListAsync(cancellationToken)
            : new List<decimal>();
        if (refunds.Count > 0)
        {
            expenses = expenses
                .Concat(refunds.Select(a => new { Category = ExpenseCategory.Other, Amount = a, StaffMemberId = (Guid?)null }))
                .ToList();
        }

        var byCategory = expenses
            .GroupBy(x => x.Category)
            .Select(g => new ExpenseCategoryTotalDto(g.Key, g.Sum(x => x.Amount), g.Count()))
            .OrderByDescending(x => x.TotalAmount)
            .ToArray();

        var byStaff = expenses
            .Where(x => x.StaffMemberId.HasValue)
            .GroupBy(x => x.StaffMemberId!.Value)
            .Select(g => new ExpenseStaffTotalDto(
                g.Key,
                staffNames.TryGetValue(g.Key, out var n) ? n : "Personel",
                g.Sum(x => x.Amount),
                g.Count()))
            .OrderByDescending(x => x.TotalAmount)
            .ToArray();

        return Result<ExpenseSummaryDto>.Success(new ExpenseSummaryDto(
            expenses.Sum(x => x.Amount),
            expenses.Count,
            byCategory,
            byStaff,
            // İadeler toplamın İÇİNDEDİR; ayrıca verilir ki gider listesiyle özet arasındaki
            // fark ekranda açıklanabilsin (iadeler business_expenses tablosunda yok).
            refunds.Sum(),
            refunds.Count));
    }
}

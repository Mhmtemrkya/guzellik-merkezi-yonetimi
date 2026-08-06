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

        // PRİM ÖDEMESİ ATOMİK VE EŞZAMANLILIĞA DAYANIKLI OLMALI.
        //
        // Eski akış iki ayrı yazma yapıyordu: önce toplu `ExecuteUpdate` ile primler "ödendi"
        // işaretleniyor (kendi başına COMMIT eder), sonra gider ekleniyordu. İki hata sınıfı vardı:
        //   (1) gider insert'i patlarsa primler ÖDENDİ kalıyor ama kasada karşılığı olmuyordu
        //       (personel bir daha ödenemez, para da çıkmamış görünür);
        //   (2) iki eşzamanlı çağrı aynı ödenmemiş kümeyi okuyup İKİ maaş gideri oluşturabiliyordu
        //       (ikinci update 0 satır etkilese de dönen sayı hiç kontrol edilmiyordu).
        // Çözüm: personel satırının kilidi (aynı personelin ödemeleri serileşir) + kilit ALTINDA
        // taze okuma + tek transaction + tek SaveChanges.
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        if (relational) await RowLock.LockRowAsync(_db, "staff_members", staffMemberId, cancellationToken);

        var query = _db.StaffCommissions.Where(c => c.TenantId == tenantId && c.StaffMemberId == staffMemberId && !c.IsPaid);
        if (fromUtc.HasValue) { var f = Normalize(fromUtc.Value); query = query.Where(c => c.EarnedAtUtc >= f); }
        if (toUtc.HasValue) { var t = Normalize(toUtc.Value); query = query.Where(c => c.EarnedAtUtc < t); }

        // Kilit altında TAZE okuma: ikinci eşzamanlı çağrı burada boş küme görür ve durur.
        var unpaid = await query.ToListAsync(cancellationToken);
        if (unpaid.Count == 0) return Result.Failure(Error.Validation("Ödenecek prim yok."));

        var total = unpaid.Sum(c => c.Amount);
        var nowUtc = DateTime.UtcNow;

        // Kasaya gider olarak yansıt (Salary kategorisi) — AYNI transaction, AYNI SaveChanges.
        var expense = new BusinessExpense(
            tenantId, staff.BranchId, ExpenseCategory.Salary, total, nowUtc,
            ExpensePaymentMethod.Cash, $"Prim ödemesi: {staff.FullName}", staffMemberId,
            periodLabel: $"{nowUtc:yyyy-MM}", reference: "PRIM");
        expense.Approve();
        _db.BusinessExpenses.Add(expense);

        // PARTİ BAĞI: her prim, kendisini ödeyen kasa çıkışını taşır.
        //
        // Eskiden bağ yoktu; gider satırı ile primler arasında yalnız tutar/tarih benzerliği vardı.
        // "Bu 4.500 TL hangi primleri kapatıyor?" sorusunun kesin cevabı yoktu ve ödeme iptal
        // edilirse hangi primlerin yeniden açılacağı bilinemiyordu. Bağ ÖNCE gider oluşturulup
        // sonra yazılır; ikisi aynı SaveChanges'te kalıcı olur.
        foreach (var commission in unpaid) commission.MarkPaid(nowUtc, expense.Id);

        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);

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

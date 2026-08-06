using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
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
                    // YÖNTEM İADENİN KENDİSİNDEN GELİR. Sabit "Nakit" yazılıyordu: kart/havale ile
                    // yapılan iade gider listesinde nakit çıkış görünüyor, kasa kırılımı ve nakit
                    // sayımı o kadar yanlış kapanıyordu. Kaynak alan RefundTransaction.Method'tur
                    // (tahsilatlarla aynı sözlük: cash/card/transfer).
                    MapRefundMethod(r.Method), r.RefundedAtUtc, null, null, null,
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
                r.CreatedAtUtc,
                // Geçersiz kılınan gider LİSTEDE VE TOPLAMDA KALIR — gerçekleşmiş kasa çıkışıdır.
                // Etkisini, iptalin yapıldığı güne yazılan NEGATİF tutarlı ters kayıt siler
                // (bkz. BusinessExpense.CreateReversal). Arayüz bu alanlarla "geçersiz" rozetini
                // ve gerekçesini gösterir; ters kayıt da ayrı bir satır olarak görünür.
                IsSystemGenerated: false,
                VoidedAtUtc: r.VoidedAtUtc,
                VoidReason: r.VoidReason))
            .Concat(refundRows)
            .OrderByDescending(r => r.OccurredAtUtc)
            .Skip(pageRequest.Skip)
            .Take(pageRequest.SafePageSize)
            .ToArray();

        return Result<PagedResult<BusinessExpenseDto>>.Success(new PagedResult<BusinessExpenseDto>(items, total, pageRequest.SafePage, pageRequest.SafePageSize));
    }

    /// <summary>
    /// İade yöntemini (cash/card/transfer — <see cref="RefundTransaction.Method"/>) gider
    /// listesinin enum'una çevirir. Bilinmeyen/boş değer nakit sayılır: <c>NormalizeMethod</c>
    /// zaten bu üçüne indirger, buradaki varsayılan yalnız eski/bozuk satırlar içindir.
    /// </summary>
    private static ExpensePaymentMethod MapRefundMethod(string? method) =>
        (method ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "card" => ExpensePaymentMethod.Card,
            "transfer" => ExpensePaymentMethod.BankTransfer,
            _ => ExpensePaymentMethod.Cash,
        };

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

        // DEFTER DENGESİ SONRADAN BOZULAMAZ.
        //
        // İptal, asıl satır + ters kayıt ÇİFTİ olarak durur ve toplamları sıfırlar. İkisinden biri
        // sonradan düzenlenebilseydi (tutar/tarih değişimi) çift artık birbirini götürmez, defter
        // kalıcı olarak şişer ya da eksilir — üstelik hiçbir yerde hata görünmeden.
        if (expense.IsReversal)
        {
            return Result<BusinessExpenseDto>.Failure(Error.Conflict(
                "İptal düzeltmesi (ters kayıt) düzenlenemez: asıl gideri sıfırlayan muhasebe kaydıdır."));
        }
        if (expense.VoidedAtUtc is not null)
        {
            return Result<BusinessExpenseDto>.Failure(Error.Conflict(
                "Geçersiz kılınmış gider düzenlenemez. Kayıt, ters kaydıyla birlikte olduğu gibi kalır; " +
                "yeni bir gider girmeniz gerekiyorsa ayrı kayıt açın."));
        }

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

    /// <inheritdoc />
    public async Task<Result<BusinessExpenseDto>> VoidAsync(Guid tenantId, Guid id, VoidExpenseRequest request, CancellationToken cancellationToken = default)
    {
        // GERÇEKLEŞMİŞ BİR KASA ÇIKIŞINI GEÇERSİZ KILMAK AYRI BİR YETKİDİR (iade geçersiz kılmayla
        // aynı sınıf): normal gider yetkisi olan personel geçmiş bir hareketi toplamlardan
        // düşürememeli. Kurum sahibi ve platform yöneticisi dışındaki her rol açık izin ister.
        var mayVoid = _currentUser.IsPlatformAdmin
            || _currentUser.Role == UserRole.InstitutionOwner
            || _currentUser.IsAllowed(Permissions.AccountingVoidExpense);
        if (!mayVoid)
        {
            return Result<BusinessExpenseDto>.Failure(Error.Unauthorized(
                "Onaylanmış gideri geçersiz kılma yetkiniz yok. Yöneticinize başvurun."));
        }

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            return Result<BusinessExpenseDto>.Failure(Error.Validation(
                "Gideri geçersiz kılmak için gerekçe zorunludur (ör. 'yanlış girildi, para çıkmadı')."));
        }

        // EŞZAMANLI İKİ İPTAL TEK TERS KAYIT ÜRETİR.
        //
        // Kontrol ile yazma arasında kilit yoktu: aynı gider için iki istek birlikte "iptal
        // edilmemiş" görüp İKİ ters kayıt yazabiliyordu ve defter, giderin tutarı kadar EKSİYE
        // kayıyordu. Satır kilitlenir, karar kilit altında TAZE okumayla verilir.
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational) await RowLock.LockRowAsync(_db, "business_expenses", id, cancellationToken);

        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result<BusinessExpenseDto>.Failure(Error.NotFound("Gider bulunamadı."));
        if (relational) await _db.Entry(expense).ReloadAsync(cancellationToken);

        if (expense.IsReversal)
        {
            return Result<BusinessExpenseDto>.Failure(Error.Conflict(
                "İptal düzeltmesi (ters kayıt) geçersiz kılınamaz: zaten bir iptalin karşı kaydıdır."));
        }
        if (!expense.IsApproved)
        {
            return Result<BusinessExpenseDto>.Failure(Error.Validation(
                "Onaylanmamış gider zaten muhasebe toplamlarına girmiyor; geçersiz kılmak yerine silebilirsiniz."));
        }
        if (expense.VoidedAtUtc is not null)
            return Result<BusinessExpenseDto>.Failure(Error.Conflict("Bu gider zaten geçersiz kılınmış."));

        try
        {
            expense.Void(request.Reason, _currentUser.UserId);
        }
        catch (DomainException ex)
        {
            return Result<BusinessExpenseDto>.Failure(Error.Validation(ex.Message));
        }

        // KARŞI KAYIT — geçmiş dönem yeniden yazılmaz.
        //
        // Asıl satır tutarıyla birlikte yerinde kalır (gerçekleşmiş kasa çıkışıdır); etkisini
        // iptal eden NEGATİF tutarlı ters kayıt, iptalin YAPILDIĞI güne yazılır. Böylece kapanmış
        // bir ayın kârı bugün değişmez ve o güne ait kasa kapanışı defterle tutmaya devam eder.
        // İkisi AYNI SaveChanges'te yazılır: biri olup diğeri olmazsa defter kalıcı olarak şişerdi.
        var reversal = BusinessExpense.CreateReversal(expense, expense.VoidedAtUtc!.Value, expense.VoidReason!);
        _db.BusinessExpenses.Add(reversal);

        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);

        await _audit.LogAsync(tenantId, expense.BranchId, "Void", "Expense", expense.Id,
            $"Gider geçersiz kılındı: {expense.Category} · {expense.Amount:N2} · {expense.VoidReason} " +
            $"· ters kayıt {reversal.Id}",
            new { expense.Category, expense.Amount, expense.OccurredAtUtc, expense.VoidReason, ReversalId = reversal.Id },
            cancellationToken);

        var staffName = expense.StaffMemberId.HasValue
            ? await _db.StaffMembers.AsNoTracking().Where(s => s.Id == expense.StaffMemberId).Select(s => s.FullName).FirstOrDefaultAsync(cancellationToken)
            : null;
        return Result<BusinessExpenseDto>.Success(expense.ToDtoWithStaff(staffName));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var expense = await _db.BusinessExpenses.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (expense is null) return Result.Failure(Error.NotFound("Gider bulunamadı."));

        // ONAYLANMIŞ GİDER SİLİNEMEZ — para fiilen çıkmıştır (geçersiz kılma için VoidAsync).
        //
        // Soft-delete kaydı global süzgeçle gizliyor; kasa akışı, kâr-zarar ve geçmiş dönem
        // raporları o parayı bir daha GÖRMÜYORDU: onaylı 1.000 TL kira silinince net −1.000'den
        // 0'a dönüyor, oysa para geri gelmedi. Geçmiş bir kasa hareketini yok etmek muhasebede
        // düzeltme değil, kayıt kaybıdır. Yanlış girilen onaylı gider için ters kayıt (düzeltme
        // hareketi) girilmeli; onay bekleyen kayıt ise hiçbir deftere girmediği için silinebilir.
        if (expense.IsApproved)
        {
            return Result.Failure(Error.Conflict(
                "Onaylanmış gider silinemez: para fiilen çıkmıştır ve geçmiş raporlardan kaldırılamaz. " +
                "Yanlış girildiyse gideri gerekçesiyle GEÇERSİZ KILIN."));
        }

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
        // GEÇERSİZ KILINAN GİDER TOPLAMA GİRMEZ (kasa akışı ve raporlarla aynı kural).
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

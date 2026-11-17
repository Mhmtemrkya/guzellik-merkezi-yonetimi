using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class BranchService : IBranchService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IBillingService _billing;
    private readonly ICurrentUser _currentUser;

    public BranchService(GuzellikDbContext db, IUsageService usage, IBillingService billing, ICurrentUser currentUser)
    {
        _db = db;
        _usage = usage;
        _billing = billing;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyCollection<BranchDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var branches = await _db.Branches.AsNoTracking().Where(x => x.TenantId == tenantId).OrderByDescending(x => x.IsDefault).ThenBy(x => x.Name).ToArrayAsync(cancellationToken);
        var counts = await StaffCountsAsync(tenantId, cancellationToken);
        var items = branches.Select(x => x.ToDto(counts.GetValueOrDefault(x.Id))).ToArray();
        return Result<IReadOnlyCollection<BranchDto>>.Success(items);
    }

    public async Task<Result<BranchDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var branch = await _db.Branches.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (branch is null) return Result<BranchDto>.Failure(Error.NotFound("Şube bulunamadı."));
        var counts = await StaffCountsAsync(tenantId, cancellationToken);
        return Result<BranchDto>.Success(branch.ToDto(counts.GetValueOrDefault(id)));
    }

    /// <summary>
    /// Şube başına aktif personel sayısı. Personel tablosunda şube global query filter'ı var; şube
    /// listesi zaten kurumun TÜM şubelerini döndürdüğü için sayım da filtre atlanarak kurum genelinde
    /// yapılır — aksi halde seçili şube dışındaki her şube 0 görünür (bkz. ReportsService.StaffQuery).
    /// IgnoreQueryFilters soft-delete filtresini de kapattığından !IsDeleted elle eklenir.
    /// </summary>
    private async Task<Dictionary<Guid, int>> StaffCountsAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var rows = await _db.StaffMembers.AsNoTracking().IgnoreQueryFilters()
            .Where(s => !s.IsDeleted && s.TenantId == tenantId && s.IsActive)
            .GroupBy(s => s.BranchId)
            .Select(g => new { BranchId = g.Key, Count = g.Count() })
            .ToArrayAsync(cancellationToken);
        return rows.ToDictionary(x => x.BranchId, x => x.Count);
    }

    public async Task<Result<BranchDto>> CreateAsync(Guid tenantId, UpsertBranchRequest request, CancellationToken cancellationToken = default)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, UsageMetricKeys.Branches, cancellationToken);
        if (limit.IsFailure) return Result<BranchDto>.Failure(limit.Error);

        // ŞUBE BAŞINA ÜCRETLİ PAKET: dönem ortasında açılan şubenin orantılı ücreti HEMEN işlenir ve şube
        // ÖDEMEDEN AÇILMAZ — kayıtlı kart + açık ödeme altyapısı varsa karttan çekilir (şube ödeme
        // kesinleşince açılır), yoksa açık fatura kesilir ve şube platform faturayı "Ödendi" yapınca açılır.
        // Ücret ASLA sessizce işlenmez — istek kullanıcının onayladığı tutarı taşımalı; taşımayan (eski
        // mobil sürüm, onaysız istemci) 409 alır. PLATFORM YÖNETİCİSİ kurumu ücretlendirmez: destek
        // amaçlı açtığı şube ücretsizdir ve bir sonraki yenilemede şube sayısına yansır.
        if (!_currentUser.IsPlatformAdmin)
        {
            var charge = await _billing.GetBranchChargeQuoteAsync(tenantId, cancellationToken);
            if (charge.IsFailure) return Result<BranchDto>.Failure(charge.Error);
            if (charge.Value!.ChargeRequired)
            {
                if (request.ConfirmedChargeTRY is not { } confirmed)
                {
                    return Result<BranchDto>.Failure(Error.BranchChargeRequired(
                        BillingService.BranchChargePrompt(charge.Value.ChargeMethod, charge.Value.Quote!.Total, amountChanged: false)));
                }

                var purchase = await _billing.PurchaseBranchAsync(tenantId,
                    new BranchPurchaseRequest(request.Name, request.City, request.IsDefault), confirmed, cancellationToken);
                if (purchase.IsFailure) return Result<BranchDto>.Failure(purchase.Error);
                // Kartsız kurum: şube faturası kesildi, şube ÖDENİNCE açılacak (hata değil — istemci bilgi gösterir).
                if (purchase.Value!.AwaitingInvoicePayment)
                    return Result<BranchDto>.Failure(Error.BranchAwaitingPayment(purchase.Value.Message));
                if (!purchase.Value.Created)
                    return Result<BranchDto>.Failure(Error.BranchChargePending(purchase.Value.Message));
                if (purchase.Value.BranchId is not { } branchId)
                    return Result<BranchDto>.Failure(Error.Conflict(purchase.Value.Message));

                var created = await _db.Branches.AsNoTracking().FirstAsync(x => x.Id == branchId, cancellationToken);
                return Result<BranchDto>.Success(created.ToDto(staffCount: 0));
            }
        }

        var tenant = await _db.Tenants.Include(x => x.Branches).FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<BranchDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var branch = tenant.AddBranch(request.Name, request.City, request.IsDefault);
        // Yeni şube yalnızca navigation collection üzerinden eklendiğinde, PK constructor'da
        // (Guid.CreateVersion7) set edildiği için EF DetectChanges bunu mevcut kayıt sanıp UPDATE
        // üretiyor (0 satır → DbUpdateConcurrencyException). DbSet'e açıkça ekleyip INSERT'e zorluyoruz.
        _db.Branches.Add(branch);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<BranchDto>.Success(branch.ToDto(staffCount: 0));
    }

    public async Task<Result<BranchDto>> UpdateAsync(Guid tenantId, Guid id, UpsertBranchRequest request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Branches).FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        var branch = tenant?.Branches.FirstOrDefault(x => x.Id == id);
        if (branch is null) return Result<BranchDto>.Failure(Error.NotFound("Şube bulunamadı."));

        branch.Rename(request.Name, request.City);
        if (request.IsDefault)
        {
            foreach (var existing in tenant!.Branches) existing.MarkDefault(existing.Id == branch.Id);
        }
        else
        {
            branch.MarkDefault(false);
        }

        await _db.SaveChangesAsync(cancellationToken);
        var counts = await StaffCountsAsync(tenantId, cancellationToken);
        return Result<BranchDto>.Success(branch.ToDto(counts.GetValueOrDefault(branch.Id)));
    }
}

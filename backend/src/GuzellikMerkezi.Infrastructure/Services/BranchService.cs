using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class BranchService : IBranchService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;

    public BranchService(GuzellikDbContext db, IUsageService usage)
    {
        _db = db;
        _usage = usage;
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
        var limit = await _usage.CheckLimitAsync(tenantId, "branches", cancellationToken);
        if (limit.IsFailure) return Result<BranchDto>.Failure(limit.Error);

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

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
        var items = await _db.Branches.AsNoTracking().Where(x => x.TenantId == tenantId).OrderByDescending(x => x.IsDefault).ThenBy(x => x.Name).Select(x => x.ToDto()).ToArrayAsync(cancellationToken);
        return Result<IReadOnlyCollection<BranchDto>>.Success(items);
    }

    public async Task<Result<BranchDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var branch = await _db.Branches.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return branch is null ? Result<BranchDto>.Failure(Error.NotFound("Şube bulunamadı.")) : Result<BranchDto>.Success(branch.ToDto());
    }

    public async Task<Result<BranchDto>> CreateAsync(Guid tenantId, UpsertBranchRequest request, CancellationToken cancellationToken = default)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "branches", cancellationToken);
        if (limit.IsFailure) return Result<BranchDto>.Failure(limit.Error);

        var tenant = await _db.Tenants.Include(x => x.Branches).FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<BranchDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var branch = tenant.AddBranch(request.Name, request.City, request.IsDefault);
        branch.UpdateCapacity(request.StaffCount, request.RoomCount);
        // Yeni şube yalnızca navigation collection üzerinden eklendiğinde, PK constructor'da
        // (Guid.CreateVersion7) set edildiği için EF DetectChanges bunu mevcut kayıt sanıp UPDATE
        // üretiyor (0 satır → DbUpdateConcurrencyException). DbSet'e açıkça ekleyip INSERT'e zorluyoruz.
        _db.Branches.Add(branch);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<BranchDto>.Success(branch.ToDto());
    }

    public async Task<Result<BranchDto>> UpdateAsync(Guid tenantId, Guid id, UpsertBranchRequest request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Branches).FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        var branch = tenant?.Branches.FirstOrDefault(x => x.Id == id);
        if (branch is null) return Result<BranchDto>.Failure(Error.NotFound("Şube bulunamadı."));

        branch.Rename(request.Name, request.City);
        branch.UpdateCapacity(request.StaffCount, request.RoomCount);
        if (request.IsDefault)
        {
            foreach (var existing in tenant!.Branches) existing.MarkDefault(existing.Id == branch.Id);
        }
        else
        {
            branch.MarkDefault(false);
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result<BranchDto>.Success(branch.ToDto());
    }
}

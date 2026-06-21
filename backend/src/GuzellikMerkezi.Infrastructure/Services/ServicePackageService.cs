using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.ServicePackages;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class ServicePackageService : IServicePackageService
{
    private readonly GuzellikDbContext _db;
    private readonly ITenantContext _tenantContext;

    public ServicePackageService(GuzellikDbContext db, ITenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    public async Task<Result<PagedResult<ServicePackageDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        // Paket kataloğu şubeye özeldir: seçili şubenin paketleri + şubesi olmayan (kurum geneli) paketler.
        var branchId = _tenantContext.BranchId;
        var query = _db.ServicePackages
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && (branchId == null || x.BranchId == null || x.BranchId == branchId))
            .Include(x => x.Items)
            .ThenInclude(item => item.ServiceDefinition)
            .OrderBy(x => x.Name)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(x => x.Name.Contains(search) || (x.Description != null && x.Description.Contains(search)));
        }

        var total = await query.CountAsync(cancellationToken);
        var packages = await query.Skip(request.Skip).Take(request.SafePageSize).ToArrayAsync(cancellationToken);
        var items = packages.Select(p => p.ToDto()).ToArray();
        return Result<PagedResult<ServicePackageDto>>.Success(new PagedResult<ServicePackageDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<ServicePackageDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var package = await _db.ServicePackages
            .Include(x => x.Items)
            .ThenInclude(i => i.ServiceDefinition)
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return package is null
            ? Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."))
            : Result<ServicePackageDto>.Success(package.ToDto());
    }

    public async Task<Result<ServicePackageDto>> CreateAsync(Guid tenantId, UpsertServicePackageRequest request, CancellationToken cancellationToken = default)
    {
        var serviceIds = request.Items?.Select(x => x.ServiceDefinitionId).Distinct().ToArray() ?? Array.Empty<Guid>();
        var services = await _db.ServiceDefinitions
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .ToDictionaryByIdsAsync(serviceIds, x => x.Id, cancellationToken);

        var package = new ServicePackage(
            tenantId,
            request.BranchId,
            request.Name,
            request.TotalPrice,
            request.DepositAmount,
            request.InstallmentCount,
            request.Description);
        package.SetCategory(request.Category);
        package.SetIcon(request.IconKey);
        package.SetStatus(request.Status);
        package.SetLoyaltyPointCost(request.LoyaltyPointCost);

        package.ReplaceItems((request.Items ?? Array.Empty<UpsertServicePackageItemRequest>()).Select(item => (
            ServiceDefinitionId: item.ServiceDefinitionId,
            SessionCount: item.SessionCount,
            UnitPrice: item.UnitPrice ?? (services.TryGetValue(item.ServiceDefinitionId, out var svc) ? svc.Price : 0m))));

        _db.ServicePackages.Add(package);
        await _db.SaveChangesAsync(cancellationToken);

        var hydrated = await _db.ServicePackages
            .AsNoTracking()
            .Include(x => x.Items)
            .ThenInclude(i => i.ServiceDefinition)
            .FirstAsync(x => x.Id == package.Id, cancellationToken);
        return Result<ServicePackageDto>.Success(hydrated.ToDto());
    }

    public async Task<Result<ServicePackageDto>> UpdateAsync(Guid tenantId, Guid id, UpsertServicePackageRequest request, CancellationToken cancellationToken = default)
    {
        var package = await _db.ServicePackages
            .Include(x => x.Items)
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (package is null) return Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."));

        var serviceIds = request.Items?.Select(x => x.ServiceDefinitionId).Distinct().ToArray() ?? Array.Empty<Guid>();
        var services = await _db.ServiceDefinitions
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .ToDictionaryByIdsAsync(serviceIds, x => x.Id, cancellationToken);

        package.Rename(request.Name, request.Description);
        package.SetCategory(request.Category);
        package.SetIcon(request.IconKey);
        package.ChangePricing(request.TotalPrice, request.DepositAmount, request.InstallmentCount);
        package.SetStatus(request.Status);
        package.SetLoyaltyPointCost(request.LoyaltyPointCost);
        package.ReplaceItems((request.Items ?? Array.Empty<UpsertServicePackageItemRequest>()).Select(item => (
            ServiceDefinitionId: item.ServiceDefinitionId,
            SessionCount: item.SessionCount,
            UnitPrice: item.UnitPrice ?? (services.TryGetValue(item.ServiceDefinitionId, out var svc) ? svc.Price : 0m))));

        await _db.SaveChangesAsync(cancellationToken);

        var hydrated = await _db.ServicePackages
            .AsNoTracking()
            .Include(x => x.Items)
            .ThenInclude(i => i.ServiceDefinition)
            .FirstAsync(x => x.Id == package.Id, cancellationToken);
        return Result<ServicePackageDto>.Success(hydrated.ToDto());
    }

    public async Task<Result<ServicePackageDto>> UpdateCategoryAsync(
        Guid tenantId,
        Guid id,
        UpdateServicePackageCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var package = await _db.ServicePackages
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (package is null) return Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."));

        package.SetCategory(request.Category);
        await _db.SaveChangesAsync(cancellationToken);

        var hydrated = await _db.ServicePackages
            .AsNoTracking()
            .Include(x => x.Items)
            .ThenInclude(i => i.ServiceDefinition)
            .FirstAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return Result<ServicePackageDto>.Success(hydrated.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var package = await _db.ServicePackages.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (package is null) return Result.Failure(Error.NotFound("Paket bulunamadı."));
        package.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

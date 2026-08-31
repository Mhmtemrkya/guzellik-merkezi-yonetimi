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
    private readonly ICurrentUser _currentUser;

    public ServicePackageService(GuzellikDbContext db, ITenantContext tenantContext, ICurrentUser currentUser)
    {
        _db = db;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
    }

    public async Task<Result<PagedResult<ServicePackageDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        // Paket kataloğu şubeye özeldir: seçili şubenin paketleri + şubesi olmayan (kurum geneli) paketler.
        // ZORLAMA NOKTASI ARTIK GLOBAL SÜZGEÇTİR (bkz. GuzellikDbContext.ConfigureServicePackage);
        // buradaki koşul yalnız platform yöneticisinin görünümünü daraltır.
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

    /// <summary>
    /// KAPSAM SORGUSU — TEKİL ERİŞİMİN TEK KAPISI (pentest YÜKSEK-2).
    /// Liste süzülüyordu ama tekil GET/PUT/DELETE/iptal/geri-al yalnız <c>(TenantId, Id)</c> ile
    /// eşleşiyordu; kardeş şubenin paket kimliğini edinen şube yöneticisi o kaydı yönetebiliyordu.
    /// Kuralın neden burada olduğu (global query filter yerine):
    /// bkz. <see cref="ServiceCatalogService"/> ve GuzellikDbContext.ConfigureServiceDefinition.
    /// </summary>
    private IQueryable<ServicePackage> InScope(Guid tenantId)
    {
        var branchId = _tenantContext.BranchId;
        return _db.ServicePackages
            .Where(x => x.TenantId == tenantId && (branchId == null || x.BranchId == null || x.BranchId == branchId));
    }

    public async Task<Result<ServicePackageDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var package = await InScope(tenantId)
            .Include(x => x.Items)
            .ThenInclude(i => i.ServiceDefinition)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
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

        // Global süzgeç OKUMAYI kapsar, INSERT'i kapsamaz: gövdedeki şube ayrıca doğrulanmalı.
        var (branchId, branchError) = await BranchScopeGuard.ResolveForWriteAsync(
            _db, _tenantContext, _currentUser, tenantId, request.BranchId, cancellationToken);
        if (branchError is not null) return Result<ServicePackageDto>.Failure(branchError);

        var package = new ServicePackage(
            tenantId,
            branchId,
            request.Name,
            request.TotalPrice,
            request.DepositAmount,
            request.InstallmentCount,
            request.Description);
        package.SetCategory(request.Category, request.SubCategory);
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
        var package = await InScope(tenantId)
            .Include(x => x.Items)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (package is null) return Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."));

        var serviceIds = request.Items?.Select(x => x.ServiceDefinitionId).Distinct().ToArray() ?? Array.Empty<Guid>();
        var services = await _db.ServiceDefinitions
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .ToDictionaryByIdsAsync(serviceIds, x => x.Id, cancellationToken);

        package.Rename(request.Name, request.Description);
        package.SetCategory(request.Category, request.SubCategory);
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

    /// <summary>
    /// Paket TANIMININ iptali: kurum bu paketten vazgeçer, gerekçesiyle kaydedilir. Paket silinmez —
    /// geçmiş satışlar ve raporlar korunur, paket yalnızca satış listelerinden düşer (IsActive=false).
    /// Müşterinin satış iptali (CustomerAccountService.CancelSaleAsync) BAŞKA bir kavramdır.
    /// </summary>
    public async Task<Result<ServicePackageDto>> CancelAsync(Guid tenantId, Guid id, CancelServicePackageRequest request, CancellationToken cancellationToken = default)
    {
        var package = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (package is null) return Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."));

        package.CancelCatalog(request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        return await HydrateAsync(tenantId, id, cancellationToken);
    }

    public async Task<Result<ServicePackageDto>> RestoreAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var package = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (package is null) return Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."));

        package.RestoreCatalog();
        await _db.SaveChangesAsync(cancellationToken);
        return await HydrateAsync(tenantId, id, cancellationToken);
    }

    private async Task<Result<ServicePackageDto>> HydrateAsync(Guid tenantId, Guid id, CancellationToken cancellationToken)
    {
        var hydrated = await _db.ServicePackages
            .AsNoTracking()
            .Include(x => x.Items)
            .ThenInclude(i => i.ServiceDefinition)
            .FirstAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return Result<ServicePackageDto>.Success(hydrated.ToDto());
    }

    public async Task<Result<ServicePackageDto>> UpdateCategoryAsync(
        Guid tenantId,
        Guid id,
        UpdateServicePackageCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var package = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (package is null) return Result<ServicePackageDto>.Failure(Error.NotFound("Paket bulunamadı."));

        package.SetCategory(request.Category, request.SubCategory);
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
        var package = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (package is null) return Result.Failure(Error.NotFound("Paket bulunamadı."));
        package.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.ServiceCatalog;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class ServiceCatalogService : IServiceCatalogService
{
    private readonly GuzellikDbContext _db;
    private readonly ITenantContext _tenantContext;

    public ServiceCatalogService(GuzellikDbContext db, ITenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    public async Task<Result<PagedResult<ServiceDefinitionDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        // Hizmet kataloğu şubeye özeldir: seçili şubenin hizmetleri + şubesi olmayan (kurum geneli) hizmetler.
        var branchId = _tenantContext.BranchId;
        var query = _db.ServiceDefinitions.AsNoTracking()
            .Where(x => x.TenantId == tenantId && (branchId == null || x.BranchId == null || x.BranchId == branchId))
            .OrderBy(x => x.Name).AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(x => x.Name.Contains(search) || (x.Category != null && x.Category.Contains(search)));
        }
        var total = await query.CountAsync(cancellationToken);
        var items = await query.Skip(request.Skip).Take(request.SafePageSize).Select(x => x.ToDto()).ToArrayAsync(cancellationToken);
        return Result<PagedResult<ServiceDefinitionDto>>.Success(new PagedResult<ServiceDefinitionDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<ServiceDefinitionDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var service = await _db.ServiceDefinitions.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return service is null ? Result<ServiceDefinitionDto>.Failure(Error.NotFound("Hizmet bulunamadı.")) : Result<ServiceDefinitionDto>.Success(service.ToDto());
    }

    public async Task<Result<ServiceDefinitionDto>> CreateAsync(Guid tenantId, UpsertServiceDefinitionRequest request, CancellationToken cancellationToken = default)
    {
        var service = new ServiceDefinition(tenantId, request.BranchId, request.Name, request.DurationMinutes, request.Price, request.Category);
        service.SetStatus(request.Status);
        service.SetIcon(request.IconKey);
        service.SetDefaultSessions(Math.Max(1, request.DefaultSessionCount));
        service.SetLoyaltyPointCost(request.LoyaltyPointCost);
        _db.ServiceDefinitions.Add(service);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<ServiceDefinitionDto>.Success(service.ToDto());
    }

    public async Task<Result<ServiceDefinitionDto>> UpdateAsync(Guid tenantId, Guid id, UpsertServiceDefinitionRequest request, CancellationToken cancellationToken = default)
    {
        var service = await _db.ServiceDefinitions.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (service is null) return Result<ServiceDefinitionDto>.Failure(Error.NotFound("Hizmet bulunamadı."));

        service.Rename(request.Name, request.Category);
        service.ChangePricing(request.DurationMinutes, request.Price);
        service.SetStatus(request.Status);
        service.SetIcon(request.IconKey);
        service.SetDefaultSessions(Math.Max(1, request.DefaultSessionCount));
        service.SetLoyaltyPointCost(request.LoyaltyPointCost);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<ServiceDefinitionDto>.Success(service.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var service = await _db.ServiceDefinitions.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (service is null) return Result.Failure(Error.NotFound("Hizmet bulunamadı."));
        service.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

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
    private readonly ICurrentUser _currentUser;

    public ServiceCatalogService(GuzellikDbContext db, ITenantContext tenantContext, ICurrentUser currentUser)
    {
        _db = db;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
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

    /// <summary>
    /// KAPSAM SORGUSU — TEKİL ERİŞİMİN TEK KAPISI (pentest YÜKSEK-2).
    ///
    /// <para>
    /// Liste süzülüyordu ama tekil GET/PUT/DELETE yalnız <c>(TenantId, Id)</c> ile eşleşiyordu:
    /// kardeş şubenin hizmet UUID'sini başka bir akıştan edinen şube yöneticisi o kaydı okuyabiliyor,
    /// güncelleyebiliyor ve silebiliyordu. Arayüzün listeyi süzmesi yetkilendirme DEĞİLDİR.
    /// </para>
    ///
    /// <para>
    /// Kural neden burada, global query filter'da değil: katalog kaydını KİMLİKLE okuyan iç yollar
    /// (randevu/adisyon/seans/rapor projeksiyonları) da süzülür ve şubesi farklı bir hizmete işaret
    /// eden geçmiş kayıtlar adı boş görünürdü — bkz. GuzellikDbContext.ConfigureServiceDefinition.
    /// </para>
    ///
    /// <para><c>BranchId = null</c> kurum geneli hizmettir; her şubede görünür (tek şubeli ve eski
    /// kurumların TÜM kataloğu böyledir).</para>
    /// </summary>
    private IQueryable<ServiceDefinition> InScope(Guid tenantId)
    {
        var branchId = _tenantContext.BranchId;
        return _db.ServiceDefinitions
            .Where(x => x.TenantId == tenantId && (branchId == null || x.BranchId == null || x.BranchId == branchId));
    }

    public async Task<Result<ServiceDefinitionDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var service = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        return service is null ? Result<ServiceDefinitionDto>.Failure(Error.NotFound("Hizmet bulunamadı.")) : Result<ServiceDefinitionDto>.Success(service.ToDto());
    }

    public async Task<Result<ServiceDefinitionDto>> CreateAsync(Guid tenantId, UpsertServiceDefinitionRequest request, CancellationToken cancellationToken = default)
    {
        // Kapsam sorgusu OKUMAYI kapsar, INSERT'i kapsamaz: gövdedeki şube ayrıca doğrulanmalı.
        var (branchId, branchError) = await BranchScopeGuard.ResolveForWriteAsync(
            _db, _tenantContext, _currentUser, tenantId, request.BranchId, cancellationToken);
        if (branchError is not null) return Result<ServiceDefinitionDto>.Failure(branchError);

        var service = new ServiceDefinition(tenantId, branchId, request.Name, request.DurationMinutes, request.Price, request.Category, request.SubCategory);
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
        var service = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (service is null) return Result<ServiceDefinitionDto>.Failure(Error.NotFound("Hizmet bulunamadı."));

        service.Rename(request.Name, request.Category, request.SubCategory);
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
        var service = await InScope(tenantId).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (service is null) return Result.Failure(Error.NotFound("Hizmet bulunamadı."));
        service.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

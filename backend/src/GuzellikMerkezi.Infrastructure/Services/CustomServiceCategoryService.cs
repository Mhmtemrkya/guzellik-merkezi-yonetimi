using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.ServiceCatalog;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CustomServiceCategoryService : ICustomServiceCategoryService
{
    private readonly GuzellikDbContext _db;

    public CustomServiceCategoryService(GuzellikDbContext db) => _db = db;

    public async Task<Result<IReadOnlyCollection<CustomServiceCategoryDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var items = await _db.CustomServiceCategories
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Name)
            .Select(x => x.ToDto())
            .ToArrayAsync(cancellationToken);
        return Result<IReadOnlyCollection<CustomServiceCategoryDto>>.Success(items);
    }

    public async Task<Result<CustomServiceCategoryDto>> CreateAsync(Guid tenantId, UpsertCustomServiceCategoryRequest request, CancellationToken cancellationToken = default)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) return Result<CustomServiceCategoryDto>.Failure(Error.Validation("Kategori adı boş olamaz."));

        var existing = await _db.CustomServiceCategories
            .Where(x => x.TenantId == tenantId)
            .Select(x => new { x.Id, x.Name, x.ParentId })
            .ToListAsync(cancellationToken);
        // Aynı üst kategori altında (veya üst-seviyede) aynı ada izin verilmez; farklı parent'lar aynı adı taşıyabilir.
        var duplicate = existing.FirstOrDefault(x => x.ParentId == request.ParentId && string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
        if (duplicate is not null) return Result<CustomServiceCategoryDto>.Failure(Error.Conflict(request.ParentId is null ? "Bu adda bir kategori zaten var." : "Bu üst kategoride bu adda alt kategori zaten var."));

        var category = new CustomServiceCategory(tenantId, name, request.ParentId);
        if (!request.IsActive) category.Deactivate();
        _db.CustomServiceCategories.Add(category);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<CustomServiceCategoryDto>.Success(category.ToDto());
    }

    public async Task<Result<CustomServiceCategoryDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomServiceCategoryRequest request, CancellationToken cancellationToken = default)
    {
        var category = await _db.CustomServiceCategories.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (category is null) return Result<CustomServiceCategoryDto>.Failure(Error.NotFound("Kategori bulunamadı."));
        category.Rename(request.Name);
        category.SetParent(request.ParentId);
        if (request.IsActive) category.Activate(); else category.Deactivate();
        await _db.SaveChangesAsync(cancellationToken);
        return Result<CustomServiceCategoryDto>.Success(category.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var category = await _db.CustomServiceCategories.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (category is null) return Result.Failure(Error.NotFound("Kategori bulunamadı."));
        category.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

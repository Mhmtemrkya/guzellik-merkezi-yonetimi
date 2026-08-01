using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CustomExpenseCategoryService : ICustomExpenseCategoryService
{
    private readonly GuzellikDbContext _db;

    public CustomExpenseCategoryService(GuzellikDbContext db) => _db = db;

    public async Task<Result<IReadOnlyCollection<CustomExpenseCategoryDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var items = await _db.CustomExpenseCategories
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.Name)
            .Select(x => x.ToDto())
            .ToArrayAsync(cancellationToken);
        return Result<IReadOnlyCollection<CustomExpenseCategoryDto>>.Success(items);
    }

    public async Task<Result<CustomExpenseCategoryDto>> CreateAsync(Guid tenantId, UpsertCustomExpenseCategoryRequest request, CancellationToken cancellationToken = default)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) return Result<CustomExpenseCategoryDto>.Failure(Error.Validation("Kategori adı boş olamaz."));

        // Mükerrer kontrolü bellekte yapılıyor (ad şifreli → SQL benzersiz indeksi çalışmaz);
        // iki eşzamanlı istek ikisi de "yok" görüp aynı adı ekleyebiliyordu. Kurum satırı
        // kilitlenince aynı kurumun katalog yazımları serileşir.
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (_db.Database.IsRelational()) await RowLock.LockRowAsync(_db, "tenants", tenantId, cancellationToken);

        // Aynı isimde zaten var mı? (case-insensitive)
        var existing = await _db.CustomExpenseCategories
            .Where(x => x.TenantId == tenantId)
            .Select(x => new { x.Id, x.Name })
            .ToListAsync(cancellationToken);
        var duplicate = existing.FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
        if (duplicate is not null) return Result<CustomExpenseCategoryDto>.Failure(Error.Conflict("Bu adda bir kategori zaten var."));

        var category = new CustomExpenseCategory(tenantId, name);
        if (!request.IsActive) category.Deactivate();
        _db.CustomExpenseCategories.Add(category);
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        return Result<CustomExpenseCategoryDto>.Success(category.ToDto());
    }

    public async Task<Result<CustomExpenseCategoryDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomExpenseCategoryRequest request, CancellationToken cancellationToken = default)
    {
        // Bkz. CreateAsync: mükerrer kontrolü bellekte yapıldığı için kurum satırı kilitlenir.
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (_db.Database.IsRelational()) await RowLock.LockRowAsync(_db, "tenants", tenantId, cancellationToken);

        var category = await _db.CustomExpenseCategories.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (category is null) return Result<CustomExpenseCategoryDto>.Failure(Error.NotFound("Kategori bulunamadı."));

        // MÜKERRER AD KONTROLÜ GÜNCELLEMEDE DE ŞART: ad AES-GCM ile rastgele nonce'la şifrelendiği
        // için {TenantId, Name} unique indeksi aynı düz metni yakalayamaz — yalnız oluşturmada
        // bakılıyordu, mevcut bir kategori başka kategorinin adına çevrilebiliyordu.
        var newName = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(newName)) return Result<CustomExpenseCategoryDto>.Failure(Error.Validation("Kategori adı boş olamaz."));
        var siblings = await _db.CustomExpenseCategories
            .Where(x => x.TenantId == tenantId && x.Id != id)
            .Select(x => x.Name)
            .ToListAsync(cancellationToken);
        if (siblings.Any(n => string.Equals(n, newName, StringComparison.OrdinalIgnoreCase)))
            return Result<CustomExpenseCategoryDto>.Failure(Error.Conflict("Bu adda bir kategori zaten var."));

        category.Rename(newName);
        if (request.IsActive) category.Activate(); else category.Deactivate();
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        return Result<CustomExpenseCategoryDto>.Success(category.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var category = await _db.CustomExpenseCategories.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (category is null) return Result.Failure(Error.NotFound("Kategori bulunamadı."));
        category.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

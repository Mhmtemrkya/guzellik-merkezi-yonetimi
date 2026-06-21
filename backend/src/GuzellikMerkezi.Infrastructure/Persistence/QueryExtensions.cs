using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// MySql.EntityFrameworkCore 10.x'te IN(...) sorgularının (Contains pattern'i) parametre üretimi
/// sırasında NullReferenceException fırlatması bilinen bir bug'dır. Bu extension'lar tablonun
/// tenant scope'undaki tüm row'ları çekip in-memory filtre uygular — küçük tablolar için
/// overhead ihmal edilebilir, büyük tablolarda ek `WHERE` daraltıcısı geçmek tavsiye edilir.
/// </summary>
public static class QueryExtensions
{
    /// <summary>
    /// Verilen id koleksiyonuyla eşleşen tüm row'ları döner. Sorgu önce row'ları materialize eder,
    /// sonra HashSet ile filtreler.
    /// </summary>
    public static async Task<List<TEntity>> ToListByIdsAsync<TEntity, TKey>(
        this IQueryable<TEntity> baseQuery,
        IEnumerable<TKey>? ids,
        Func<TEntity, TKey> idSelector,
        CancellationToken cancellationToken = default)
        where TKey : notnull
    {
        var idSet = ids?.ToHashSet() ?? new HashSet<TKey>();
        if (idSet.Count == 0) return new List<TEntity>();
        var all = await baseQuery.ToListAsync(cancellationToken);
        return all.Where(x => idSet.Contains(idSelector(x))).ToList();
    }

    /// <summary>
    /// Verilen id koleksiyonuyla eşleşen row'ları dictionary olarak döner.
    /// </summary>
    public static async Task<Dictionary<TKey, TEntity>> ToDictionaryByIdsAsync<TEntity, TKey>(
        this IQueryable<TEntity> baseQuery,
        IEnumerable<TKey>? ids,
        Func<TEntity, TKey> idSelector,
        CancellationToken cancellationToken = default)
        where TKey : notnull
    {
        var list = await baseQuery.ToListByIdsAsync(ids, idSelector, cancellationToken);
        return list.ToDictionary(idSelector);
    }
}

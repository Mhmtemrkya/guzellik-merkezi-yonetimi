using System.Reflection;
using GuzellikMerkezi.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// ŞUBE SİLİNMEDEN ÖNCE KAYITLARINI BAŞKA ŞUBEYE TAŞIR (kullanıcı isteği 18 Kas 2026: "şube silme olsun; silerse fiyat
/// ona göre güncellensin"). Hiçbir kayıt silinmez: müşteri, personel, kullanıcı, randevu, adisyon, cari, ürün, kasa ve
/// geçmiş kayıtlar seçilen şubeye geçer; şube ardından yumuşak silinir. Paket tutarı silinmemiş şubeleri saydığı için
/// (<see cref="Services.BillingCountsQuery"/>) bir sonraki ödemeden itibaren düşer.
///
/// <para>
/// <b>Tablo listesi EF modelinden türetilir</b> (bkz. <see cref="TenantPurge"/>): <c>BranchId</c> kolonu olan her tablo.
/// Elle yazılmış liste ilk yeni tabloda sessizce eksik kalır ve o tablonun satırları görünmez bir şubeye bağlı kalırdı.
/// Silinmiş (yumuşak) satırlar da taşınır: hiçbir satır silinen şubeye bağlı kalmaz. Yalnız <c>audit_logs</c> korunur:
/// denetim kaydı değiştirilmez (o gün hangi şubede yapıldığı doğru kalır).
/// </para>
///
/// <para>
/// <b>Ham SQL</b>: <c>ExecuteUpdateAsync</c>'in takma adlı UPDATE'ini MariaDB reddediyor (bkz. <see cref="DurableJobClaim"/>).
/// Çağıran tek transaction açar: yarım taşınmış şube (müşterisi gitmiş, randevusu kalmış) hiç taşınmamışından kötüdür.
/// </para>
/// </summary>
public static class BranchMerge
{
    /// <summary>Taşınmayan tablolar.</summary>
    private static readonly HashSet<string> KeepTables = new(StringComparer.OrdinalIgnoreCase) { "audit_logs" };

    private static readonly MethodInfo MoveTrackedMethod =
        typeof(BranchMerge).GetMethod(nameof(MoveTrackedAsync), BindingFlags.NonPublic | BindingFlags.Static)!;

    /// <summary>Kaynak şubenin bütün satırlarını hedef şubeye taşır; taşınan satır sayısını döner.</summary>
    public static async Task<int> MoveAsync(GuzellikDbContext db, Guid source, Guid target, CancellationToken ct)
    {
        var moved = 0;
        if (!db.Database.IsRelational())
        {
            // InMemory (birim testleri): ham SQL yok; satırlar izleyici üzerinden taşınır (çağıran kaydeder).
            foreach (var entity in BranchScoped(db).Where(entity => !entity.HasSharedClrType).DistinctBy(entity => entity.ClrType))
            {
                moved += await (Task<int>)MoveTrackedMethod.MakeGenericMethod(entity.ClrType).Invoke(null, [db, source, target, ct])!;
            }

            return moved;
        }

        foreach (var (table, column) in Columns(db))
        {
#pragma warning disable EF1002 // Tablo/kolon adı EF modelinden gelir (kullanıcı girdisi değil); şube kimlikleri parametreli.
            moved += await db.Database.ExecuteSqlRawAsync($"UPDATE `{table}` SET `{column}` = {{0}} WHERE `{column}` = {{1}}", [target, source], ct);
#pragma warning restore EF1002
        }

        return moved;
    }

    /// <summary>Taşınacak (tablo, BranchId kolonu) çiftleri; aynı tabloya eşlenen birden çok varlık bir kez.</summary>
    public static List<(string Table, string Column)> Columns(GuzellikDbContext db) =>
        BranchScoped(db)
            .Select(entity => (Table: entity.GetTableName()!, Column: entity.FindProperty("BranchId")!.GetColumnName(StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema()))!))
            .Distinct()
            .ToList();

    private static IEnumerable<IEntityType> BranchScoped(GuzellikDbContext db) =>
        db.Model.GetEntityTypes().Where(entity =>
            entity.ClrType != typeof(Branch)
            && entity.GetTableName() is { } table && !KeepTables.Contains(table)
            && entity.FindProperty("BranchId") is { } property
            && (property.ClrType == typeof(Guid) || property.ClrType == typeof(Guid?)));

    private static async Task<int> MoveTrackedAsync<T>(GuzellikDbContext db, Guid source, Guid target, CancellationToken ct)
        where T : class
    {
        var rows = (await db.Set<T>().IgnoreQueryFilters().ToListAsync(ct))
            .Where(row => Equals(db.Entry(row).Property("BranchId").CurrentValue, source))
            .ToList();
        foreach (var row in rows)
        {
            db.Entry(row).Property("BranchId").CurrentValue = target;
        }

        return rows.Count;
    }
}

using GuzellikMerkezi.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// KURUMU VERİTABANINDAN GERÇEKTEN SİLER (geri alınamaz).
///
/// <para>
/// <b>Neden elle tablo listesi yok?</b> Kuruma bağlı 50'den fazla tablo var ve her yeni özellik
/// bir tane daha ekliyor. Elle yazılan liste ilk yeni tabloda sessizce eksik kalır: kurum silinir
/// ama yetim satırlar kalır (raporlarda hayalet veri, sonraki silmede FK hatası). Bu yüzden tablo
/// listesi <b>EF modelinden türetilir</b> — <c>TenantId</c> alanı olan her varlık otomatik kapsama
/// girer. Yeni tablo eklendiğinde burada değişiklik gerekmez.
/// </para>
///
/// <para>
/// <b>Silme sırası:</b> yabancı anahtarlar yüzünden çocuk satırlar ebeveynden önce silinmelidir.
/// Sıra, modeldeki FK grafiğinden topolojik olarak hesaplanır. <c>branches</c> ve
/// <c>tenant_users</c> tabloları <c>DeleteBehavior.Restrict</c> ile bağlı olduğundan kurum
/// satırından ÖNCE silinmek zorundadır; onlar da bu hesaptan çıkar.
/// </para>
///
/// <para>
/// <b>Neden ham SQL?</b> Satırları EF ile yükleyip silmek, şifreli kolonları çözmeyi (ve bozuk
/// ciphertext'te patlamayı) gerektirir; ayrıca 12 bin müşterili bir kurumda belleğe sığmaz.
/// <c>DELETE ... WHERE TenantId = @id</c> kolon içeriğine hiç bakmaz.
/// </para>
/// </summary>
public static class TenantPurge
{
    /// <summary>
    /// Silme turu üst sınırı. Her tur en az bir tabloyu boşaltmalı; ilerleme durursa döngü zaten
    /// erken çıkar. Sınır yalnızca patolojik bir FK grafiğinde sonsuz döngüyü keser.
    /// </summary>
    private const int MaxPasses = 12;

    /// <summary>
    /// Kurum silinse bile KALAN tablolar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>audit_logs</c>: silme işleminin kendisi denetim kaydına yazılıyor. Bu tablo da
    /// temizlenseydi kurumu kimin, ne zaman sildiğinin kaydı işlemin kendisi tarafından yok
    /// edilirdi — denetlenebilirliğin tam tersi. Tabloda <c>Tenant</c> navigasyonu YOKTUR
    /// (<c>TenantId</c> yalnız bir kapsam kolonu), dolayısıyla kurum satırı silinince yabancı
    /// anahtar ihlali oluşmaz; kayıt yetim ama okunabilir kalır (kurum adı ve kodu özet metnine
    /// yazılıdır).
    /// </para>
    /// </remarks>
    private static readonly HashSet<string> KeepTables = new(StringComparer.OrdinalIgnoreCase)
    {
        "audit_logs",
    };

    /// <summary>
    /// Kuruma ait TÜM satırları siler ve kurumu kaldırır. Silinen satır sayısını tablo bazında döner.
    /// </summary>
    /// <remarks>
    /// Çağıran taraf işlemi (transaction) yönetir. Yarıda hata olursa geri alınabilmesi için
    /// tek bir transaction içinde çağrılmalıdır — yarım silinmiş kurum, hiç silinmemişten kötüdür.
    /// </remarks>
    public static async Task<Dictionary<string, int>> PurgeAsync(
        GuzellikDbContext db, Guid tenantId, ILogger? logger, CancellationToken ct = default)
    {
        var deleted = new Dictionary<string, int>();
        if (!db.Database.IsRelational())
        {
            // InMemory (birim testleri): ham SQL yok. Takip edilen varlıklar üzerinden sil.
            await PurgeInMemoryAsync(db, tenantId, ct);
            return deleted;
        }

        // TOPOLOJİK SIRA + YENİDEN DENEME.
        //
        // Sıra modelden hesaplanır ama tek başına yeterli DEĞİLDİR: FK grafiğinde döngü olabilir
        // (kendine referans, karşılıklı isteğe bağlı bağlar) ve topolojik sıralama böyle bir
        // kenarı kırmak zorunda kalır. Bu yüzden başarısız tablolar bir sonraki tura bırakılır:
        // her turda en az bir tablo boşaldığı sürece ilerleme sürer. Bu, "sıra %100 doğru olsun"
        // varsayımına dayanmaktan çok daha dayanıklıdır — ve yeni tablo eklendiğinde de bozulmaz.
        var pending = BuildDeletionOrder(db);
        var lastError = (Exception?)null;

        for (var pass = 0; pass < MaxPasses && pending.Count > 0; pass++)
        {
            var stillPending = new List<(string Table, string Column)>();
            foreach (var table in pending)
            {
                try
                {
#pragma warning disable EF1002 // Tablo/kolon adı EF modelinden gelir (kullanıcı girdisi değil); TenantId parametreli.
                    var rows = await db.Database.ExecuteSqlRawAsync(
                        $"DELETE FROM `{table.Table}` WHERE `{table.Column}` = {{0}}",
                        [tenantId], ct);
#pragma warning restore EF1002
                    if (rows > 0) deleted[table.Table] = deleted.GetValueOrDefault(table.Table) + rows;
                }
                catch (Exception ex)
                {
                    // Başka bir tabloya bağlı olduğu için henüz silinemedi (ya da tablo yok).
                    // Sonraki tura bırak; son turda da olmazsa hata yukarı taşınır.
                    lastError = ex;
                    stillPending.Add(table);
                }
            }

            // İlerleme yoksa daha fazla tur denemenin anlamı yok.
            if (stillPending.Count == pending.Count) break;
            pending = stillPending;
        }

        if (pending.Count > 0)
        {
            // SESSİZCE DEVAM ETMEK YOK: kalan tablo varsa kurum satırı da silinemeyecek ve
            // yarım silinmiş bir kurum bırakılacaktı. Transaction'ın geri alınması için patla.
            logger?.LogError(lastError,
                "Kurum silme tamamlanamadı; şu tablolar boşaltılamadı: {Tables}",
                string.Join(", ", pending.Select(p => p.Table)));
            throw new InvalidOperationException(
                $"Kurum silinemedi: {string.Join(", ", pending.Select(p => p.Table))} tabloları boşaltılamadı.",
                lastError);
        }

        // Son: kurum satırının kendisi. Buraya kadar bir çocuk satır kalmışsa FK hatası verir ve
        // transaction geri alınır — yarım silinmiş kurum bırakmaz.
#pragma warning disable EF1002
        var tenantRows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM `tenants` WHERE `Id` = {0}", [tenantId], ct);
#pragma warning restore EF1002
        deleted["tenants"] = tenantRows;
        return deleted;
    }

    /// <summary>InMemory sağlayıcı için: TenantId'si eşleşen takip edilebilir varlıkları siler.</summary>
    private static async Task PurgeInMemoryAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct)
    {
        // Sıra InMemory'de FK zorlaması olmadığı için önemsiz; yalnız kurum en sonda silinir.
        var users = await db.TenantUsers.IgnoreQueryFilters().Where(x => x.TenantId == tenantId).ToListAsync(ct);
        db.TenantUsers.RemoveRange(users);
        var branches = await db.Branches.IgnoreQueryFilters().Where(x => x.TenantId == tenantId).ToListAsync(ct);
        db.Branches.RemoveRange(branches);
        var customers = await db.Customers.IgnoreQueryFilters().Where(x => x.TenantId == tenantId).ToListAsync(ct);
        db.Customers.RemoveRange(customers);
        var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == tenantId, ct);
        if (tenant is not null) db.Tenants.Remove(tenant);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Silinecek (tablo, TenantId kolonu) çiftleri — çocuklar önce.</summary>
    private static List<(string Table, string Column)> BuildDeletionOrder(GuzellikDbContext db)
    {
        var model = db.Model;

        // 1) TenantId taşıyan varlıkları topla. Kurumun KENDİSİ hariç (o en sonda, elle silinir).
        var scoped = new List<IEntityType>();
        foreach (var entity in model.GetEntityTypes())
        {
            if (entity.ClrType == typeof(Tenant)) continue;
            var table = entity.GetTableName();
            if (table is null) continue;
            if (KeepTables.Contains(table)) continue; // bilerek korunan tablolar (bkz. KeepTables)
            if (FindTenantIdColumn(entity) is null) continue;
            scoped.Add(entity);
        }

        // 2) FK grafiğine göre derinlik: bir varlığa BAŞKA varlıklar bağlıysa o daha sonra silinir.
        //    (Derinlik = "bana bağımlı olanların en büyük derinliği + 1".)
        var depth = new Dictionary<IEntityType, int>();
        foreach (var entity in scoped) ComputeDepth(entity, scoped, depth, []);

        return scoped
            // ARTAN sıra: derinlik 0 = kimse ona bağlı değil (yaprak) → ÖNCE silinir.
            // Derinliği büyük olan (branches, staff_members gibi çok şeyin bağlı olduğu tablolar)
            // en sona kalır. Azalan sıralamak tam tersini yapar ve ilk DELETE'te FK hatası verir.
            .OrderBy(e => depth.TryGetValue(e, out var d) ? d : 0)
            .Select(e => (Table: e.GetTableName()!, Column: FindTenantIdColumn(e)!))
            // Aynı tabloya eşlenen birden çok varlık (TPH mirası) olabilir — tabloyu bir kez sil.
            .DistinctBy(x => x.Table)
            .ToList();
    }

    /// <summary>
    /// "Bu varlığa kaç katman bağımlı?" — bağımlıların en büyük derinliği + 1.
    /// Döngüler (kendine referans) <paramref name="visiting"/> ile kırılır.
    /// </summary>
    private static int ComputeDepth(
        IEntityType entity, List<IEntityType> scoped,
        Dictionary<IEntityType, int> depth, HashSet<IEntityType> visiting)
    {
        if (depth.TryGetValue(entity, out var known)) return known;
        if (!visiting.Add(entity)) return 0; // döngü — burada dur

        var max = 0;
        // entity'ye işaret eden FK'lar: onların sahibi ÖNCE silinmeli.
        foreach (var fk in entity.GetReferencingForeignKeys())
        {
            var dependent = fk.DeclaringEntityType;
            if (!scoped.Contains(dependent)) continue;
            if (dependent == entity) continue;
            var d = ComputeDepth(dependent, scoped, depth, visiting) + 1;
            if (d > max) max = d;
        }

        visiting.Remove(entity);
        depth[entity] = max;
        return max;
    }

    /// <summary>Varlığın TenantId kolonunun DB adı; yoksa null.</summary>
    private static string? FindTenantIdColumn(IEntityType entity)
    {
        var prop = entity.FindProperty("TenantId");
        if (prop is null || prop.ClrType != typeof(Guid) && prop.ClrType != typeof(Guid?)) return null;
        var table = entity.GetTableName();
        var schema = entity.GetSchema();
        return table is null
            ? null
            : prop.GetColumnName(StoreObjectIdentifier.Table(table, schema));
    }
}

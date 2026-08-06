using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KAPI: CANLIDA PATLAYAN SORGU DESENLERİ.
///
/// <para>
/// BU KAPI NEDEN VAR: bu iki desen YERELDE SESSİZCE ÇALIŞIR, canlıda patlar — yani en kötü hata
/// türüdür. İkisi de bu depoda gerçekten yaşandı:
/// </para>
/// <list type="bullet">
/// <item><b>ExecuteDeleteAsync</b> — EF, tek tablolu silmeyi <c>DELETE FROM tablo AS t</c> olarak
/// üretir; takma adı yalnız MySQL 8 kabul eder, CANLI MariaDB REDDEDER. Kuyruk temizliği bu yüzden
/// haftalarca hiç çalışmadan saatte bir hata logu bıraktı.</item>
/// <item><b>Yerel koleksiyonla .Contains()</b> — sağlayıcı parametreye tip eşlemesi atayamıyor ve
/// sorgu çalışma anında patlıyor (500). Personelin HER yazma isteğini düşüren bir hata bu yüzden
/// canlıya çıktı. Kritik ayrım: <c>static readonly</c> diziler sabit olarak gömüldüğü için
/// sorunsuzdur — yani "bu desen zaten kullanılıyor" güvence değildir.</item>
/// </list>
/// </summary>
public sealed class QueryTranslationTests
{
    [Fact]
    public void ExecuteDeleteAsyncIsNeverUsed()
    {
        var violations = new List<string>();

        foreach (var file in SourceTree.ProductionFiles())
        {
            var content = SourceTree.StripComments(File.ReadAllText(file));
            foreach (Match m in Regex.Matches(content, @"\.ExecuteDeleteAsync\s*\("))
            {
                violations.Add($"{SourceTree.Relative(file)}:{SourceTree.LineOf(content, m.Index)} → ExecuteDeleteAsync");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "ExecuteDeleteAsync KULLANILAMAZ (MariaDB reddediyor).",
            """
            EF'in ürettiği takma adlı DELETE'i canlı MariaDB kabul etmez; yerel MySQL 8'de sorunsuz
            çalıştığı için hata ancak CANLIDA görünür.

            ÇÖZÜM: takma adsız ham SQL + LIMIT ile partili silme —
            BackgroundJobMaintenance.PurgeSucceededAsync desendir.
            (ExecuteUpdateAsync etkilenmez: MariaDB UPDATE'te takma ada izin verir.)
            """,
            violations));
    }

    [Fact]
    public void NoLocalCollectionContainsInsideQueries()
    {
        var violations = new List<string>();

        foreach (var file in SourceTree.ProductionFiles())
        {
            var content = SourceTree.StripComments(File.ReadAllText(file));

            // YEREL değişkenler: metot içinde tanımlanan liste/dizi/HashSet'ler.
            var locals = Regex.Matches(content, @"\bvar\s+(?<n>\w+)\s*=\s*new\s*(?:\[\]|List<|HashSet<|\w+\[\])")
                .Select(m => m.Groups["n"].Value)
                .ToHashSet(StringComparer.Ordinal);
            if (locals.Count == 0) continue;

            // Sorgu İÇİNDEKİ .Contains(): Where/Any/All lambda'sında geçenler sunucuya çevrilir.
            foreach (Match m in Regex.Matches(content, @"\.(?:Where|Any|All|Count|First|Single)\w*\s*\([^;]{0,400}?(?<n>\w+)\.Contains\("))
            {
                var name = m.Groups["n"].Value;
                if (!locals.Contains(name)) continue;

                // KURAL YALNIZ EF SORGULARI İÇİNDİR. Bellek içi LINQ (dizi/liste üzerinde .Any)
                // aynı sözdizimini kullanır ama sunucuya hiç gitmez; ayırt edilmezse kural
                // meşru kodu ihlal sayar (ör. Split() sonucunda arama) ve güvenilirliğini yitirir.
                // Ölçüt: ifade bir DbSet'ten başlıyor mu?
                var statementStart = content.LastIndexOfAny([';', '{', '}'], m.Index) + 1;
                var statement = content[statementStart..m.Index];
                var isEntityQuery = statement.Contains("_db.", StringComparison.Ordinal)
                                    || statement.Contains("db.", StringComparison.Ordinal)
                                    || statement.Contains("AsNoTracking", StringComparison.Ordinal)
                                    || statement.Contains("IgnoreQueryFilters", StringComparison.Ordinal);
                if (!isEntityQuery) continue;

                // Materyalize edilmiş sorgudan sonra bellekte süzme meşrudur; ToList/ToArray
                // görünüyorsa sorgu zaten belleğe alınmıştır.
                if (statement.Contains("ToListAsync", StringComparison.Ordinal)
                    || statement.Contains("ToList()", StringComparison.Ordinal)
                    || statement.Contains("ToArrayAsync", StringComparison.Ordinal)) continue;

                violations.Add(
                    $"{SourceTree.Relative(file)}:{SourceTree.LineOf(content, m.Index)} " +
                    $"→ yerel koleksiyon '{name}' EF sorgusu içinde .Contains() ile kullanılıyor");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "YEREL KOLEKSİYONLA .Contains() SUNUCUYA ÇEVRİLEMEZ.",
            """
            MySql.EntityFrameworkCore, yerel bir diziden üretilen IN (...) için parametreye tip
            eşlemesi atayamıyor ve sorgu ÇALIŞMA ANINDA patlıyor ("does not have a type mapping
            assigned"). Yerelde fark edilmez, canlıda 500 verir.

            ÇÖZÜM: önce ToListAsync ile materyalize edin, süzmeyi BELLEKTE yapın.
            NOT: `static readonly` diziler sabit olarak gömülür ve bu kuralın dışındadır.
            """,
            violations));
    }

    /// <summary>
    /// KAPININ KENDİSİ ÇALIŞIYOR MU? — "hiç ihlal yok" ile "kural bozuk" aynı görünür.
    ///
    /// <para>
    /// Bir konvansiyon kapısının en sinsi başarısızlığı sessizce hiçbir şey yakalamamasıdır: yeşil
    /// yanar, kimse fark etmez, korunduğu sanılan kural aslında korunmaz. Bu test kuralı BİLİNEN
    /// bir ihlal ve BİLİNEN bir masum örnek üzerinde çalıştırır: ihlali yakalamalı, masumu
    /// yakalamamalıdır. (Aynı sebeple bu kapı, gerçek bir yanlış pozitifi de yakaladı: Split()
    /// sonucunda arama yapan bellek içi LINQ, EF sorgusu sanılıyordu.)
    /// </para>
    /// </summary>
    [Fact]
    public void RuleDetectsKnownViolationAndIgnoresInMemoryLinq()
    {
        const string offending = """
            var ids = new List<Guid>();
            var rows = await _db.Customers.Where(c => ids.Contains(c.Id)).ToListAsync(ct);
            """;
        const string innocent = """
            var parts = new[] { "a", "b" };
            var hasLegacy = parts.Any(p => legacyKeys.Contains(p));
            """;

        Assert.NotEmpty(Scan(offending));   // EF sorgusu → yakalanmalı
        Assert.Empty(Scan(innocent));       // bellek içi LINQ → yakalanmamalı
    }

    /// <summary>Kuralın tek gövdesi; hem gerçek kaynakta hem kendi kendini doğrulayan testte kullanılır.</summary>
    private static List<string> Scan(string content)
    {
        var found = new List<string>();
        var locals = Regex.Matches(content, @"\bvar\s+(?<n>\w+)\s*=\s*new\s*(?:\[\]|List<|HashSet<|\w+\[\])")
            .Select(m => m.Groups["n"].Value)
            .ToHashSet(StringComparer.Ordinal);

        foreach (Match m in Regex.Matches(content, @"\.(?:Where|Any|All|Count|First|Single)\w*\s*\([^;]{0,400}?(?<n>\w+)\.Contains\("))
        {
            if (!locals.Contains(m.Groups["n"].Value)) continue;

            var statementStart = content.LastIndexOfAny([';', '{', '}'], m.Index) + 1;
            var statement = content[statementStart..m.Index];
            var isEntityQuery = statement.Contains("_db.", StringComparison.Ordinal)
                                || statement.Contains("db.", StringComparison.Ordinal)
                                || statement.Contains("AsNoTracking", StringComparison.Ordinal)
                                || statement.Contains("IgnoreQueryFilters", StringComparison.Ordinal);
            if (!isEntityQuery) continue;
            if (statement.Contains("ToListAsync", StringComparison.Ordinal)
                || statement.Contains("ToList()", StringComparison.Ordinal)
                || statement.Contains("ToArrayAsync", StringComparison.Ordinal)) continue;

            found.Add(m.Value);
        }
        return found;
    }
}

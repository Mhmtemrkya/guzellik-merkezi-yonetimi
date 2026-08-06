using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KONVANSİYON KAPILARININ ORTAK TARAYICISI.
///
/// <para>
/// NEDEN VAR: bu depoda dokuz denetim turu yapıldı ve her turda kapatılan kusurun AYNI SINIFI,
/// henüz denetlenmemiş bir dosyada yaşamaya devam etti. Somut örnek: <c>gift_cards</c> satır kilidi
/// protokolüne bir turda alındı ama YALNIZ o turda bildirilen yol (adisyon onayı) kilitlendi;
/// doğrudan kullanım ucu açık kaldı ve aylarca kimse fark etmedi. Kuralı yorumda tutmak yetmiyor —
/// kuralın kendisi kod tabanının TAMAMINI tarayan bir test olmalı ki her yeni dosyaya kendiliğinden
/// uygulansın.
/// </para>
/// <para>
/// Bu sınıf kaynak ağacını bulur ve dosyaları okur. Testler ihlalleri DOSYA:SATIR olarak raporlar;
/// böylece kural kırıldığında "nerede" sorusu ayrıca aranmaz.
/// </para>
/// </summary>
internal static class SourceTree
{
    private static readonly Lazy<string> RootPath = new(FindRoot);

    /// <summary>Depodaki <c>backend/src</c> dizini.</summary>
    public static string SourceRoot => RootPath.Value;

    /// <summary>
    /// Derleme çıktısından yukarı çıkarak depo kökünü bulur. Yol sabitlemek yerine arama yapılır:
    /// çıktı dizininin derinliği yapılandırmaya (Debug/Release) ve hedef çatıya göre değişir.
    /// </summary>
    private static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "src", "GuzellikMerkezi.Infrastructure");
            if (Directory.Exists(candidate)) return Path.Combine(dir.FullName, "src");
            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Kaynak ağacı bulunamadı (backend/src). Konvansiyon kapıları kaynak dosyaları okur; " +
            "test çıktısı depo ağacının dışına taşındıysa bu arama güncellenmeli.");
    }

    /// <summary>Üretim kaynak dosyaları (derleme çıktısı ve üretilmiş dosyalar hariç).</summary>
    public static IEnumerable<string> ProductionFiles() =>
        Directory.EnumerateFiles(SourceRoot, "*.cs", SearchOption.AllDirectories)
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            // Migration'lar ve model anlık görüntüsü ARAÇ ÜRETİMİDİR: biçimleri EF'e aittir ve
            // uygulanmış olanlar zaten değiştirilemez (bkz. migration-manifest.sh).
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}", StringComparison.Ordinal));

    /// <summary>Depo köküne göre kısa yol — hata mesajları tıklanabilir olsun.</summary>
    public static string Relative(string absolutePath) =>
        Path.GetRelativePath(SourceRoot, absolutePath).Replace('\\', '/');

    /// <summary>Dosyayı satır satır okur (1 tabanlı satır numarasıyla).</summary>
    public static IEnumerable<(int Line, string Text)> ReadLines(string path)
    {
        var lines = File.ReadAllLines(path);
        for (var i = 0; i < lines.Length; i++) yield return (i + 1, lines[i]);
    }

    /// <summary>
    /// Bir metottaki gövdeyi kabaca çıkarır: <paramref name="startIndex"/>'ten başlayarak süslü
    /// parantez dengesi kapanana kadar. Tam bir ayrıştırıcı değildir; kural taramaları için
    /// yeterlidir ve dış bağımlılık gerektirmez.
    /// </summary>
    public static string ExtractBlock(string content, int startIndex)
    {
        var open = content.IndexOf('{', startIndex);
        if (open < 0) return string.Empty;

        var depth = 0;
        for (var i = open; i < content.Length; i++)
        {
            if (content[i] == '{') depth++;
            else if (content[i] == '}')
            {
                depth--;
                if (depth == 0) return content[open..(i + 1)];
            }
        }
        return content[open..];
    }

    /// <summary>Bir konumun kaçıncı satırda olduğunu döner (hata mesajı için).</summary>
    public static int LineOf(string content, int index) =>
        content.Take(index).Count(c => c == '\n') + 1;

    /// <summary>İhlal listesini okunur bir hata mesajına çevirir.</summary>
    public static string Describe(string rule, string why, IReadOnlyCollection<string> violations) =>
        $"""
        {rule}

        {why}

        İHLALLER ({violations.Count}):
        {string.Join(Environment.NewLine, violations.Select(v => "  · " + v))}
        """;

    /// <summary>Yorum satırlarını eler (kural taraması koddaki gerçek çağrılara baksın).</summary>
    public static string StripComments(string content)
    {
        content = Regex.Replace(content, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        content = Regex.Replace(content, @"^\s*//.*$", string.Empty, RegexOptions.Multiline);
        return content;
    }
}

using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Domain.Assistant;

/// <summary>
/// Maydi'nin metin katlaması: küçük harf (Türkçe kurallarıyla, "I" → "ı"), Türkçe karakterler ASCII'ye
/// ("ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u") ve fazla boşluk teke. Katalog anahtar kelimeleri, kural motoru ve
/// maskeleme hep bu biçimle karşılaştırır.
/// </summary>
public static partial class AssistantText
{
    private static readonly CultureInfo Turkish = new("tr-TR");

    public static string Normalize(string? value) =>
        MultiSpace().Replace((value ?? string.Empty).Trim().ToLower(Turkish), " ");

    public static string Fold(string? value) => RemoveDiacritics(Normalize(value));

    private static string RemoveDiacritics(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            builder.Append(c switch
            {
                'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u', 'â' => 'a', 'î' => 'i', 'û' => 'u',
                _ => c,
            });
        }
        return builder.ToString();
    }

    /// <summary>Asistanın adı; istemcilerde başlık da budur.</summary>
    public const string AssistantName = "Maydi";

    /// <summary>
    /// "Maydi, bugün kaç randevum var?" gibi hitaplardan adı çıkarır; ad bir müşteri adı sanılmasın.
    /// Yalnız adı yazan kullanıcı ("Maydi!") selam vermiş sayılır; "Maydi kim?" adın kendisini sorar.
    /// </summary>
    public static string WithoutName(string message)
    {
        if (string.IsNullOrEmpty(message) || !NameRegex().IsMatch(message)) return message ?? string.Empty;
        var rest = MultiSpace().Replace(NameRegex().Replace(message, " "), " ").Trim().Trim(',', ';', ':', '-', ' ');
        var bare = rest.Trim('!', '.', '?', ' ');
        if (bare.Length == 0) return "merhaba";
        return Fold(bare) is "kim" or "kimdir" or "who" or "who is" ? "sen kimsin" : rest;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex MultiSpace();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])[Mm][Aa][Yy][Dd][iIıİ](?:['’]?(?:c[iı]ğ[iı]m|c[iı]m|ye|ya|n[iı]n))?(?![\p{L}\p{N}])\s*[,!:;]?")]
    private static partial Regex NameRegex();
}

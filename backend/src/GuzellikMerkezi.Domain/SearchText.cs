using System.Text;

namespace GuzellikMerkezi.Domain;

/// <summary>
/// Arama metni normalizasyonu. Blind index üretimi ile arama sonucunun bellekteki kesin filtresi
/// AYNI kuralları kullanmalıdır; aksi halde indeks bir kaydı aday gösterir, filtre eler ve
/// kullanıcı "arama çalışmıyor" der. Bu yüzden tek kaynak burasıdır.
/// </summary>
public static class SearchText
{
    /// <summary>
    /// Türkçe'ye duyarlı küçültme + aksan katlama: "Şeyma" → "seyma", "İNCİ" → "inci", "Gökçe" → "gokce".
    /// Kullanıcı Türkçe karakter yazmadan da (klavye/telefon alışkanlığı) kaydı bulabilsin diye.
    /// </summary>
    public static string Fold(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        var sb = new StringBuilder(value.Length);
        foreach (var ch in value)
        {
            sb.Append(ch switch
            {
                'ı' or 'I' or 'İ' or 'i' or 'î' or 'Î' => 'i',
                'ş' or 'Ş' => 's',
                'ğ' or 'Ğ' => 'g',
                'ü' or 'Ü' or 'û' or 'Û' => 'u',
                'ö' or 'Ö' => 'o',
                'ç' or 'Ç' => 'c',
                'â' or 'Â' => 'a',
                _ => char.ToLowerInvariant(ch),
            });
        }
        return sb.ToString();
    }

    /// <summary>Harf/rakam dışındaki her şeyden böler; katlanmış (normalize) kelimeleri döner.</summary>
    public static IEnumerable<string> Tokenize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) yield break;
        var sb = new StringBuilder();
        foreach (var ch in Fold(value))
        {
            if (char.IsLetterOrDigit(ch)) sb.Append(ch);
            else if (sb.Length > 0) { yield return sb.ToString(); sb.Clear(); }
        }
        if (sb.Length > 0) yield return sb.ToString();
    }

    /// <summary>
    /// Aksan/büyük-küçük duyarsız "içerir" kontrolü — <c>Contains(..., OrdinalIgnoreCase)</c> yerine.
    /// "Şeyma Öz" kaydı "seyma" aramasıyla bulunur.
    /// </summary>
    public static bool FoldedContains(string? haystack, string? needle)
    {
        if (string.IsNullOrEmpty(needle)) return true;
        if (string.IsNullOrEmpty(haystack)) return false;
        return Fold(haystack).Contains(Fold(needle), StringComparison.Ordinal);
    }

    /// <summary>
    /// Telefonu karşılaştırılabilir hale getirir: yalnızca rakamlar, son 10 hane, baştaki sıfırlar atılır.
    /// Mükerrer kontrolü, import ve blind index AYNI bu mantığı kullanır.
    /// </summary>
    public static string NormalizePhone(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits.TrimStart('0');
    }
}

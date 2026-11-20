using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Domain.Assistant;

/// <summary>
/// Kullanıcı sorusu buluttaki modele gitmeden önce kişisel bilgiyi gizler (KVKK):
/// e-posta → [e-posta]; 3+ haneli sayı (TC, telefon, tutar) → [sayı]; kurumdaki müşteri/personel adı
/// kelimeleri → [ad]. Ad eşleşmesi aksansız ve küçük harfle, kesme işaretinden önceki kökle yapılır
/// ("Ayşe'nin" → [ad]). Yaygın bir kelimeyle aynı adın gizlenmesi zararsızdır.
/// <para>Konsültasyon/sağlık verisi buraya hiç gelmez: buluta yalnız kullanıcının yazdığı soru gider.</para>
/// </summary>
public static partial class AssistantPrivacy
{
    public static string Mask(string text, IReadOnlySet<string> foldedNameWords)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var masked = EmailPattern().Replace(text, "[e-posta]");
        masked = NumberPattern().Replace(masked, "[sayı]");
        if (foldedNameWords.Count == 0) return masked;
        return WordPattern().Replace(masked, match =>
        {
            var root = match.Value.Split('\'', '’')[0];
            return root.Length >= 2 && foldedNameWords.Contains(AssistantText.Fold(root)) ? "[ad]" : match.Value;
        });
    }

    /// <summary>Sorudaki, ad olabilecek kelimelerin katlanmış kökleri (kesme işaretinden önce, 2+ harf).</summary>
    public static IReadOnlyList<string> CandidateWords(string text) =>
        WordPattern().Matches(text ?? string.Empty)
            .Select(match => AssistantText.Fold(match.Value.Split('\'', '’')[0]))
            .Where(word => word.Length >= 2)
            .Distinct(StringComparer.Ordinal)
            .ToList();

    [GeneratedRegex(@"[\w.+-]+@[\w-]+(\.[\w-]+)+")]
    private static partial Regex EmailPattern();

    // Boşluk/tire/parantezle bölünmüş telefonlar da tek parça sayılır.
    [GeneratedRegex(@"\+?\d[\d\s()\-]{1,}\d")]
    private static partial Regex NumberPattern();

    [GeneratedRegex(@"[\p{L}][\p{L}'’]*")]
    private static partial Regex WordPattern();
}

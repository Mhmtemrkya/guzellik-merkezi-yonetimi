using System.Globalization;

namespace GuzellikMerkezi.Application.Common;

/// <summary>
/// Kişi adları için kurum standardı: ad(lar) "İlk harf büyük", soyad TAMAMI BÜYÜK.
/// ("ayşe yılmaz" → "Ayşe YILMAZ"). Türkçe kültürle çevrilir (i→İ, I→ı).
/// Excel aktarımı ve müşteri/personel formları aynı kuralı kullanır.
/// </summary>
public static class PersonNameFormatter
{
    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    public static string Format(string? value)
    {
        var raw = (value ?? string.Empty).Trim();
        if (raw.Length == 0) return string.Empty;

        var parts = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0) return string.Empty;

        // Tek kelime soyad değil ad kabul edilir (Excel'de çoğunlukla eksik soyad).
        if (parts.Length == 1) return TitleCase(parts[0]);

        for (var i = 0; i < parts.Length - 1; i++) parts[i] = TitleCase(parts[i]);
        parts[^1] = parts[^1].ToUpper(Tr);
        return string.Join(' ', parts);
    }

    /// <summary>Boş/whitespace girdide null döner — opsiyonel alanlar için.</summary>
    public static string? FormatOrNull(string? value)
    {
        var formatted = Format(value);
        return formatted.Length == 0 ? null : formatted;
    }

    private static string TitleCase(string word)
    {
        // Tireli/kesme işaretli adlar parça parça büyütülür: "ayşe-nur" → "Ayşe-Nur".
        Span<char> buffer = stackalloc char[word.Length];
        var startOfWord = true;
        for (var i = 0; i < word.Length; i++)
        {
            var c = word[i];
            if (c is '-' or '\'' or '’' or '.')
            {
                buffer[i] = c;
                startOfWord = true;
                continue;
            }
            buffer[i] = startOfWord ? char.ToUpper(c, Tr) : char.ToLower(c, Tr);
            startOfWord = false;
        }
        return new string(buffer);
    }
}

using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Security;

/// <summary>
/// HMAC-SHA256 tabanlı blind index üreticisi. Anahtar, alan şifrelemesiyle aynı master key'den
/// <b>ayrı bir etiketle</b> türetilir (aynı anahtar iki farklı amaçla kullanılmaz).
/// </summary>
/// <remarks>
/// <para><b>Anahtar kaybı:</b> Master key değişirse indeks anlamsızlaşır ve arama boş döner
/// (veri kaybolmaz). Bu durumda indeks yeniden üretilmelidir — bkz. backfill.</para>
/// <para><b>Bilgi sızıntısı dengesi:</b> Kısa ön-ekler (özellikle 1 karakter) frekans analizine açıktır.
/// Sızıntı, "bu tenant'ta 'a' ile başlayan kaç kelime var" düzeyindedir; düz metin veya tam değer sızmaz.
/// Bunun karşılığında tüm tabloyu belleğe çekip çözme (eski davranış) ortadan kalkar.</para>
/// </remarks>
public sealed class HmacSearchIndexService : ISearchIndexService
{
    /// <summary>Ad/e-posta parçalarında saklanan en uzun ön-ek. Arama terimi de bu uzunluğa kırpılır.</summary>
    private const int MaxNamePrefix = 4;

    /// <summary>Telefonda anlamlı sayılan en kısa arama (daha kısası tüm tabloyu getirirdi).</summary>
    private const int MinPhonePrefix = 4;

    /// <summary>Normalize edilmiş telefon uzunluğu (TR: alan kodu + numara).</summary>
    private const int PhoneDigits = 10;

    /// <summary>Hash'in saklanan kısmı (hex karakter). 12 hex = 48 bit; çakışma pratikte yok, çakışsa da bellekte elenir.</summary>
    private const int HashHexLength = 12;

    private readonly byte[] _key;

    public HmacSearchIndexService(IConfiguration configuration)
    {
        var base64 = configuration["Encryption:MasterKeyBase64"];
        if (string.IsNullOrWhiteSpace(base64))
            throw new InvalidOperationException("Encryption:MasterKeyBase64 ayarlanmamış. Blind index anahtarı bu değerden türetilir.");

        byte[] raw;
        try { raw = Convert.FromBase64String(base64); }
        catch (FormatException) { raw = Encoding.UTF8.GetBytes(base64); }

        // Şifreleme anahtarıyla AYNI baytları kullanma — amaca özel alt anahtar türet.
        _key = HMACSHA256.HashData(raw, "beautyasist:search-index:v1"u8.ToArray());
    }

    public string? BuildCustomerIndex(string? fullName, string? phone, string? email)
    {
        var parts = new SortedSet<string>(StringComparer.Ordinal);

        foreach (var token in Tokenize(fullName)) AddTextPrefixes(parts, token);
        foreach (var token in Tokenize(email)) AddTextPrefixes(parts, token);

        var digits = NormalizePhone(phone);
        for (var len = MinPhonePrefix; len <= digits.Length; len++)
            parts.Add(Hash("p", digits[..len]));

        return parts.Count == 0 ? null : "|" + string.Join('|', parts) + "|";
    }

    public IReadOnlyList<string> BuildLookupKeys(string? term)
    {
        if (string.IsNullOrWhiteSpace(term)) return Array.Empty<string>();

        // Sadece rakamlardan oluşan terim = telefon araması. Ad alanında aranmaz.
        var digitsOnly = new string(term.Where(char.IsDigit).ToArray());
        if (digitsOnly.Length > 0 && !term.Any(char.IsLetter))
        {
            var normalized = NormalizePhone(term);
            if (normalized.Length < MinPhonePrefix) return Array.Empty<string>();
            return new[] { Key(Hash("p", normalized)) };
        }

        // Metin araması: her kelime ayrı anahtar → hepsi birden aranır (AND).
        var keys = Tokenize(term)
            .Select(t => Key(Hash("n", t[..Math.Min(t.Length, MaxNamePrefix)])))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        return keys;
    }

    public string? BuildPhoneKey(string? phone)
    {
        var digits = NormalizePhone(phone);
        return digits.Length < MinPhonePrefix ? null : Key(Hash("p", digits));
    }

    /// <summary>Kelimenin 1..MaxNamePrefix uzunluğundaki ön-eklerini indekse ekler ("mehmet" → m, me, meh, mehm).</summary>
    private void AddTextPrefixes(SortedSet<string> parts, string token)
    {
        var max = Math.Min(token.Length, MaxNamePrefix);
        for (var len = 1; len <= max; len++)
            parts.Add(Hash("n", token[..len]));
    }

    private string Hash(string domain, string value)
    {
        // Alan ayrımı: "n:" ad/e-posta, "p:" telefon. Rakamdan oluşan bir isim parçası telefonla eşleşmesin.
        var bytes = Encoding.UTF8.GetBytes(domain + ":" + value);
        var mac = HMACSHA256.HashData(_key, bytes);
        return Convert.ToHexString(mac)[..HashHexLength].ToLowerInvariant();
    }

    private static string Key(string hash) => "|" + hash + "|";

    // Normalizasyon (Türkçe katlama, tokenize, telefon) tek kaynaktan gelir: SearchText.
    // Aramanın bellekteki kesin filtresi de aynı kuralları kullanır — bkz. CustomerService.
    private static IEnumerable<string> Tokenize(string? value) => SearchText.Tokenize(value);

    private static string NormalizePhone(string? value) => SearchText.NormalizePhone(value);
}

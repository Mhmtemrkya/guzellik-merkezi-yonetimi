using System.Security.Cryptography;
using System.Text;

namespace GuzellikMerkezi.Application.Features.Connector;

/// <summary>
/// Maydanoz ↔ Asist imzası (sözleşme v1). Maydanoz tarafında birebir aynısı vardır; biri
/// değişirse ikisi birlikte değişir.
/// <code>
/// imzalanan = METOT \n YOL+SORGU \n ZAMAN(unix sn) \n NONCE \n hex(SHA256(gövde))
/// imza      = hex(HMAC-SHA256(gizli, imzalanan))   (küçük harf)
/// </code>
/// Başlıklar: <c>X-Asist-Key</c>, <c>X-Asist-Timestamp</c>, <c>X-Asist-Nonce</c>, <c>X-Asist-Signature</c>.
/// Gövde ham baytlarıyla özetlenir (JSON yeniden yazılmaz), boş gövdenin özeti boş dizinin özetidir.
/// </summary>
public static class ConnectorSignature
{
    public const string KeyHeader = "X-Asist-Key";
    public const string TimestampHeader = "X-Asist-Timestamp";
    public const string NonceHeader = "X-Asist-Nonce";
    public const string SignatureHeader = "X-Asist-Signature";

    /// <summary>İzin verilen saat farkı (iki sunucunun saati arasında).</summary>
    public static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(5);

    public static string BodyHash(ReadOnlySpan<byte> body) =>
        Convert.ToHexStringLower(SHA256.HashData(body));

    public static string Canonical(string method, string pathAndQuery, long timestamp, string nonce, string bodyHash) =>
        $"{method.ToUpperInvariant()}\n{pathAndQuery}\n{timestamp}\n{nonce}\n{bodyHash}";

    public static string Sign(string secret, string canonical) =>
        Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(canonical)));

    /// <summary>Sabit zamanlı karşılaştırma; biçimi bozuk imza da yalnız "geçersiz"dir.</summary>
    public static bool Matches(string expectedHex, string? providedHex)
    {
        if (string.IsNullOrWhiteSpace(providedHex) || providedHex.Length != expectedHex.Length) return false;
        byte[] provided;
        try { provided = Convert.FromHexString(providedHex); }
        catch (FormatException) { return false; }
        return CryptographicOperations.FixedTimeEquals(provided, Convert.FromHexString(expectedHex));
    }

    /// <summary>Nonce: 16–64 karakter, yalnız harf/rakam/-/_ (indeks ve günlük güvenliği).</summary>
    public static bool IsValidNonce(string? nonce) =>
        nonce is { Length: >= 16 and <= 64 } && nonce.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
}

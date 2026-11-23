using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// İnsan-okur kurum kodu üretir: <c>BA-ŞEHİR-SIRA</c> — <c>BA-ISTANBUL-001</c>, <c>BA-ERZURUM-002</c> (kullanıcı kararı
/// 23 Kas 2026; önceki biçim <c>BA-01</c>). Destek ekibi kurumu bu kodla bulur.
///
/// <para>
/// <b>Şehir</b> kurumun varsayılan şubesinin ilidir (kayıtta zorunlu). ASCII büyük harfle yazılır (İstanbul → ISTANBUL,
/// Şanlıurfa → SANLIURFA): kod elle yazılır ve büyük/küçük dönüşümü Türkçe İ/ı'da kültüre göre değişir. Şehri olmayan kurum
/// <see cref="UnknownCity"/> alır. <b>Sıra</b> şehir içindedir, en az 3 hane; 999'dan sonra büyür.
/// </para>
///
/// <para>
/// <b>Neden ayrı sınıf?</b> Kod birkaç yoldan atanır — platform panelinden kurum açma, self-servis kayıt ve Maydanoz onayı.
/// Tek kaynak burasıdır.
/// </para>
///
/// <para>
/// <b>Yarış koşulu:</b> "en büyüğü bul + 1" iki eşzamanlı kayıtta AYNI numarayı üretir. Son söz veritabanındaki UNIQUE
/// indekstedir; çağıran taraf ihlali yakalayıp bir sonraki numarayla tekrar dener (bkz. <see cref="IsDuplicateCodeError"/>).
/// </para>
/// </summary>
public static partial class TenantCodeAllocator
{
    /// <summary>Kod öneki. Marka değişirse burada değişir.</summary>
    public const string Prefix = "BA";

    public const string UnknownCity = "GENEL";

    public const int MaxCityLength = 20;

    /// <summary>Şehri kod parçasına çevirir: Türkçe harfler katlanır, harf dışı her şey atılır.</summary>
    public static string CityKey(string? city)
    {
        if (string.IsNullOrWhiteSpace(city)) return UnknownCity;
        var builder = new StringBuilder(city.Length);
        foreach (var raw in city.Trim())
        {
            var c = raw switch
            {
                'ç' or 'Ç' => 'C',
                'ğ' or 'Ğ' => 'G',
                'ı' or 'I' or 'i' or 'İ' or 'î' or 'Î' => 'I',
                'â' or 'Â' => 'A',
                'û' or 'Û' => 'U',
                'ö' or 'Ö' => 'O',
                'ş' or 'Ş' => 'S',
                'ü' or 'Ü' => 'U',
                _ => char.ToUpperInvariant(raw),
            };
            if (c is >= 'A' and <= 'Z') builder.Append(c);
            if (builder.Length == MaxCityLength) break;
        }

        return builder.Length == 0 ? UnknownCity : builder.ToString();
    }

    public static string CityPrefix(string? city) => $"{Prefix}-{CityKey(city)}-";

    /// <summary>Şehir ve sıradan kod (İzmir, 5 → "BA-IZMIR-005").</summary>
    public static string Format(string? city, int number) =>
        CityPrefix(city) + number.ToString("000", CultureInfo.InvariantCulture);

    /// <summary>Kod yeni (şehirli) biçimde mi? Eski <c>BA-01</c> kodları açılıştaki backfill yeniden numaralar.</summary>
    public static bool IsCityCode(string? code) => code is not null && CityCodePattern().IsMatch(code);

    /// <summary>
    /// Bu şehirde sıradaki boş kod. <paramref name="attempt"/> her yeniden denemede bir artırılır: UNIQUE ihlali alan
    /// çağıran, aynı numarayı tekrar denemek yerine bir sonrakine geçer.
    /// </summary>
    public static async Task<string> NextAsync(GuzellikDbContext db, string? city, int attempt = 0, CancellationToken ct = default)
    {
        // IgnoreQueryFilters: silinmiş/iptal edilmiş kurumların kodları da REZERVEDİR. Aksi hâlde silinen kurumun
        // numarası yeniden dağıtılır ve eski destek kayıtları yanlış kurumu gösterir.
        var prefix = CityPrefix(city);
        var codes = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Code != null && t.Code.StartsWith(prefix))
            .Select(t => t.Code!)
            .ToListAsync(ct);

        return Format(city, NextNumber(city, codes) + attempt);
    }

    /// <summary>Verilen kodlar arasında bu şehrin en büyük sırasından bir sonraki (yoksa 1).</summary>
    public static int NextNumber(string? city, IEnumerable<string?> codes)
    {
        var prefix = CityPrefix(city);
        var max = 0;
        foreach (var code in codes)
        {
            if (code is null || !code.StartsWith(prefix, StringComparison.Ordinal)) continue;
            if (int.TryParse(code.AsSpan(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n > max) max = n;
        }

        return max + 1;
    }

    /// <summary>
    /// Bu hata "kod zaten var" mı? (Yeniden deneme kararını verir.)
    /// </summary>
    /// <remarks>
    /// Sağlayıcıya özel hata tipine bağlanmak yerine mesaj taranır: MySql.Data ve Pomelo farklı
    /// istisna tipleri atıyor, ikisini de referans almak altyapı katmanını sağlayıcıya çiviler.
    /// Yanlış pozitif zararsızdır (kod bir artırılıp tekrar denenir).
    /// </remarks>
    public static bool IsDuplicateCodeError(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            var m = e.Message;
            if (m.Contains("Duplicate entry", StringComparison.OrdinalIgnoreCase)
                && m.Contains("Code", StringComparison.OrdinalIgnoreCase))
                return true;
            if (e.InnerException is null) break;
        }
        return false;
    }

    [GeneratedRegex(@"^BA-[A-Z]{1,20}-[0-9]{3,}$", RegexOptions.CultureInvariant)]
    private static partial Regex CityCodePattern();
}

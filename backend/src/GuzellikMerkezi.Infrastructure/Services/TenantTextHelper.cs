using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Kurum metin normalizasyonu + geçici parola üretimi.
///
/// <para>
/// <b>Neden ortak?</b> Aynı kurallar iki yerde gerekiyor: platform panelinden kurum açma
/// (<see cref="TenantService"/>) ve self-servis kayıt (<c>TenantSignupService</c>). İki kopya
/// olduğunda slug üretimi ayrışır ve aynı kurum adı iki farklı slug alır — kurum bir yolda
/// oluşup diğerinde "zaten var" hatası verirdi.
/// </para>
/// </summary>
public static class TenantTextHelper
{
    private static readonly Regex MultiDash = new("-{2,}", RegexOptions.Compiled);
    private static readonly Regex MultiDot = new(@"\.{2,}", RegexOptions.Compiled);

    public static string NormalizeText(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();

    public static string NormalizeEmail(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();

    /// <summary>Slug: Türkçe harfler çevrilir, yalnız a-z0-9 ve tire kalır.</summary>
    public static string NormalizeSlug(string? value)
    {
        var source = string.IsNullOrWhiteSpace(value) ? "kurum" : value.Trim();
        source = TransliterateTurkish(source).ToLowerInvariant();
        var sb = new StringBuilder(source.Length);
        foreach (var c in source)
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb.Append(c);
            else if (char.IsWhiteSpace(c) || c is '-' or '_' or '.' or '/') sb.Append('-');
        }

        var slug = MultiDash.Replace(sb.ToString(), "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "kurum" : slug;
    }

    public static string NormalizeEmailLocalPart(string? value)
    {
        var source = string.IsNullOrWhiteSpace(value) ? "yetkili" : value.Trim();
        source = TransliterateTurkish(source).ToLowerInvariant();
        var sb = new StringBuilder(source.Length);
        foreach (var c in source)
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb.Append(c);
            else if (char.IsWhiteSpace(c) || c is '-' or '_' or '.') sb.Append('.');
        }

        var local = MultiDot.Replace(sb.ToString(), ".").Trim('.');
        return string.IsNullOrWhiteSpace(local) ? "yetkili" : local;
    }

    public static string NormalizeDomain(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var domain = value.Trim().ToLowerInvariant();
        domain = domain.Replace("https://", string.Empty).Replace("http://", string.Empty);
        var slashIndex = domain.IndexOf('/');
        if (slashIndex >= 0) domain = domain[..slashIndex];
        return domain.Trim('.');
    }

    public static string TransliterateTurkish(string value)
    {
        var replaced = value
            .Replace('ı', 'i').Replace('İ', 'i')
            .Replace('ş', 's').Replace('Ş', 's')
            .Replace('ç', 'c').Replace('Ç', 'c')
            .Replace('ğ', 'g').Replace('Ğ', 'g')
            .Replace('ü', 'u').Replace('Ü', 'u')
            .Replace('ö', 'o').Replace('Ö', 'o');

        var normalized = replaced.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        }

        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    /// <summary>
    /// 10 karakterlik güvenli geçici parola (en az 1 büyük, 1 küçük, 1 rakam, 1 özel).
    /// Karışıklık yaratan karakterler (O, I, Q, l, 0, 1) çıkarılmıştır — parola telefonda
    /// okunup elle yazılıyor.
    /// </summary>
    public static string GenerateTempPassword()
    {
        const string upper = "ABCDEFGHJKLMNPRSTUVYZ";
        const string lower = "abcdefghijkmnpqrstuvwxyz";
        const string digits = "23456789";
        const string special = "@#$!*";

        var chars = new char[10];
        chars[0] = upper[RandomNumberGenerator.GetInt32(upper.Length)];
        chars[1] = lower[RandomNumberGenerator.GetInt32(lower.Length)];
        chars[2] = digits[RandomNumberGenerator.GetInt32(digits.Length)];
        chars[3] = special[RandomNumberGenerator.GetInt32(special.Length)];
        var all = upper + lower + digits;
        for (var i = 4; i < chars.Length; i++)
        {
            chars[i] = all[RandomNumberGenerator.GetInt32(all.Length)];
        }
        for (var i = chars.Length - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars);
    }

    /// <summary>E-postayı maskeler: ayse@ornek.com → ay••@ornek.com (yazım hatası fark edilsin).</summary>
    public static string MaskEmail(string? email)
    {
        var value = NormalizeEmail(email);
        var at = value.IndexOf('@');
        if (at <= 0) return value;
        var local = value[..at];
        var keep = local.Length <= 2 ? 1 : 2;
        return $"{local[..keep]}{new string('•', Math.Max(2, local.Length - keep))}{value[at..]}";
    }
}

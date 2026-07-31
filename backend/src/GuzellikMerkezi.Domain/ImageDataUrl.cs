namespace GuzellikMerkezi.Domain;

/// <summary>
/// GÖRSEL DATA URL DOĞRULAMASI (tedavi fotoğrafı, dijital imza).
///
/// <para>
/// Bu alanlar base64 data URL olarak gelip doğrudan DB'ye yazılıyor ve <c>&lt;img src&gt;</c> olarak
/// render ediliyordu; tek kontrol "boş değil" idi. Sonuçları: harici <c>http(s)://</c> URL'i
/// kaydedilerek görüntüleyenin IP/referrer'ı üçüncü tarafa sızdırılabiliyor, <c>data:text/html</c>
/// veya SVG gibi güvenilmeyen içerik taşınabiliyor, framework limitinin altındaki büyük base64
/// değerler DB'yi ve yanıtları şişirebiliyordu.
/// </para>
///
/// <para>
/// Kural: yalnız PNG/JPEG/WEBP data URL'i, geçerli base64, sihirli baytları beyan edilen tiple
/// UYUŞAN ve boyut sınırını aşmayan içerik kabul edilir.
/// </para>
/// </summary>
public static class ImageDataUrl
{
    /// <summary>İmza görseli — küçük bir çizimdir; 512 KB fazlasıyla yeter.</summary>
    public const int MaxSignatureBytes = 512 * 1024;

    /// <summary>Tedavi fotoğrafı — telefon kamerası çıktısı için makul üst sınır.</summary>
    public const int MaxPhotoBytes = 4 * 1024 * 1024;

    private static readonly (string Prefix, byte[] Magic)[] Allowed =
    [
        ("data:image/png;base64,", [0x89, 0x50, 0x4E, 0x47]),          // \x89PNG
        ("data:image/jpeg;base64,", [0xFF, 0xD8, 0xFF]),                // JPEG SOI
        ("data:image/jpg;base64,", [0xFF, 0xD8, 0xFF]),
        ("data:image/webp;base64,", [0x52, 0x49, 0x46, 0x46]),          // RIFF
    ];

    /// <summary>
    /// Değeri doğrular. Geçerliyse null, değilse kullanıcıya gösterilecek hata mesajı döner.
    /// </summary>
    /// <param name="value">Beklenen biçim: <c>data:image/&lt;tip&gt;;base64,&lt;veri&gt;</c>.</param>
    /// <param name="maxBytes">Çözülmüş (decoded) içerik için üst sınır.</param>
    /// <param name="fieldLabel">Hata mesajında geçecek alan adı.</param>
    public static string? Validate(string? value, int maxBytes, string fieldLabel)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"{fieldLabel} zorunlu.";

        var match = Allowed.FirstOrDefault(a => value.StartsWith(a.Prefix, StringComparison.OrdinalIgnoreCase));
        if (match.Prefix is null)
            return $"{fieldLabel} yalnız PNG, JPEG veya WEBP görsel olabilir (harici bağlantı kabul edilmez).";

        var payload = value[match.Prefix.Length..];
        // Base64 uzunluğundan çözülmüş boyutu tahmin et: kod çözmeden önce büyük içeriği reddet.
        var approxBytes = (long)(payload.Length * 3L / 4L);
        if (approxBytes > maxBytes)
            return $"{fieldLabel} çok büyük (en fazla {maxBytes / 1024} KB).";

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(payload);
        }
        catch (FormatException)
        {
            return $"{fieldLabel} okunamadı (geçersiz base64).";
        }

        if (bytes.Length > maxBytes)
            return $"{fieldLabel} çok büyük (en fazla {maxBytes / 1024} KB).";

        // Sihirli bayt: uzantı/MIME beyanı içeriğe uymuyorsa reddet.
        if (bytes.Length < match.Magic.Length || !bytes.Take(match.Magic.Length).SequenceEqual(match.Magic))
            return $"{fieldLabel} bozuk ya da belirtilen türle uyuşmuyor.";

        return null;
    }
}

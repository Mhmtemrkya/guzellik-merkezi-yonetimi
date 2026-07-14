namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Müşteri telefonunu personel rolüne yalnızca <b>son 4 hane</b> görünecek şekilde maskeler
/// (müşteri bilgisini koruma). Ham numara API yanıtından hiç çıkmaz; kurum/şube yöneticisi tam görür.
/// Maskeleme okuma (DTO) tarafında yapılır; yazma tarafında <see cref="IsMasked"/> ile korunur.
/// </summary>
public static class PhoneMask
{
    /// <summary>Maskeli telefonda kullanılan işaret. Bir güncelleme isteğinde gelirse o değer yok sayılır.</summary>
    public const char MaskChar = '•';

    /// <summary>Tüm rakamları maskeler, yalnızca son 4 haneyi açık bırakır (ör. 05551234567 → •••••••4567).</summary>
    public static string Mask(string? phone)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return string.Empty;
        if (digits.Length <= 4) return new string(MaskChar, digits.Length);
        return $"{new string(MaskChar, digits.Length - 4)}{digits[^4..]}";
    }

    /// <summary>Değer maskeli mi (kalıcılaştırılmamalı, mevcut numara korunmalı)?</summary>
    public static bool IsMasked(string? phone) => !string.IsNullOrEmpty(phone) && phone.Contains(MaskChar);

    /// <summary>Yalnızca rakamlar (boşluk/parantez/+ temizlenir).</summary>
    public static string DigitsOnly(string? phone) =>
        new((phone ?? string.Empty).Where(char.IsDigit).ToArray());

    /// <summary>
    /// Online giriş eşleştirmesi için kanonik anahtar: ham numaranın rakamları,
    /// ülke kodu (90) ve baştaki 0 normalize edilerek son 10 hane. Boşluklu kayıtlar
    /// ("0555 123 45 67") ile kullanıcı girişi ("05551234567") aynı anahtara iner.
    /// </summary>
    public static string LoginKey(string? phone)
    {
        var digits = DigitsOnly(phone);
        if (digits.Length > 10 && digits.StartsWith("90")) digits = digits[2..];
        if (digits.Length > 10 && digits.StartsWith("0")) digits = digits[1..];
        return digits.Length >= 10 ? digits[^10..] : digits;
    }
}

/// <summary>
/// Müşteri e-postasını personel rolüne maskeler (telefon maskesiyle aynı ilke):
/// yerel kısmın yalnızca ilk 2 karakteri açık kalır, alan adı görünür
/// (ör. ayseyilmaz@gmail.com → ay••••••••@gmail.com). Yazma tarafında
/// <see cref="IsMasked"/> ile maskeli değerin kalıcılaşması engellenir.
/// </summary>
public static class EmailMask
{
    public const char MaskChar = PhoneMask.MaskChar;

    public static string? Mask(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return email;
        var at = email.IndexOf('@');
        if (at <= 0) return new string(MaskChar, email.Length);
        var local = email[..at];
        var domain = email[at..];
        var visible = Math.Min(2, local.Length - 1);
        if (visible < 1) return $"{new string(MaskChar, local.Length)}{domain}";
        return $"{local[..visible]}{new string(MaskChar, local.Length - visible)}{domain}";
    }

    /// <summary>Değer maskeli mi (kalıcılaştırılmamalı, mevcut e-posta korunmalı)?</summary>
    public static bool IsMasked(string? email) => !string.IsNullOrEmpty(email) && email.Contains(MaskChar);
}

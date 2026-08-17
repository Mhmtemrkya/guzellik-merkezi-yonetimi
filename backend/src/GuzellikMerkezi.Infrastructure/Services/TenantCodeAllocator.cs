using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// İnsan-okur kurum kodu üretir: <c>BA-01</c>, <c>BA-02</c>, … Destek ekibi kurumu bu kodla bulur.
///
/// <para>
/// <b>Neden ayrı sınıf?</b> Kod iki yoldan atanır — platform panelinden kurum açma ve self-servis
/// kayıt. İki yerde ayrı hesaplanırsa numaralar çakışır ya da atlar. Tek kaynak burasıdır.
/// </para>
///
/// <para>
/// <b>Yarış koşulu:</b> "en büyüğü bul + 1" iki eşzamanlı kayıtta AYNI numarayı üretir. Son söz
/// veritabanındaki UNIQUE indekstedir; çağıran taraf ihlali yakalayıp bir sonraki numarayla tekrar
/// dener (bkz. <see cref="IsDuplicateCodeError"/>). Sayaç tablosu ya da tablo kilidi eklemek,
/// günde birkaç kayıt için gereksiz karmaşıklık olurdu.
/// </para>
/// </summary>
public static class TenantCodeAllocator
{
    /// <summary>Kod öneki. Marka değişirse burada değişir — kodlar geçmişe dönük DEĞİŞMEZ.</summary>
    public const string Prefix = "BA";

    /// <summary>En az iki hane: BA-01. Numara 99'u geçince kendiliğinden BA-100 olur.</summary>
    private const int MinDigits = 2;

    /// <summary>
    /// Sıradaki boş kodu döndürür. <paramref name="attempt"/> her yeniden denemede bir artırılır:
    /// UNIQUE ihlali alan çağıran, aynı numarayı tekrar denemek yerine bir sonrakine geçer.
    /// </summary>
    public static async Task<string> NextAsync(GuzellikDbContext db, int attempt = 0, CancellationToken ct = default)
    {
        // IgnoreQueryFilters: silinmiş/iptal edilmiş kurumların kodları da REZERVEDİR. Aksi hâlde
        // silinen BA-07'nin numarası yeniden dağıtılır ve eski destek kayıtları yanlış kurumu gösterir.
        var codes = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Code != null)
            .Select(t => t.Code!)
            .ToListAsync(ct);

        var max = 0;
        foreach (var code in codes)
        {
            var n = ParseNumber(code);
            if (n > max) max = n;
        }

        return Format(max + 1 + attempt);
    }

    /// <summary>Numarayı koda çevirir (5 → "BA-05").</summary>
    public static string Format(int number) => $"{Prefix}-{number.ToString().PadLeft(MinDigits, '0')}";

    /// <summary>
    /// Koddaki numarayı okur; tanınmayan biçimde 0 döner.
    /// </summary>
    /// <remarks>
    /// Önek KONTROL EDİLMEZ: elle "GM-04" gibi bir kod girilmiş olsa bile numara rezerve sayılmalı,
    /// aksi hâlde yeni kayıt aynı numarayı alıp UNIQUE ihlaline düşerdi.
    /// </remarks>
    public static int ParseNumber(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return 0;
        var dash = code.LastIndexOf('-');
        var tail = dash >= 0 ? code[(dash + 1)..] : code;
        return int.TryParse(tail.Trim(), out var n) ? n : 0;
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
}

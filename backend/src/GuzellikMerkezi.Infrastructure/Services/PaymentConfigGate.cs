using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// ÖDEME YAPILANDIRMASININ TUTARLILIK KAPISI — hazırlık (readiness) yoklamasının para tarafı.
///
/// <para>
/// Ödeme AÇIKKEN eksik/çelişkili ayar hiçbir yerde yakalanmıyordu: örnek yük dengeleyiciden trafik
/// alıyor, kusur ancak ilk gerçek tahsilat denemesinde — yani MÜŞTERİ ÖDERKEN — ortaya çıkıyordu.
/// Bu kapı hatayı deploy anına çeker.
/// </para>
///
/// <para>
/// KAPALI ÖDEME SORUN DEĞİLDİR. Üretim <c>PaymentsEnabled=0</c> ile çalışıyor ve bu GEÇERLİ bir
/// yapılandırmadır; kapalı ödeme yüzünden trafik kesilmez. "Sıkı kapı" yazarken en kolay yapılan
/// hata, doğru yapılandırmayı da reddetmektir.
/// </para>
///
/// <para>
/// Uç noktada değil BURADA durur: aynı kural iki yere yazılırsa saparlar (bu depoda kanıtlanmış
/// bir hata sınıfı). Uç ve testler AYNI fonksiyonu çağırır.
/// </para>
/// </summary>
public static class PaymentConfigGate
{
    /// <summary>
    /// Sorun varsa insan okuyabilir gerekçe, yoksa <c>null</c>.
    /// </summary>
    /// <param name="isProduction">
    /// Üretimde bazı yapılandırmalar (simülasyon sağlayıcısı, düz HTTP) reddedilir; geliştirici
    /// ortamında aynısı MEŞRUDUR ve engellenmemelidir.
    /// </param>
    public static async Task<string?> DescribeAsync(
        GuzellikDbContext db, bool isProduction, CancellationToken ct)
    {
        Domain.Entities.PlatformIntegrationSettings? settings;
        try
        {
            settings = await db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        }
        catch
        {
            // Ayar okunamıyorsa şema/bağlantı kontrolleri zaten konuşacak; burada "ödeme bozuk"
            // demek yanıltıcı olurdu.
            return null;
        }

        // Ayar satırı yok = yeni kurulum; ödeme kapalı sayılır ve trafiğe alınabilir.
        if (settings is null || !settings.PaymentsEnabled) return null;

        // Sağlayıcı anahtarları eksikse gerçek çekim İMKÂNSIZ; "ödeme açık" yalan söylüyor demektir.
        if (!settings.PaymentsConfigured)
            return $"Ödeme açık ama '{settings.PaymentProvider}' sağlayıcısının anahtarları eksik.";

        // ÜRETİMDE SİMÜLASYON = PARA ÇEKİLMEDEN ABONELİK: sessizce "başarılı" dönen sağlayıcı
        // abonelikleri bedavaya açardı.
        if (isProduction
            && string.Equals(settings.PaymentProvider, "Simulation", StringComparison.OrdinalIgnoreCase))
        {
            return "Üretimde ödeme açık ama sağlayıcı 'Simulation' — tahsilat yapılmadan abonelik açılır.";
        }

        // Dönüş adresi olmadan checkout başlatılamaz (servis zaten reddeder); bunu ilk müşteri
        // denemesinden ÖNCE söyleyelim.
        if (string.IsNullOrWhiteSpace(settings.PaymentsReturnUrl))
            return "Ödeme açık ama dönüş adresi (PaymentsReturnUrl) tanımlı değil.";

        if (!string.IsNullOrWhiteSpace(settings.IyzicoBaseUrl))
        {
            if (!Uri.TryCreate(settings.IyzicoBaseUrl, UriKind.Absolute, out var baseUri))
                return $"Ödeme sağlayıcı adresi geçersiz: '{settings.IyzicoBaseUrl}'.";

            // Kart verisi taşımasak da işlem anahtarı/tutar bu adrese gider; üretimde düz HTTP olmaz.
            if (isProduction
                && !string.Equals(baseUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return "Üretimde ödeme sağlayıcı adresi HTTPS olmalı.";
            }
        }

        return null;
    }
}

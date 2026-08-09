using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// ÖDEME YAPILANDIRMASININ TUTARLILIK KAPISI — hazırlık (readiness) yoklamasının para tarafı.
///
/// <para>
/// KURALI BURASI YAZMAZ, <see cref="IPaymentGatewayResolver"/>'A SORAR. İlk sürümde kapı kendi
/// kural setini taşıyordu ve o set çözücününkinin ZAYIF bir kopyasıydı: tanınmayan bir sağlayıcı
/// adı (ör. "TypoPay") anahtarları varsa geçiyor, üretimde SANDBOX adresi HTTPS olduğu için
/// geçiyordu. Yani readiness "hazır" derken gerçek checkout ya hata veriyor ya da sandbox'tan
/// SAHTE PARA başarısı üretiyordu. Aynı kural iki yere yazılırsa saparlar — bu depoda kanıtlanmış
/// bir hata sınıfı; çözüm kuralı çoğaltmak değil, TEK KAYNAĞA sormaktır.
/// </para>
///
/// <para>
/// KAPALI ÖDEME SORUN DEĞİLDİR: üretim <c>PaymentsEnabled=0</c> ile çalışıyor ve bu GEÇERLİ bir
/// yapılandırmadır; kapalı ödeme yüzünden trafik kesilmez.
/// </para>
/// </summary>
public static class PaymentConfigGate
{
    /// <summary>
    /// Sorun varsa LOG'a yazılacak ayrıntılı gerekçe, yoksa <c>null</c>.
    ///
    /// <para>
    /// DÖNEN METİN İSTEMCİYE VERİLMEZ. Sağlayıcı adı, anahtarların eksikliği ve sağlayıcı adresi
    /// keşif bilgisidir; <c>/health/ready</c> kimlik doğrulaması istemeyen bir uçtur ve bu ayrıntı
    /// oradan sızarsa saldırgana ödeme entegrasyonunun yarım olduğunu ve hangi sağlayıcıyı
    /// hedefleyeceğini söyler. Uç genel bir mesaj döndürür; ayrıntı yalnız sunucu günlüğüne gider.
    /// </para>
    /// </summary>
    public static async Task<string?> DescribeAsync(
        GuzellikDbContext db, IPaymentGatewayResolver resolver, CancellationToken ct)
    {
        bool paymentsEnabled;
        try
        {
            paymentsEnabled = await db.PlatformIntegrationSettings.AsNoTracking()
                .Select(x => x.PaymentsEnabled)
                .FirstOrDefaultAsync(ct);
        }
        catch
        {
            // Ayar okunamıyorsa şema/bağlantı kontrolleri zaten konuşacak; burada "ödeme bozuk"
            // demek yanıltıcı olurdu.
            return null;
        }

        // Ayar satırı yok ya da ödeme kapalı → yeni kurulum / üretim yapılandırması. Kapı geçer.
        if (!paymentsEnabled) return null;

        // ÇEKİRDEK: gerçek checkout'un kullandığı çözücünün TA KENDİSİ çağrılır. Çözücü neyi
        // reddediyorsa readiness de onu reddeder — ikisi tanım gereği aynı fikirdedir.
        var resolved = await resolver.ResolveAsync(ct);
        return resolved.IsFailure
            ? $"Ödeme açık ama sağlayıcı çözümlenemedi: {resolved.Error.Message}"
            : null;
    }
}

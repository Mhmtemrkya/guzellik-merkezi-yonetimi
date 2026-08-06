using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Infrastructure.Background;

/// <summary>Kalıcı iş tipleri — enqueue eden ve handler aynı sabiti kullanır.</summary>
public static class DurableJobTypes
{
    public const string WaitlistOffer = "whatsapp.waitlist-offer";
    public const string WaitlistActivated = "whatsapp.waitlist-activated";
    public const string PushSend = "push.send";
    public const string RatingLink = "whatsapp.rating-link";
    public const string KvkkConsent = "whatsapp.kvkk-consent";
    public const string SubscriptionRenewal = "billing.subscription-renewal";
}

/// <summary>
/// GÖNDERİLEMEYEN MESAJ BAŞARILI İŞ DEĞİLDİR.
///
/// <para>
/// Handler'lar gönderim yollarını çağırıp sonuca hiç bakmıyordu; o yollar da her hatayı yutuyordu.
/// Sonuç: sağlayıcının reddettiği ya da hiç gönderilemeyen KVKK isteği, bekleme teklifi ve
/// değerlendirme linki iş kuyruğunda "başarılı" damgalanıp SESSİZCE kayboluyordu — ne yeniden
/// deneme, ne dead-letter, ne de görünür bir iz kalıyordu. Artık gerçek başarısızlık istisnaya
/// çevrilir: kuyruk yeniden dener, denemeler tükenirse iş dead-letter'a düşer ve sistem
/// sayfasında görünür. "Bilerek atlandı" (telefon yok, zaten onaylı, kota kapalı) başarıdır.
/// </para>
/// </summary>
internal static class DurableJobDispatchGuard
{
    public static void EnsureDelivered(WhatsAppDispatchReport report, string jobType, Guid entityId)
    {
        if (!report.ShouldRetry) return;
        throw new InvalidOperationException(
            $"WhatsApp gönderimi başarısız ({jobType}, {entityId}): {report.Error ?? "sebep bildirilmedi"}");
    }
}

public sealed record WaitlistOfferJob(Guid TenantId, Guid WaitlistId);
public sealed record WaitlistActivatedJob(Guid TenantId, Guid AppointmentId);
public sealed record PushSendJob(List<PushMessage> Messages);
public sealed record RatingLinkJob(Guid TenantId, Guid AppointmentId);
public sealed record KvkkConsentJob(Guid TenantId, Guid CustomerId);
public sealed record SubscriptionRenewalJob(Guid TenantId);

/// <summary>
/// Abonelik yenileme tahsilatı — saklı karttan çeker, başarılıysa dönemi uzatıp fatura üretir.
///
/// <para>
/// KUYRUKTAN ÇALIŞMASININ SEBEBİ: dış bir ödeme sağlayıcısına gidilir; yavaşlık ya da kesinti
/// tarayıcı turunu kilitlememeli, hata durumunda iş kaybolmamalı. Kuyruk yeniden dener.
/// </para>
/// <para>
/// TEKRAR OYNATMA GÜVENLİ: <c>ChargeRenewalAsync</c> dönem başına tek başarılı tahsilat kuralını
/// kendi içinde uygular (işlem anahtarı benzersiz indekslidir), bu yüzden aynı iş iki kez
/// çalışsa bile ikinci çekim oluşmaz.
/// </para>
/// </summary>
public sealed class SubscriptionRenewalJobHandler : IDurableJobHandler
{
    private readonly Application.Features.Billing.IBillingService _billing;
    public SubscriptionRenewalJobHandler(Application.Features.Billing.IBillingService billing) => _billing = billing;
    public string JobType => DurableJobTypes.SubscriptionRenewal;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<SubscriptionRenewalJob>(payloadJson)
                  ?? throw new InvalidOperationException("SubscriptionRenewal payload çözülemedi.");
        var result = await _billing.ChargeRenewalAsync(job.TenantId, ct);

        // Başarısız TAHSİLAT bir iş hatası değildir (kart limiti, kapalı kart …): kuyruk bunu
        // yeniden denememeli — tekrar deneme takvimi tarayıcıdadır (24 saat aralıklı, 3 deneme).
        // Yalnız altyapı hatası (Result.Failure) istisnaya çevrilir ki kuyruk yeniden denesin.
        if (result.IsFailure) throw new InvalidOperationException(result.Error.Message);
    }
}

/// <summary>
/// KVKK açık rıza isteğini WhatsApp'tan gönderir. İstek yolundan ayrıldığı için müşteri
/// kaydetme işlemi WhatsApp yavaşlığından/kesintisinden etkilenmez; gönderim başarısız olursa
/// kuyruk otomatik yeniden dener.
/// </summary>
public sealed class KvkkConsentJobHandler : IDurableJobHandler
{
    private readonly IWhatsAppService _whatsApp;
    public KvkkConsentJobHandler(IWhatsAppService whatsApp) => _whatsApp = whatsApp;
    public string JobType => DurableJobTypes.KvkkConsent;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<KvkkConsentJob>(payloadJson)
                  ?? throw new InvalidOperationException("KvkkConsent payload çözülemedi.");
        var report = await _whatsApp.SendKvkkConsentRequestAsync(job.TenantId, job.CustomerId, ct);
        DurableJobDispatchGuard.EnsureDelivered(report, JobType, job.CustomerId);
    }
}

public sealed class WaitlistOfferJobHandler : IDurableJobHandler
{
    private readonly IWhatsAppService _whatsApp;
    public WaitlistOfferJobHandler(IWhatsAppService whatsApp) => _whatsApp = whatsApp;
    public string JobType => DurableJobTypes.WaitlistOffer;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<WaitlistOfferJob>(payloadJson)
                  ?? throw new InvalidOperationException("WaitlistOffer payload çözülemedi.");
        var report = await _whatsApp.SendWaitlistOfferAsync(job.TenantId, job.WaitlistId, ct);
        DurableJobDispatchGuard.EnsureDelivered(report, JobType, job.WaitlistId);
    }
}

public sealed class WaitlistActivatedJobHandler : IDurableJobHandler
{
    private readonly IWhatsAppService _whatsApp;
    public WaitlistActivatedJobHandler(IWhatsAppService whatsApp) => _whatsApp = whatsApp;
    public string JobType => DurableJobTypes.WaitlistActivated;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<WaitlistActivatedJob>(payloadJson)
                  ?? throw new InvalidOperationException("WaitlistActivated payload çözülemedi.");
        var report = await _whatsApp.SendWaitlistActivatedAsync(job.TenantId, job.AppointmentId, ct);
        DurableJobDispatchGuard.EnsureDelivered(report, JobType, job.AppointmentId);
    }
}

/// <summary>
/// Randevu tamamlanınca: 24 saat geçerli değerlendirme linki üretir (idempotent) ve müşteriye
/// WhatsApp'tan gönderir. Link hem personel hem salon yıldızını kapsar. Zaten puanlanmışsa sessizce biter.
/// </summary>
public sealed class RatingLinkJobHandler : IDurableJobHandler
{
    private readonly Application.Features.Ratings.IRatingService _ratings;
    private readonly IWhatsAppService _whatsApp;

    public RatingLinkJobHandler(Application.Features.Ratings.IRatingService ratings, IWhatsAppService whatsApp)
    {
        _ratings = ratings;
        _whatsApp = whatsApp;
    }

    public string JobType => DurableJobTypes.RatingLink;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<RatingLinkJob>(payloadJson)
                  ?? throw new InvalidOperationException("RatingLink payload çözülemedi.");
        var issued = await _ratings.IssueAsync(job.TenantId, job.AppointmentId,
            Domain.Entities.AppointmentRating.WhatsAppLinkLifetimeMinutes, ct);
        // Conflict = zaten puanlanmış → gönderilecek bir şey yok; diğer hatalarda da sessizce bit (best-effort).
        if (issued.IsFailure) return;
        var report = await _whatsApp.SendRatingLinkAsync(job.TenantId, job.AppointmentId, issued.Value!.Token, ct);
        DurableJobDispatchGuard.EnsureDelivered(report, JobType, job.AppointmentId);
    }
}

public sealed class PushSendJobHandler : IDurableJobHandler
{
    private readonly IPushSender _push;
    public PushSendJobHandler(IPushSender push) => _push = push;
    public string JobType => DurableJobTypes.PushSend;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<PushSendJob>(payloadJson)
                  ?? throw new InvalidOperationException("PushSend payload çözülemedi.");
        if (job.Messages.Count == 0) return;

        // HİÇ TESLİM EDİLEMEYEN PARTİ BAŞARILI DEĞİLDİR. Gönderilen sayısı yok sayılıyordu:
        // FCM erişilemez olduğunda ya da erişim jetonu alınamadığında iş "başarılı" kapanıyor,
        // bildirimler yeniden denenmeden kayboluyordu. Kısmi başarıda tekrar denemek, teslim
        // edilmiş cihazlara MÜKERRER bildirim gönderirdi; bu yüzden yalnız TAMAMEN başarısız
        // parti istisnaya çevrilir.
        var sent = await _push.SendAsync(job.Messages, ct);
        if (sent == 0)
            throw new InvalidOperationException($"Push gönderimi başarısız: {job.Messages.Count} mesajın hiçbiri teslim edilemedi.");
    }
}

namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Kalıcı (DB-outbox) arka plan iş kuyruğu. Bellek içi <see cref="IBackgroundTaskQueue"/>'nun
/// aksine iş veritabanına yazılır: restart/deploy'da kaybolmaz, başarısızlıkta otomatik
/// yeniden denenir, hakkı bitince Failed (dead-letter) olarak izlenebilir kalır.
///
/// Kayıp toleransı olmayan işler (WhatsApp/SMS/push gönderimi, fatura bildirimi) BUNU kullanır;
/// bellek içi kuyruk yalnızca kaybı önemsiz, ultra-hafif işler için kalır.
/// Çok-sunucu geleceğinde bu arayüzün arkasına RabbitMQ konur; çağıranlar değişmez.
/// </summary>
public interface IDurableJobQueue
{
    /// <summary>İşi kalıcı kuyruğa yazar. Payload JSON'a serileştirilir; handler aynı tiple çözer.</summary>
    Task EnqueueAsync(string jobType, object payload, CancellationToken ct = default);

    /// <summary>
    /// Deneme hakkı belirtilmiş iş. Varsayılan (5 deneme ≈ 7,5 dk) kısa kalan, dış sistemin uzun kesintisine
    /// dayanması gereken işler içindir (ör. Chatwoot iletimi). Varsayılan gövde hakkı yok sayar —
    /// test kuyrukları bunu uygulamak zorunda değildir; gerçek kuyruk uygular.
    /// </summary>
    Task EnqueueAsync(string jobType, object payload, int maxAttempts, CancellationToken ct = default)
        => EnqueueAsync(jobType, payload, ct);
}

/// <summary>Belirli bir iş tipini yürüten handler; DI'a kaydedilir, worker tip adına göre eşler.</summary>
public interface IDurableJobHandler
{
    /// <summary>Eşleştiği iş tipi (ör. "whatsapp.waitlist-offer").</summary>
    string JobType { get; }

    Task ExecuteAsync(string payloadJson, CancellationToken ct);
}

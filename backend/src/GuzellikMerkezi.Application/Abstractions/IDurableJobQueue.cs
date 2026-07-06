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
}

/// <summary>Belirli bir iş tipini yürüten handler; DI'a kaydedilir, worker tip adına göre eşler.</summary>
public interface IDurableJobHandler
{
    /// <summary>Eşleştiği iş tipi (ör. "whatsapp.waitlist-offer").</summary>
    string JobType { get; }

    Task ExecuteAsync(string payloadJson, CancellationToken ct);
}

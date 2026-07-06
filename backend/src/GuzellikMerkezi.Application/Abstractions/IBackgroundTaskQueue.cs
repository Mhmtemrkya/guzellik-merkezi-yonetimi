namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Hafif, süreç-içi arka plan iş kuyruğu. Endpoint/servisler yavaş dış işleri (WhatsApp/SMS/FCM gönderimi)
/// buraya bırakır; <c>QueuedHostedService</c> bunları request-path DIŞINDA, KENDİ DI scope'unda yürütür →
/// kullanıcı yanıtı beklemez, üçüncü-parti yavaşlığına dayanıklı olur.
///
/// İş öğesi kendi bağımlılıklarını verilen <see cref="IServiceProvider"/>'dan çözer (request scope'una
/// tutunmaz — o dispose olur). Ek altyapı yok: System.Threading.Channels tabanlı.
/// </summary>
public interface IBackgroundTaskQueue
{
    /// <summary>Bir işi kuyruğa bırakır. Çağıranı bloke etmez.</summary>
    void Enqueue(Func<IServiceProvider, CancellationToken, Task> workItem);

    /// <summary>Consumer için: sıradaki işi bekleyerek alır.</summary>
    ValueTask<Func<IServiceProvider, CancellationToken, Task>> DequeueAsync(CancellationToken cancellationToken);

    /// <summary>Bekleyen iş sayısı (tanı/log için).</summary>
    int PendingCount { get; }
}

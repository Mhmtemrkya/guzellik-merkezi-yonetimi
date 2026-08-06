using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Kalıcı iş kuyruğu tüketicisi: background_jobs tablosunu poll eder, sırası gelen işleri
/// kilitleyip tip adına kayıtlı handler ile yürütür. Başarısızlıkta üstel backoff ile yeniden
/// dener (BackgroundJob.MarkFailedAttempt), hakkı bitince Failed (dead-letter) bırakır.
/// Restart/deploy işleri kaybetmez; süresi dolan kilitler (ölen worker) yeniden alınır.
/// </summary>
public sealed class DurableJobHostedService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(5);
    private const int BatchSize = 10;

    /// <summary>Bir temizlik turunda en fazla parti — birikmiş tablo tek seferde kilitlenmesin.</summary>
    private const int CleanupMaxBatches = 20;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DurableJobHostedService> _logger;
    private DateTime _lastCleanupUtc = DateTime.MinValue;

    public DurableJobHostedService(IServiceScopeFactory scopeFactory, ILogger<DurableJobHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await ProcessBatchAsync(stoppingToken);
                // İş yokken bekle; iş varken hemen devam et (kuyruk boşalana kadar).
                if (processed == 0) await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Kalıcı iş kuyruğu döngüsü hata verdi; devam ediliyor.");
                try { await Task.Delay(PollInterval, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task<int> ProcessBatchAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();

        var now = DateTime.UtcNow;
        var jobs = await db.BackgroundJobs
            .Where(j => (j.Status == "Pending" && j.NextAttemptUtc <= now)
                        || (j.Status == "Processing" && j.LockedUntilUtc != null && j.LockedUntilUtc < now))
            .OrderBy(j => j.NextAttemptUtc)
            .Take(BatchSize)
            .ToListAsync(ct);

        if (jobs.Count == 0)
        {
            await CleanupIfDueAsync(db, ct);
            return 0;
        }

        var handlers = scope.ServiceProvider.GetServices<IDurableJobHandler>()
            .ToDictionary(h => h.JobType, StringComparer.OrdinalIgnoreCase);

        var claimed = 0;
        foreach (var job in jobs)
        {
            // ATOMİK SAHİPLENME (bkz. DurableJobClaim). Eskiden okunan satırlar toplu Processing
            // yapılıyordu: iki worker aynı Pending satırı okuyup İKİSİ de handler'ı çalıştırıyordu
            // ve handler'lar dış dünyaya yazdığı için müşteriye çift WhatsApp/push gidiyordu.
            var token = Guid.NewGuid().ToString("N");
            if (!await DurableJobClaim.TryClaimAsync(db, job, token, LockDuration, ct)) continue;
            claimed++;

            await RunClaimedJobAsync(db, job, token, handlers, ct);
        }
        return claimed;
    }

    /// <summary>
    /// Sahiplenilmiş işi yürütür ve sonucu JETONA KOŞULLU yazar. Ortak gövde: RabbitMQ yolu da
    /// aynı protokolü kullanır, iki yol ayrışamaz.
    /// </summary>
    private async Task RunClaimedJobAsync(
        GuzellikDbContext db, BackgroundJob job, string token,
        IReadOnlyDictionary<string, IDurableJobHandler> handlers, CancellationToken ct)
    {
        // KİLİT KALP ATIŞI (ortak yardımcı — RabbitMQ yolu da aynısını kullanır, ayrışamazlar).
        // Kendi scope'unda çalışır: DbContext iş parçacığı güvenli değildir.
        var lease = DurableJobClaim.KeepAlive(_scopeFactory, job.Id, token, LockDuration);

        // KİRA KAYBI İŞİ DURDURUR. Kalp atışı "sahiplenmeyi kaybettik" dediğinde handler eskiden
        // çalışmaya devam ediyordu; işi bu arada başka bir worker almış oluyor ve dış etki
        // (WhatsApp mesajı, push bildirimi) İKİ KEZ üretiliyordu. Jeton bağlanır: kayıp anında
        // handler iptal edilir.
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lease.Lost);

        bool succeeded;
        string? error = null;
        try
        {
            if (!handlers.TryGetValue(job.Type, out var handler))
                throw new InvalidOperationException($"'{job.Type}' için kayıtlı handler yok.");
            await handler.ExecuteAsync(job.PayloadJson, linked.Token);
            succeeded = true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Kapanış: kilit süresi dolunca iş yeniden alınacak; durumu değiştirme.
            await lease.DisposeAsync();
            throw;
        }
        catch (Exception ex)
        {
            succeeded = false;
            error = ex.Message;
            if (!lease.IsLost)
            {
                _logger.LogWarning(ex, "Kalıcı iş başarısız (type={Type}, attempt={Attempt}/{Max}).",
                    job.Type, job.Attempts + 1, job.MaxAttempts);
            }
        }

        // Sonucu yazmadan ÖNCE kalp atışı durdurulur: aksi hâlde kirayı uzatan bir vuruş ile
        // tamamlama yazması yarışabilirdi.
        await lease.DisposeAsync();

        if (lease.IsLost)
        {
            // Kirayı kaybettik: iş artık BAŞKASININ. Sonuç yazmaya kalkışmak yeni sahibi ezme
            // denemesidir; deneme sayacını da haksız yere artırırdı.
            _logger.LogWarning(
                "Kalıcı işin kirası kaybedildi, çalışma durduruldu (id={JobId}, type={Type}). "
                + "İşi yeni sahibi tamamlayacak.", job.Id, job.Type);
            return;
        }

        if (!await DurableJobClaim.TryCompleteAsync(db, job, token, succeeded, error, ct))
        {
            // Sahiplik kaybedildi: sonucu yazmak yeni sahibin durumunu ezerdi. İz bırakılır —
            // bu, kilit süresinin iş için kısa kaldığının işaretidir.
            _logger.LogWarning(
                "Kalıcı iş sonucu yazılamadı, sahiplenme kaybedilmiş (id={JobId}, type={Type}). "
                + "İş başka bir worker tarafından yeniden alındı.", job.Id, job.Type);
        }
    }


    /// <summary>
    /// Başarılı işleri 7 gün sonra temizler (tablo şişmesin); saatte bir dener.
    /// Silme sorgusu <see cref="BackgroundJobMaintenance"/> içinde — MariaDB uyumu ve testi orada.
    /// </summary>
    private async Task CleanupIfDueAsync(GuzellikDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (now - _lastCleanupUtc < TimeSpan.FromHours(1)) return;
        _lastCleanupUtc = now;

        var removed = await BackgroundJobMaintenance.PurgeSucceededAsync(db, now.AddDays(-7), CleanupMaxBatches, ct);
        if (removed > 0) _logger.LogInformation("Kalıcı iş kuyruğu temizlendi: {Count} başarılı iş silindi.", removed);
    }
}

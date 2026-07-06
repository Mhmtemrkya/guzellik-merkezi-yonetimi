using GuzellikMerkezi.Application.Abstractions;
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

        foreach (var job in jobs) job.MarkProcessing(LockDuration);
        await db.SaveChangesAsync(ct);

        var handlers = scope.ServiceProvider.GetServices<IDurableJobHandler>()
            .ToDictionary(h => h.JobType, StringComparer.OrdinalIgnoreCase);

        foreach (var job in jobs)
        {
            try
            {
                if (!handlers.TryGetValue(job.Type, out var handler))
                    throw new InvalidOperationException($"'{job.Type}' için kayıtlı handler yok.");
                await handler.ExecuteAsync(job.PayloadJson, ct);
                job.MarkSucceeded();
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Kapanış: kilit süresi dolunca iş yeniden alınacak; durumu değiştirme.
                throw;
            }
            catch (Exception ex)
            {
                job.MarkFailedAttempt(ex.Message);
                _logger.LogWarning(ex, "Kalıcı iş başarısız (type={Type}, attempt={Attempt}/{Max}).",
                    job.Type, job.Attempts, job.MaxAttempts);
            }
            await db.SaveChangesAsync(ct);
        }
        return jobs.Count;
    }

    /// <summary>Başarılı işleri 7 gün sonra temizler (tablo şişmesin); saatte bir dener.</summary>
    private async Task CleanupIfDueAsync(GuzellikDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (now - _lastCleanupUtc < TimeSpan.FromHours(1)) return;
        _lastCleanupUtc = now;
        var cutoff = now.AddDays(-7);
        await db.BackgroundJobs
            .Where(j => j.Status == "Succeeded" && j.CompletedAtUtc != null && j.CompletedAtUtc < cutoff)
            .ExecuteDeleteAsync(ct);
    }
}

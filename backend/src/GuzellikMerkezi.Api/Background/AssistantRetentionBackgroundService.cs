using GuzellikMerkezi.Infrastructure.Services.Assistant;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Maydi sohbet kayıtlarının saklama süresi (varsayılan 90 gün, <c>Assistant:RetentionDays</c>) dolunca silinmesi.
/// Günde bir çalışır; hata bir sonraki tura kadar beklenir (silme bir sonraki gün yine denenir).
/// </summary>
public sealed class AssistantRetentionBackgroundService(IServiceProvider services, ILogger<AssistantRetentionBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = services.CreateScope();
                var retention = scope.ServiceProvider.GetRequiredService<AssistantDataRetention>();
                var deleted = await retention.PurgeExpiredAsync(DateTime.UtcNow, stoppingToken);
                if (deleted > 0) logger.LogInformation("Maydi saklama süresi: {Deleted} eski kayıt silindi ({Days} gün).", deleted, retention.RetentionDays);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "Maydi saklama süresi temizliği hata verdi.");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }
}

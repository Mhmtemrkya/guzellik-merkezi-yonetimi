using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Arka plan iş kuyruğu tüketicisi. Kuyruktaki her işi request-path DIŞINDA, HER İŞ İÇİN AYRI DI scope'unda
/// yürütür (scoped servisler — DbContext vb. — güvenli çalışsın). Bir iş patlarsa loglanır, döngü devam eder.
/// </summary>
public sealed class QueuedHostedService : BackgroundService
{
    private readonly IBackgroundTaskQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<QueuedHostedService> _logger;

    public QueuedHostedService(IBackgroundTaskQueue queue, IServiceScopeFactory scopeFactory, ILogger<QueuedHostedService> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            Func<IServiceProvider, CancellationToken, Task> workItem;
            try
            {
                workItem = await _queue.DequeueAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            using var scope = _scopeFactory.CreateScope();
            try
            {
                await workItem(scope.ServiceProvider, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Arka plan iş öğesi hata verdi.");
            }
        }
    }
}

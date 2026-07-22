using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Teslim onayı (webhook "delivered") gelmeyen eski WhatsApp kontör rezervasyonlarını periyodik olarak iade eder.
/// Webhook kaçırılırsa kurum bakiyesi sonsuza dek kilitli kalmasın diye 48 saatlik güvenlik ağı.
/// </summary>
public sealed class WhatsAppReservationSweepBackgroundService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<WhatsAppReservationSweepBackgroundService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan ReservationTtl = TimeSpan.FromHours(48);

    public WhatsAppReservationSweepBackgroundService(IServiceProvider services, ILogger<WhatsAppReservationSweepBackgroundService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var billing = scope.ServiceProvider.GetRequiredService<IWhatsAppBillingService>();
                await billing.SweepStaleReservationsAsync(ReservationTtl, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "WhatsApp rezervasyon temizliği hata verdi.");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }
}

using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Askıda kalan MESAJ KREDİSİ rezervasyonlarını periyodik olarak kapatır.
/// <list type="bullet">
///   <item>WhatsApp: teslim onayı (webhook "delivered") 48 saatte gelmezse kredi iade edilir —
///         webhook kaçırılırsa kurum bakiyesi sonsuza dek kilitli kalmasın.</item>
///   <item>SMS: döngü tek çağrıda kapanır (rezerve → gönder → kesinleştir/iade); yalnız süreç arada
///         çökerse kredi askıda kalır. 2 saat sonra satırın durumuna göre kesinleşir ya da iade edilir.</item>
/// </list>
/// </summary>
public sealed class WhatsAppReservationSweepBackgroundService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<WhatsAppReservationSweepBackgroundService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan ReservationTtl = TimeSpan.FromHours(48);
    /// <summary>
    /// SMS rezervasyonunun "askıda" sayılacağı süre. Gerçek gönderim saniyeler sürer; eşik,
    /// bildirimin kendi bayat-kayıt devralma süresinden (15 dk) belirgin şekilde uzun tutulur ki
    /// devralınıp gönderilmek üzere olan bir satırın kredisi önceden iade edilmesin.
    /// </summary>
    private static readonly TimeSpan SmsReservationTtl = TimeSpan.FromHours(2);

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

            // Ayrı kapsam + ayrı hata yakalama: biri patlasa diğer kanalın kredisi askıda kalmasın.
            try
            {
                using var scope = _services.CreateScope();
                var billing = scope.ServiceProvider.GetRequiredService<IWhatsAppBillingService>();
                await billing.SweepStaleSmsReservationsAsync(SmsReservationTtl, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "SMS kredi rezervasyonu temizliği hata verdi.");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }
}

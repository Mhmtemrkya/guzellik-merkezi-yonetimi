using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Dakikada bir kurumların abonelik yaşam döngüsünü tarar: süresi dolan deneme (Trial) ve süresi dolan
/// ücretli abonelik (Active + SubscriptionEndsAtUtc geçmiş) kurumlarını Suspended'a çeker.
/// Pure-domain mantık Tenant.IsTrialExpired / IsSubscriptionExpired içinde tutulur; bu servis sadece tarayıcıdır.
/// </summary>
public sealed class TrialExpirationBackgroundService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<TrialExpirationBackgroundService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(20);

    public TrialExpirationBackgroundService(IServiceProvider services, ILogger<TrialExpirationBackgroundService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Backend ilk başladığında DB seed/migration bitmiş olsun diye kısa bir bekleme.
        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Trial expiration taraması hata verdi.");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();

        var now = DateTime.UtcNow;

        // Süresi dolan denemeler.
        var expiredTrials = await db.Tenants
            .Where(t => t.Status == TenantStatus.Trial
                     && t.TrialEndsAtUtc.HasValue
                     && t.TrialEndsAtUtc.Value <= now)
            .ToListAsync(ct);

        // Süresi dolan ücretli abonelikler.
        var expiredSubscriptions = await db.Tenants
            .Where(t => t.Status == TenantStatus.Active
                     && t.SubscriptionEndsAtUtc.HasValue
                     && t.SubscriptionEndsAtUtc.Value <= now)
            .ToListAsync(ct);

        if (expiredTrials.Count == 0 && expiredSubscriptions.Count == 0) return;

        foreach (var tenant in expiredTrials) tenant.Suspend();
        foreach (var tenant in expiredSubscriptions) tenant.Suspend();
        await db.SaveChangesAsync(ct);

        if (expiredTrials.Count > 0)
            _logger.LogInformation("{Count} tenant deneme süresi doldu, Suspended durumuna alındı.", expiredTrials.Count);
        if (expiredSubscriptions.Count > 0)
            _logger.LogInformation("{Count} tenant abonelik süresi doldu, Suspended durumuna alındı.", expiredSubscriptions.Count);
    }
}

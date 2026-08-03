using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Vadesi yaklaşan abonelikleri tarar ve her biri için yenileme tahsilatı işini kuyruğa atar.
///
/// <para>
/// VADEDEN ÖNCE TAHSİL EDİLİR (<see cref="BillingService.RenewalLeadTime"/>). Vade gününü
/// beklemek, başarısız bir çekimde kuruma düzeltme fırsatı bırakmadan
/// <see cref="TrialExpirationBackgroundService"/>'in kurumu askıya almasına yol açardı; öne almak
/// üç denemenin de vade dolmadan tamamlanmasını sağlar. Erken tahsilatta gün kaybı yoktur:
/// yeni dönem, mevcut bitiş tarihinden devam eder.
/// </para>
/// <para>
/// Bu servis yalnızca TARAYICIDIR: karar ve para mantığı <see cref="BillingService"/> içindedir,
/// tekrar oynatmaya karşı orada korunur (dönem başına tek başarılı tahsilat).
/// </para>
/// </summary>
public sealed class SubscriptionRenewalBackgroundService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<SubscriptionRenewalBackgroundService> _logger;

    private static readonly TimeSpan PollInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);

    public SubscriptionRenewalBackgroundService(IServiceProvider services, ILogger<SubscriptionRenewalBackgroundService> logger)
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
                await SweepAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Abonelik yenileme taraması hata verdi.");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();

        var settings = await db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (settings is null || !settings.PaymentsEnabled) return;

        var dueBefore = DateTime.UtcNow + BillingService.RenewalLeadTime;

        // Askıya alınmış kurumlar da taranır: kartı duruyorsa ödeme geçtiğinde abonelik yeniden
        // açılır (aksi halde kurum, ödeyecek durumdayken kilitli kalırdı).
        var tenantIds = await db.Tenants.AsNoTracking()
            .Where(t => (t.Status == TenantStatus.Active || t.Status == TenantStatus.Suspended)
                        && t.SubscriptionPlanId != null
                        && t.SubscriptionPeriod != null
                        && t.SubscriptionEndsAtUtc != null
                        && t.SubscriptionEndsAtUtc <= dueBefore)
            .Select(t => t.Id)
            .ToListAsync(ct);
        if (tenantIds.Count == 0) return;

        // Kartı olmayan kurumu kuyruğa atmanın anlamı yok (tahsilat denenemez).
        var withCard = await db.TenantPaymentMethods.AsNoTracking()
            .Where(c => c.IsActive)
            .Select(c => c.TenantId)
            .ToListAsync(ct);
        var cardSet = withCard.ToHashSet();

        var queue = scope.ServiceProvider.GetRequiredService<IDurableJobQueue>();
        var queued = 0;
        foreach (var tenantId in tenantIds.Where(cardSet.Contains))
        {
            await queue.EnqueueAsync(DurableJobTypes.SubscriptionRenewal, new SubscriptionRenewalJob(tenantId), ct);
            queued++;
        }

        if (queued > 0) _logger.LogInformation("{Count} kurum için abonelik yenileme kuyruğa alındı.", queued);
    }
}

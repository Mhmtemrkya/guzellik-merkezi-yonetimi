using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Otomatik bildirim gönderimi (2A). Belirli aralıklarla aktif tenant'ları + aktif şablonları tarar;
/// tetikleyiciye göre (randevu hatırlatma / doğum günü / ödeme hatırlatma) hedef müşterileri bulur,
/// NotificationLog üzerinden dedupe yapıp <see cref="INotificationService.SendAsync"/> ile gönderir.
/// </summary>
public sealed class NotificationDispatchBackgroundService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<NotificationDispatchBackgroundService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(40);
    private const int AppointmentLeadHours = 24;

    public NotificationDispatchBackgroundService(IServiceProvider services, ILogger<NotificationDispatchBackgroundService> logger)
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
            try { await SweepAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogWarning(ex, "Otomatik bildirim taraması hata verdi."); }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var notifications = scope.ServiceProvider.GetRequiredService<INotificationService>();
        var features = scope.ServiceProvider.GetRequiredService<IFeatureService>();
        var appNotifications = scope.ServiceProvider.GetRequiredService<IAppNotificationService>();

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var dayStart = new DateTime(now.Year, now.Month, now.Day, 0, 0, 0, DateTimeKind.Utc);
        var yearStart = new DateTime(now.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var activeTenants = await db.Tenants
            .Where(t => t.Status == TenantStatus.Active || t.Status == TenantStatus.Trial)
            .Select(t => t.Id)
            .ToListAsync(ct);

        var totalSent = 0;
        foreach (var tenantId in activeTenants)
        {
            // Uygulama-içi bildirim (kurum yöneticisine): vadesi gelen/geçen ödemeler — paket bağımsız çekirdek özellik,
            // günde bir kez (dedupe). Müşteriye giden SMS/WhatsApp kanalından ayrıdır.
            try
            {
                var due = await notifications.GetPaymentDueTargetsAsync(tenantId, today, ct);
                if (due.Count > 0)
                {
                    await appNotifications.NotifyRolesAsync(
                        tenantId, null,
                        new[] { UserRole.InstitutionOwner },
                        AppNotificationType.PaymentDue, AppNotificationSeverity.Warning,
                        "Vadesi gelen ödemeler",
                        $"{due.Count} müşterinin vadesi gelen/geçen ödemesi var.",
                        data: new { route = "/accounts" },
                        dedupeKey: $"paydue:{tenantId}:{today:yyyy-MM-dd}",
                        branchScoped: false,
                        ct: ct);
                }
            }
            catch (Exception ex) { _logger.LogWarning(ex, "Ödeme hatırlatma bildirimi üretilemedi ({TenantId}).", tenantId); }

            // Otomatik gönderim yalnızca pakette varsa (kanal kapıları ayrıca SendAsync içinde uygulanır).
            if (!await features.HasFeatureAsync(tenantId, FeatureCatalog.NotificationsAutomation, ct)) continue;

            var templates = await db.NotificationTemplates
                .Where(x => x.TenantId == tenantId && x.Status == NotificationTemplateStatus.Active
                         && (x.Trigger == NotificationTrigger.AppointmentReminder
                          || x.Trigger == NotificationTrigger.BirthdayGreeting
                          || x.Trigger == NotificationTrigger.PaymentDue
                          || x.Trigger == NotificationTrigger.WinBack
                          || x.Trigger == NotificationTrigger.SessionRenewal))
                .ToListAsync(ct);
            if (templates.Count == 0) continue;

            foreach (var template in templates)
            {
                // Doğum günü: yılda bir; Win-back: ~ayda bir (pasif müşteri her gün spam edilmesin); diğerleri: günde bir.
                var dedupeSince = template.Trigger switch
                {
                    NotificationTrigger.BirthdayGreeting => yearStart,
                    NotificationTrigger.WinBack => now.AddDays(-30),
                    // Seans yenileme: paketi bitmek üzere olana ~ayda bir teklif yeter.
                    NotificationTrigger.SessionRenewal => now.AddDays(-30),
                    _ => dayStart,
                };

                // Bu şablon için zaten gönderilmiş müşterileri çıkar (dedupe).
                var alreadySent = (await db.NotificationLogs
                        .Where(l => l.TenantId == tenantId && l.TemplateId == template.Id
                                 && l.CustomerId != null && l.CreatedAtUtc >= dedupeSince)
                        .Select(l => l.CustomerId)
                        .ToListAsync(ct))
                    .Where(id => id.HasValue).Select(id => id!.Value)
                    .ToHashSet();

                var targets = template.Trigger switch
                {
                    NotificationTrigger.AppointmentReminder => await AppointmentTargetsAsync(db, tenantId, now, ct),
                    NotificationTrigger.BirthdayGreeting => await BirthdayTargetsAsync(db, tenantId, today, ct),
                    NotificationTrigger.PaymentDue => (await notifications.GetPaymentDueTargetsAsync(tenantId, today, ct)).ToList(),
                    NotificationTrigger.WinBack => (await notifications.GetWinBackTargetsAsync(tenantId, ct)).ToList(),
                    NotificationTrigger.SessionRenewal => (await notifications.GetSessionRenewalTargetsAsync(tenantId, ct)).ToList(),
                    _ => new List<Guid>(),
                };

                var toSend = targets.Where(id => !alreadySent.Contains(id)).Distinct().ToList();
                if (toSend.Count == 0) continue;

                var result = await notifications.SendAsync(tenantId, new SendNotificationRequest(template.Id, toSend, null), ct);
                if (result.IsSuccess && result.Value is not null)
                    totalSent += result.Value.Sent;
            }
        }

        if (totalSent > 0)
            _logger.LogInformation("Otomatik bildirim: {Count} mesaj gönderildi.", totalSent);
    }

    private static async Task<List<Guid>> AppointmentTargetsAsync(GuzellikDbContext db, Guid tenantId, DateTime now, CancellationToken ct)
    {
        var until = now.AddHours(AppointmentLeadHours);
        return await db.Appointments
            .Where(a => a.TenantId == tenantId
                     && a.StartUtc > now && a.StartUtc <= until
                     && a.Status != AppointmentStatus.Completed && a.Status != AppointmentStatus.Cancelled)
            .Select(a => a.CustomerId)
            .Distinct()
            .ToListAsync(ct);
    }

    private static async Task<List<Guid>> BirthdayTargetsAsync(GuzellikDbContext db, Guid tenantId, DateOnly today, CancellationToken ct)
    {
        var customers = await db.Customers
            .Where(c => c.TenantId == tenantId)
            .Select(c => new { c.Id, c.BirthDate })
            .ToListAsync(ct);
        return customers
            .Where(c => c.BirthDate.HasValue && c.BirthDate.Value.Month == today.Month && c.BirthDate.Value.Day == today.Day)
            .Select(c => c.Id)
            .ToList();
    }

}

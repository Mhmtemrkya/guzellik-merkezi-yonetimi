using System.Globalization;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// Ay sonu gelir/gider özeti (kurum yöneticisine). Günde birkaç kez tarar; her aktif kurum için BİR ÖNCEKİ
/// takvim ayının (İstanbul/UTC+3) tahsilat (gelir) ve gider toplamını hesaplayıp bildirir.
/// Dedupe anahtarı (ay bazlı) sayesinde ay başına yalnızca bir kez gönderilir.
/// </summary>
public sealed class MonthlyReportBackgroundService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(90);
    private static readonly CultureInfo Tr = new("tr-TR");
    private const int TurkeyOffsetHours = 3;

    private readonly IServiceProvider _services;
    private readonly ILogger<MonthlyReportBackgroundService> _logger;

    public MonthlyReportBackgroundService(IServiceProvider services, ILogger<MonthlyReportBackgroundService> logger)
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
            catch (Exception ex) { _logger.LogWarning(ex, "Aylık rapor taraması hata verdi."); }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var notifications = scope.ServiceProvider.GetRequiredService<IAppNotificationService>();

        // Bir önceki takvim ayı (İstanbul). Pencereyi UTC'ye çevir.
        var nowIst = DateTime.UtcNow.AddHours(TurkeyOffsetHours);
        var firstOfThisMonthIst = new DateTime(nowIst.Year, nowIst.Month, 1, 0, 0, 0, DateTimeKind.Unspecified);
        var firstOfPrevMonthIst = firstOfThisMonthIst.AddMonths(-1);
        var fromUtc = DateTime.SpecifyKind(firstOfPrevMonthIst.AddHours(-TurkeyOffsetHours), DateTimeKind.Utc);
        var toUtc = DateTime.SpecifyKind(firstOfThisMonthIst.AddHours(-TurkeyOffsetHours), DateTimeKind.Utc);
        var periodKey = firstOfPrevMonthIst.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var periodLabel = firstOfPrevMonthIst.ToString("MMMM yyyy", Tr);

        var activeTenants = await db.Tenants
            .Where(t => t.Status == TenantStatus.Active || t.Status == TenantStatus.Trial)
            .Select(t => t.Id)
            .ToListAsync(ct);

        foreach (var tenantId in activeTenants)
        {
            try
            {
                // AccountPayment tenant'a CustomerAccount üzerinden bağlı; join ile süz.
                var income = await (
                    from p in db.AccountPayments.IgnoreQueryFilters()
                    join a in db.CustomerAccounts.IgnoreQueryFilters() on p.CustomerAccountId equals a.Id
                    where a.TenantId == tenantId && p.OccurredAtUtc >= fromUtc && p.OccurredAtUtc < toUtc
                    select (decimal?)p.Amount).SumAsync(ct) ?? 0m;
                var expense = await db.BusinessExpenses.IgnoreQueryFilters()
                    .Where(e => e.TenantId == tenantId && e.OccurredAtUtc >= fromUtc && e.OccurredAtUtc < toUtc)
                    .SumAsync(e => (decimal?)e.Amount, ct) ?? 0m;

                // Hiç hareket yoksa rapor göndermeye değmez (yeni/pasif kurumları rahatsız etme).
                if (income == 0m && expense == 0m) continue;

                var net = income - expense;
                await notifications.NotifyRolesAsync(
                    tenantId, null,
                    new[] { UserRole.InstitutionOwner },
                    AppNotificationType.MonthlyReport, AppNotificationSeverity.Info,
                    $"Aylık rapor · {periodLabel}",
                    $"Gelir {income:0.##}₺ · Gider {expense:0.##}₺ · Net {net:0.##}₺",
                    data: new { route = "/reports", period = periodKey },
                    dedupeKey: $"monthly:{tenantId}:{periodKey}",
                    branchScoped: false,
                    ct: ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Aylık rapor üretilemedi (tenant {TenantId}).", tenantId);
            }
        }
    }
}

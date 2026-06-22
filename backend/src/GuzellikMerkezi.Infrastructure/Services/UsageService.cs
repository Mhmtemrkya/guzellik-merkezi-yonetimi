using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class UsageService : IUsageService
{
    private readonly GuzellikDbContext _db;
    private readonly bool _failOpenWhenNoPlan;

    public UsageService(GuzellikDbContext db, IConfiguration configuration)
    {
        _db = db;
        // Plan atanmamış tenant'ta limit davranışı: Development fail-OPEN (test), Production fail-CLOSED
        // (plansız tenant limitsiz yazamaz). Override: "Features:FailOpenWhenNoPlan".
        var env = configuration["ASPNETCORE_ENVIRONMENT"]
                  ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
                  ?? "Production";
        var isDevelopment = string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase);
        _failOpenWhenNoPlan = bool.TryParse(configuration["Features:FailOpenWhenNoPlan"], out var f) ? f : isDevelopment;
    }

    public async Task<Result<TenantUsageDto>> GetTenantUsageAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<TenantUsageDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var metrics = await CalculateMetricsAsync(tenant, ct);
        var dto = new TenantUsageDto(
            tenant.Id, tenant.Name,
            tenant.SubscriptionPlanId, tenant.SubscriptionPlan?.Name, tenant.SubscriptionPlan?.PlanKey,
            tenant.SubscriptionPlan?.MonthlyPriceTRY ?? 0m,
            metrics);
        return Result<TenantUsageDto>.Success(dto);
    }

    public async Task<Result<PlatformUsageSummaryDto>> GetPlatformSummaryAsync(CancellationToken ct = default)
    {
        var tenants = await _db.Tenants.AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .ToListAsync(ct);

        // N+1 ÖNLEME: her tenant için ayrı 7 COUNT yerine, her metrik için TEK GROUP BY sorgusu.
        // Toplam ~8 sorgu (tenant sayısından bağımsız) — platform dashboard tenant arttıkça yavaşlamaz.
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        var branchCounts = await _db.Branches.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted).GroupBy(x => x.TenantId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var staffCounts = await _db.StaffMembers.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted && x.IsActive).GroupBy(x => x.TenantId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var customerCounts = await _db.Customers.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted).GroupBy(x => x.TenantId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var appointmentCounts = await _db.Appointments.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted && x.StartUtc >= monthStart).GroupBy(x => x.TenantId)
            .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var smsCounts = await _db.NotificationLogs.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted && x.Channel == NotificationChannel.Sms && x.Status == NotificationLogStatus.Sent && x.CreatedAtUtc >= monthStart)
            .GroupBy(x => x.TenantId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var whatsAppCounts = await _db.WhatsAppMessages.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted && x.Direction == WhatsAppMessageDirection.Outbound && x.CreatedAtUtc >= monthStart)
            .GroupBy(x => x.TenantId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var emailCounts = await _db.NotificationLogs.AsNoTracking().IgnoreQueryFilters()
            .Where(x => !x.IsDeleted && x.Channel == NotificationChannel.Email && x.Status == NotificationLogStatus.Sent && x.CreatedAtUtc >= monthStart)
            .GroupBy(x => x.TenantId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        var usages = new List<TenantUsageDto>(tenants.Count);
        foreach (var t in tenants)
        {
            var metrics = BuildMetrics(
                t.SubscriptionPlan,
                branchCounts.GetValueOrDefault(t.Id),
                staffCounts.GetValueOrDefault(t.Id),
                customerCounts.GetValueOrDefault(t.Id),
                appointmentCounts.GetValueOrDefault(t.Id),
                smsCounts.GetValueOrDefault(t.Id),
                whatsAppCounts.GetValueOrDefault(t.Id),
                emailCounts.GetValueOrDefault(t.Id));
            usages.Add(new TenantUsageDto(
                t.Id, t.Name,
                t.SubscriptionPlanId, t.SubscriptionPlan?.Name, t.SubscriptionPlan?.PlanKey,
                t.SubscriptionPlan?.MonthlyPriceTRY ?? 0m,
                metrics));
        }

        var mrr = tenants.Where(t => t.Status == TenantStatus.Active && t.SubscriptionPlan is not null)
            .Sum(t => t.SubscriptionPlan!.MonthlyPriceTRY);

        var breakdown = tenants
            .GroupBy(t => new { Id = t.SubscriptionPlanId, Key = t.SubscriptionPlan?.PlanKey ?? "Unassigned", Name = t.SubscriptionPlan?.Name ?? "Atanmamış" })
            .Select(g => new PlanUsageBreakdown(
                g.Key.Id,
                g.Key.Key,
                g.Key.Name,
                g.Count(),
                g.Where(t => t.Status == TenantStatus.Active && t.SubscriptionPlan is not null)
                 .Sum(t => t.SubscriptionPlan!.MonthlyPriceTRY)))
            .OrderByDescending(b => b.TenantCount)
            .ToArray();

        var summary = new PlatformUsageSummaryDto(
            tenants.Count,
            tenants.Count(t => t.Status == TenantStatus.Active),
            tenants.Count(t => t.Status == TenantStatus.Trial),
            tenants.Count(t => t.Status == TenantStatus.Suspended || t.Status == TenantStatus.Cancelled),
            mrr,
            usages.Count(u => u.HasWarning),
            usages.Count(u => u.HasAnyOverflow),
            breakdown,
            usages);

        return Result<PlatformUsageSummaryDto>.Success(summary);
    }

    public async Task<Result> CheckLimitAsync(Guid tenantId, string metricKey, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result.Failure(Error.NotFound("Kurum bulunamadı."));

        // Paket yoksa: Development'ta serbest (fail-open); Production'da fail-CLOSED — plansız tenant
        // limitsiz yazamaz, açık mesajla paket atamaya yönlendirilir.
        var plan = tenant.SubscriptionPlan;
        if (plan is null)
            return _failOpenWhenNoPlan
                ? Result.Success()
                : Result.Failure(Error.Conflict("Kuruma abonelik planı atanmamış. İşleme devam etmek için bir paket seçin/atayın."));

        var metrics = await CalculateMetricsAsync(tenant, ct);
        var metric = metrics.FirstOrDefault(m => string.Equals(m.Key, metricKey, StringComparison.OrdinalIgnoreCase));
        if (metric is null) return Result.Success(); // Bilinmeyen metrik — kısıtlama yok.
        if (metric.IsUnlimited) return Result.Success();
        if (metric.Used < metric.Limit) return Result.Success();

        // Limit dolu — Conflict (HTTP 409) ile dön.
        return Result.Failure(Error.Conflict(
            $"{plan.Name} paketinin {metric.Label.ToLower()} sınırına ulaşıldı ({metric.Used}/{metric.Limit}). " +
            "Bir üst pakete geçerek devam edebilirsin."));
    }

    private async Task<IReadOnlyCollection<UsageMetric>> CalculateMetricsAsync(Tenant tenant, CancellationToken ct)
    {
        var plan = tenant.SubscriptionPlan;
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        var branchCount = await _db.Branches.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted, ct);
        var staffCount = await _db.StaffMembers.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted && x.IsActive, ct);
        var customerCount = await _db.Customers.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted, ct);
        var monthlyAppointmentCount = await _db.Appointments.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted && x.StartUtc >= monthStart, ct);
        var monthlySmsCount = await _db.NotificationLogs.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted
                          && x.Channel == NotificationChannel.Sms
                          && x.Status == NotificationLogStatus.Sent
                          && x.CreatedAtUtc >= monthStart, ct);
        var monthlyWhatsAppCount = await _db.WhatsAppMessages.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted
                          && x.Direction == WhatsAppMessageDirection.Outbound
                          && x.CreatedAtUtc >= monthStart, ct);
        var monthlyEmailCount = await _db.NotificationLogs.AsNoTracking().IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenant.Id && !x.IsDeleted
                          && x.Channel == NotificationChannel.Email
                          && x.Status == NotificationLogStatus.Sent
                          && x.CreatedAtUtc >= monthStart, ct);

        return BuildMetrics(plan, branchCount, staffCount, customerCount, monthlyAppointmentCount,
            monthlySmsCount, monthlyWhatsAppCount, monthlyEmailCount);
    }

    /// <summary>Sayımlardan plan limitleriyle metrik dizisini kurar (tek-tenant ve platform özeti ortak kullanır).</summary>
    private static IReadOnlyCollection<UsageMetric> BuildMetrics(
        SubscriptionPlan? plan, int branchCount, int staffCount, int customerCount,
        int appointmentCount, int smsCount, int whatsAppCount, int emailCount)
        => new[]
        {
            new UsageMetric("branches", "Şube",            branchCount,     plan?.MaxBranches ?? 1),
            new UsageMetric("staff",    "Personel",        staffCount,      plan?.MaxStaff ?? 5),
            new UsageMetric("customers","Müşteri",         customerCount,   plan?.MaxCustomers ?? 500),
            new UsageMetric("appointments","Aylık randevu",appointmentCount,plan?.MaxMonthlyAppointments ?? 500),
            new UsageMetric("sms",      "Aylık SMS",       smsCount,        plan?.MaxMonthlySmsCount ?? 0),
            new UsageMetric("whatsapp", "Aylık WhatsApp",  whatsAppCount,   plan?.MaxMonthlyWhatsAppCount ?? 0),
            new UsageMetric("email",    "Aylık E-posta",   emailCount,      plan?.MaxMonthlyEmailCount ?? 0),
        };
}

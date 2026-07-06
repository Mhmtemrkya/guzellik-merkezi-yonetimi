using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformOps;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class PlatformOpsService : IPlatformOpsService
{
    private static readonly string[] SystemSections = ["planLimits", "security", "integrations", "maintenance", "dataRetention"];

    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public PlatformOpsService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    // ------------------------- Sistem ayarları -------------------------

    public async Task<Result<PlatformSystemSettingsDto>> GetSystemSettingsAsync(CancellationToken ct = default)
    {
        var settings = await GetOrCreateSettingsAsync(ct);
        return Result<PlatformSystemSettingsDto>.Success(ToDto(settings));
    }

    public async Task<Result<PlatformSystemSettingsDto>> SaveSystemSectionAsync(SaveSystemSectionRequest request, CancellationToken ct = default)
    {
        if (!SystemSections.Contains(request.Section))
            return Result<PlatformSystemSettingsDto>.Failure(Error.Validation("Geçersiz ayar bölümü."));
        if (string.IsNullOrWhiteSpace(request.Json))
            return Result<PlatformSystemSettingsDto>.Failure(Error.Validation("Ayar içeriği boş olamaz."));

        // Bozuk JSON saklanmasın — UI her zaman obje yollar.
        try
        {
            using var _ = System.Text.Json.JsonDocument.Parse(request.Json);
        }
        catch (System.Text.Json.JsonException)
        {
            return Result<PlatformSystemSettingsDto>.Failure(Error.Validation("Ayar içeriği geçerli JSON değil."));
        }

        var settings = await GetOrCreateSettingsAsync(ct);
        settings.UpdateSection(request.Section, request.Json, request.MaintenanceEnabled);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(null, null, "Platform.SystemSettingsChanged", "PlatformSystemSettings", settings.Id,
            $"Sistem ayarları güncellendi: {request.Section}.", null, ct);
        return Result<PlatformSystemSettingsDto>.Success(ToDto(settings));
    }

    private async Task<PlatformSystemSettings> GetOrCreateSettingsAsync(CancellationToken ct)
    {
        var settings = await _db.PlatformSystemSettings.FirstOrDefaultAsync(ct);
        if (settings is null)
        {
            settings = new PlatformSystemSettings();
            _db.PlatformSystemSettings.Add(settings);
            await _db.SaveChangesAsync(ct);
        }
        return settings;
    }

    private static PlatformSystemSettingsDto ToDto(PlatformSystemSettings s) => new(
        s.PlanLimitsJson, s.SecurityJson, s.IntegrationsJson, s.MaintenanceJson, s.DataRetentionJson, s.MaintenanceEnabled,
        s.UpdatedAtUtc ?? s.CreatedAtUtc);

    // ------------------------- Kalıcı iş kuyruğu -------------------------

    public async Task<Result<QueueStatusDto>> GetQueueStatusAsync(CancellationToken ct = default)
    {
        var dayAgo = DateTime.UtcNow.AddHours(-24);
        var counts = await _db.BackgroundJobs.AsNoTracking()
            .GroupBy(j => j.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        int Of(string s) => counts.FirstOrDefault(c => c.Status == s)?.Count ?? 0;

        var succeeded24h = await _db.BackgroundJobs.AsNoTracking()
            .CountAsync(j => j.Status == "Succeeded" && j.CompletedAtUtc >= dayAgo, ct);

        var failures = await _db.BackgroundJobs.AsNoTracking()
            .Where(j => j.Status == "Failed")
            .OrderByDescending(j => j.CompletedAtUtc)
            .Take(5)
            .Select(j => new FailedJobDto(j.Id, j.Type, j.Attempts, j.LastError, j.CompletedAtUtc))
            .ToListAsync(ct);

        return Result<QueueStatusDto>.Success(new QueueStatusDto(
            Of("Pending"), Of("Processing"), Of("Failed"), succeeded24h, failures));
    }

    public async Task<Result> RequeueJobAsync(Guid jobId, CancellationToken ct = default)
    {
        var job = await _db.BackgroundJobs.FirstOrDefaultAsync(j => j.Id == jobId, ct);
        if (job is null) return Result.Failure(Error.NotFound("İş bulunamadı."));
        job.Requeue();
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(null, null, "Platform.JobRequeued", "BackgroundJob", job.Id,
            $"{job.Type} işi yeniden kuyruğa alındı.", null, ct);
        return Result.Success();
    }

    // --------------------------- Faturalama ---------------------------

    public async Task<Result<IReadOnlyCollection<TenantInvoiceDto>>> ListInvoicesAsync(string? status, string? search, CancellationToken ct = default)
    {
        var query = _db.TenantInvoices.AsNoTracking().Include(i => i.Tenant).AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(i => i.Status == status);
        var rows = await query.OrderByDescending(i => i.IssuedAtUtc).Take(500).ToListAsync(ct);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLowerInvariant();
            rows = rows.Where(i =>
                i.Number.ToLowerInvariant().Contains(s) ||
                (i.Tenant?.Name.ToLowerInvariant().Contains(s) ?? false)).ToList();
        }
        return Result<IReadOnlyCollection<TenantInvoiceDto>>.Success(rows.Select(i => ToDto(i)).ToArray());
    }

    public async Task<Result<TenantInvoiceDto>> CreateInvoiceAsync(CreateInvoiceRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.TenantId, ct);
        if (tenant is null) return Result<TenantInvoiceDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var now = DateTime.UtcNow;
        var start = request.PeriodStartUtc ?? new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = request.PeriodEndUtc ?? start.AddMonths(1);

        TenantInvoice invoice;
        try
        {
            invoice = new TenantInvoice(tenant.Id, await NextNumberAsync(ct), start, end, request.AmountTRY, request.Notes);
        }
        catch (DomainException ex)
        {
            return Result<TenantInvoiceDto>.Failure(Error.Validation(ex.Message));
        }

        _db.TenantInvoices.Add(invoice);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(null, null, "Platform.InvoiceCreated", "TenantInvoice", invoice.Id,
            $"{tenant.Name} için {invoice.Number} numaralı fatura oluşturuldu ({invoice.AmountTRY:0.##} TL).", null, ct);
        return Result<TenantInvoiceDto>.Success(ToDto(invoice, tenant.Name));
    }

    public async Task<Result<GenerateInvoicesResultDto>> GenerateCurrentPeriodInvoicesAsync(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var periodStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var periodEnd = periodStart.AddMonths(1);

        var tenants = await _db.Tenants.AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .Where(t => t.Status == TenantStatus.Active && t.SubscriptionPlanId != null)
            .ToListAsync(ct);

        var existingTenantIds = await _db.TenantInvoices.AsNoTracking()
            .Where(i => i.PeriodStartUtc == periodStart && i.Status != "Cancelled")
            .Select(i => i.TenantId)
            .ToListAsync(ct);
        var existing = existingTenantIds.ToHashSet();

        int created = 0, skipped = 0;
        foreach (var tenant in tenants)
        {
            if (existing.Contains(tenant.Id)) { skipped++; continue; }
            var plan = tenant.SubscriptionPlan!;
            // Yıllık abonelikte aylık eşdeğer tutar yazılır (yıllık fiyat / 12); yıllık fiyat yoksa aylık.
            var amount = tenant.SubscriptionPeriod == BillingPeriod.Yearly && plan.YearlyPriceTRY > 0
                ? Math.Round(plan.YearlyPriceTRY / 12m, 2)
                : plan.MonthlyPriceTRY;
            _db.TenantInvoices.Add(new TenantInvoice(tenant.Id, await NextNumberAsync(ct), periodStart, periodEnd, amount,
                $"{now:MMMM yyyy} dönemi · {plan.Name}"));
            await _db.SaveChangesAsync(ct); // numara sıralaması için tek tek
            created++;
        }

        await _audit.LogAsync(null, null, "Platform.InvoicesGenerated", "TenantInvoice", null,
            $"Dönem faturaları üretildi: {created} yeni, {skipped} mevcut.", null, ct);
        return Result<GenerateInvoicesResultDto>.Success(new GenerateInvoicesResultDto(created, skipped));
    }

    public async Task<Result<TenantInvoiceDto>> UpdateInvoiceStatusAsync(Guid invoiceId, UpdateInvoiceStatusRequest request, CancellationToken ct = default)
    {
        var invoice = await _db.TenantInvoices.Include(i => i.Tenant).FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
        if (invoice is null) return Result<TenantInvoiceDto>.Failure(Error.NotFound("Fatura bulunamadı."));
        try
        {
            invoice.ChangeStatus(request.Status);
        }
        catch (DomainException ex)
        {
            return Result<TenantInvoiceDto>.Failure(Error.Validation(ex.Message));
        }
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(null, null, "Platform.InvoiceStatusChanged", "TenantInvoice", invoice.Id,
            $"{invoice.Number} durumu {request.Status} yapıldı.", null, ct);
        return Result<TenantInvoiceDto>.Success(ToDto(invoice));
    }

    public async Task<Result> DeleteInvoiceAsync(Guid invoiceId, CancellationToken ct = default)
    {
        var invoice = await _db.TenantInvoices.FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
        if (invoice is null) return Result.Failure(Error.NotFound("Fatura bulunamadı."));
        invoice.SoftDelete();
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(null, null, "Platform.InvoiceDeleted", "TenantInvoice", invoice.Id,
            $"{invoice.Number} numaralı fatura silindi.", null, ct);
        return Result.Success();
    }

    /// <summary>INV-2026-000123 biçiminde sıradaki numara.</summary>
    private async Task<string> NextNumberAsync(CancellationToken ct)
    {
        var year = DateTime.UtcNow.Year;
        var prefix = $"INV-{year}-";
        var count = await _db.TenantInvoices.IgnoreQueryFilters().CountAsync(i => i.Number.StartsWith(prefix), ct);
        return $"{prefix}{count + 1:D6}";
    }

    private static TenantInvoiceDto ToDto(TenantInvoice i, string? tenantName = null) => new(
        i.Id, i.TenantId, tenantName ?? i.Tenant?.Name ?? "—", i.Number, i.PeriodStartUtc, i.PeriodEndUtc,
        i.AmountTRY, i.Status, i.IssuedAtUtc, i.DueDateUtc, i.PaidAtUtc, i.Notes);
}

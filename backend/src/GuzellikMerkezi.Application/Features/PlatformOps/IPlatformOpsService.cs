using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.PlatformOps;

/// <summary>
/// Platform admin operasyonları: sistem ayarları (singleton, bölüm bazlı JSON)
/// ve kurum abonelik faturaları. RabbitMQ bilinçli olarak KULLANILMADI:
/// tek-sunucu monolitte mevcut Channel&lt;T&gt; kuyruğu asenkron ihtiyaçları karşılıyor.
/// </summary>
public interface IPlatformOpsService
{
    Task<Result<PlatformSystemSettingsDto>> GetSystemSettingsAsync(CancellationToken ct = default);
    Task<Result<PlatformSystemSettingsDto>> SaveSystemSectionAsync(SaveSystemSectionRequest request, CancellationToken ct = default);

    Task<Result<QueueStatusDto>> GetQueueStatusAsync(CancellationToken ct = default);
    Task<Result> RequeueJobAsync(Guid jobId, CancellationToken ct = default);

    Task<Result<IReadOnlyCollection<TenantInvoiceDto>>> ListInvoicesAsync(string? status, string? search, CancellationToken ct = default);
    Task<Result<TenantInvoiceDto>> CreateInvoiceAsync(CreateInvoiceRequest request, CancellationToken ct = default);
    /// <summary>İçinde bulunulan ay için aktif abonelikli tüm kurumlara taslak fatura üretir (idempotent).</summary>
    Task<Result<GenerateInvoicesResultDto>> GenerateCurrentPeriodInvoicesAsync(CancellationToken ct = default);
    Task<Result<TenantInvoiceDto>> UpdateInvoiceStatusAsync(Guid invoiceId, UpdateInvoiceStatusRequest request, CancellationToken ct = default);
    Task<Result> DeleteInvoiceAsync(Guid invoiceId, CancellationToken ct = default);
}

/// <summary>Bölümler: planLimits | security | integrations | maintenance. İçerik serbest şemalı JSON.</summary>
public sealed record PlatformSystemSettingsDto(
    string? PlanLimits,
    string? Security,
    string? Integrations,
    string? Maintenance,
    string? DataRetention,
    bool MaintenanceEnabled,
    DateTime UpdatedAtUtc);

public sealed record SaveSystemSectionRequest(string Section, string Json, bool? MaintenanceEnabled);

public sealed record TenantInvoiceDto(
    Guid Id,
    Guid TenantId,
    string TenantName,
    string Number,
    DateTime PeriodStartUtc,
    DateTime PeriodEndUtc,
    decimal AmountTRY,
    string Status,
    DateTime IssuedAtUtc,
    DateTime DueDateUtc,
    DateTime? PaidAtUtc,
    string? Notes);

public sealed record CreateInvoiceRequest(Guid TenantId, decimal AmountTRY, DateTime? PeriodStartUtc, DateTime? PeriodEndUtc, string? Notes);

public sealed record UpdateInvoiceStatusRequest(string Status);

public sealed record GenerateInvoicesResultDto(int Created, int Skipped);

/// <summary>Kalıcı iş kuyruğu sağlık özeti (platform sistem sayfası).</summary>
public sealed record QueueStatusDto(
    int Pending,
    int Processing,
    int Failed,
    int SucceededLast24h,
    IReadOnlyCollection<FailedJobDto> RecentFailures);

public sealed record FailedJobDto(Guid Id, string Type, int Attempts, string? LastError, DateTime? CompletedAtUtc);

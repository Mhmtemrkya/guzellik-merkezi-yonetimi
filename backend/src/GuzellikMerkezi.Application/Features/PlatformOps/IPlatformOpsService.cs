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
    /// <summary>Faturalama ekranı: KPI'lar, abonelikler (sonraki yenileme teklifiyle), son tahsilat denemeleri, aylık tahsilat.</summary>
    Task<Result<PlatformBillingOverviewDto>> GetBillingOverviewAsync(CancellationToken ct = default);
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
    string? Notes,
    decimal NetAmountTRY = 0,
    decimal VatAmountTRY = 0,
    decimal VatRate = 0,
    /// <summary>Sağlayıcı ödeme kimliği — kartla tahsil edilen faturada dolu.</summary>
    string? PaymentReference = null,
    /// <summary>Tahsilat anındaki kalem dökümü (anlık görüntü; sonradan yeniden hesaplanmaz).</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.QuoteLine>? Lines = null,
    /// <summary>"Card" = karttan otomatik tahsil, "Manual" = platformun elle kestiği fatura.</summary>
    string Source = "Manual",
    /// <summary>Fatura ÖDENDİĞİNDE dönemi boyunca açılan dijital onam kademesi (eşik); null = kademe açmaz.</summary>
    int? ConsentTierAbove = null,
    /// <summary>Fatura ÖDENDİĞİNDE dönemi boyunca açılan müşteri kademesi (eşik); null = kademe açmaz.</summary>
    int? CustomerTierAbove = null,
    /// <summary>Ödeme bekleyen şube talebi (şube "Ödendi" yapılınca açılır); null = yok / açıldı.</summary>
    string? PendingBranchName = null);

/// <summary>Platform › Faturalama ekranının tamamı — tüm toplamlar SUNUCUDA, fiyatlama motoruyla hesaplanır.</summary>
public sealed record PlatformBillingOverviewDto(
    PlatformBillingKpisDto Kpis,
    IReadOnlyList<PlatformSubscriptionRowDto> Subscriptions,
    IReadOnlyList<PlatformPaymentRowDto> RecentPayments,
    IReadOnlyList<PlatformMonthlyCollectionDto> MonthlyCollections,
    DateTime GeneratedAtUtc);

/// <param name="MrrNet">Aktif ücretli aboneliklerin aylık eşdeğeri (KDV hariç; yıllık ÷ 12).</param>
/// <param name="CollectedThisMonthGross">Bu ay ÖDENMİŞ faturaların KDV dahil toplamı.</param>
/// <param name="OutstandingGross">Ödenmemiş (taslak/gönderildi/gecikmiş) faturaların KDV dahil toplamı.</param>
public sealed record PlatformBillingKpisDto(
    decimal MrrNet,
    decimal ArrNet,
    decimal CollectedThisMonthGross,
    decimal CollectedThisMonthNet,
    decimal CollectedLastMonthGross,
    decimal OutstandingGross,
    int OverdueInvoices,
    int ActiveSubscriptions,
    int TrialTenants,
    int CardOnFile,
    int FailedPaymentsLast30Days,
    int PendingPayments,
    decimal NextThirtyDaysRenewalsGross);

public sealed record PlatformSubscriptionRowDto(
    Guid TenantId,
    string TenantName,
    string Status,
    string? PlanName,
    string? Period,
    DateTime? SubscriptionEndsAtUtc,
    DateTime? TrialEndsAtUtc,
    bool HasCard,
    string? CardMasked,
    int Branches,
    int Customers,
    int SignedConsentForms,
    /// <summary>Aylık eşdeğer (KDV hariç) — MRR'ye katkı.</summary>
    decimal MonthlyEquivalentNet,
    /// <summary>Bir sonraki yenilemede güncel sayaçlarla çekilecek tutar (ücretli plan yoksa null).</summary>
    GuzellikMerkezi.Domain.Billing.SubscriptionQuote? NextRenewalQuote);

public sealed record PlatformPaymentRowDto(
    Guid Id,
    Guid TenantId,
    string TenantName,
    string Kind,
    string Status,
    decimal AmountTRY,
    string? ErrorMessage,
    int AttemptNumber,
    DateTime CreatedAtUtc,
    DateTime? CompletedAtUtc);

public sealed record PlatformMonthlyCollectionDto(int Year, int Month, decimal Gross, decimal Net, int InvoiceCount);

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

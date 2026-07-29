using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Reports;

/// <summary>
/// Raporlar sayfasının veri kaynağı. Her metot aynı <see cref="ReportRangeRequest"/> sözleşmesini
/// alır: dönem + (opsiyonel) karşılaştırma penceresi. Böylece "1 Temmuz – 2 Eylül"u "geçen yılın
/// aynı aralığı" ile kıyaslamak tek parametre değişikliğidir.
/// </summary>
public interface IReportsService
{
    Task<Result<ReportSummaryDto>> GetSummaryAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default);

    /// <summary>
    /// Serbest seçilmiş 2–6 dönemi yan yana kıyaslar (ör. bu yıl ↔ 5 yıl önce). İlk dönem
    /// "temel"dir; diğerlerinin farkı ona göre hesaplanır.
    /// </summary>
    Task<Result<CompareReportDto>> GetCompareAsync(
        Guid tenantId,
        IReadOnlyList<ComparePeriodRequest> periods,
        string? granularity,
        CancellationToken cancellationToken = default);

    /// <summary>Paket + hizmet kırılımı: kim sattı, kim uyguladı, kaç seans kaldı.</summary>
    Task<Result<CatalogReportDto>> GetCatalogAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default);

    Task<Result<StaffReportDto>> GetStaffAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default);

    /// <summary>Şube karşılaştırması. Kurum yöneticisi için üst menüdeki şube seçimi yok sayılır.</summary>
    Task<Result<BranchReportDto>> GetBranchesAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default);

    Task<Result<CustomerReportDto>> GetCustomersAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default);

    /// <summary>Stok/ürün hareketleri + hediye çeki kullanımı.</summary>
    Task<Result<InventoryReportDto>> GetInventoryAsync(Guid tenantId, ReportRangeRequest range, CancellationToken cancellationToken = default);
}

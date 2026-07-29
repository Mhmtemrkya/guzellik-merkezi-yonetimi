namespace GuzellikMerkezi.Application.Features.Reports;

/// <summary>
/// Rapor sorgusunun dönemi. <b>Karşılaştırma</b> penceresi opsiyoneldir: verilirse her metriğin
/// "önceki" değeri o pencereden hesaplanır (geçen ay, geçen yıl, 2 yıl önce, özel aralık…).
/// Bütün tarihler UTC ve yarı-açık aralıktır: [FromUtc, ToUtc).
/// </summary>
public sealed record ReportRangeRequest(
    DateTime FromUtc,
    DateTime ToUtc,
    DateTime? CompareFromUtc = null,
    DateTime? CompareToUtc = null,
    /// <summary>day | week | month — zaman serisinin kova genişliği. Boşsa dönem uzunluğundan seçilir.</summary>
    string? Granularity = null);

/// <summary>Zaman serisindeki tek kova. Key sıralanabilir (yyyy-MM-dd / yyyy-MM), Label ekranda görünür.</summary>
public sealed record ReportPointDto(
    string Key,
    string Label,
    decimal Income,
    decimal Expense,
    decimal Net,
    decimal Sales,
    int Appointments,
    int CompletedAppointments,
    int NewCustomers);

/// <summary>Dönem + karşılaştırma değerini birlikte taşıyan tek metrik.</summary>
/// <param name="Unit">currency | count | percent — arayüz biçimlendirmeyi buna göre seçer.</param>
public sealed record ReportMetricDto(
    string Key,
    string Label,
    decimal Value,
    decimal PreviousValue,
    string Unit,
    string? Hint = null);

/// <summary>Pasta/donut ve sıralama listeleri için tek dilim.</summary>
public sealed record ReportSliceDto(string Key, string Label, decimal Amount, int Count);

/// <summary>Genel Bakış sekmesi: KPI'lar, zaman serisi ve dağılımlar.</summary>
public sealed record ReportSummaryDto(
    DateTime FromUtc,
    DateTime ToUtc,
    DateTime? CompareFromUtc,
    DateTime? CompareToUtc,
    string Granularity,
    IReadOnlyList<ReportMetricDto> Metrics,
    IReadOnlyList<ReportPointDto> Series,
    IReadOnlyList<ReportPointDto> CompareSeries,
    IReadOnlyList<ReportSliceDto> PaymentMethods,
    IReadOnlyList<ReportSliceDto> ExpenseCategories,
    /// <summary>Cironun kaynağı: hizmet / paket / ürün / ek kalem (onaylı adisyon kalemlerinden).</summary>
    IReadOnlyList<ReportSliceDto> RevenueSources,
    IReadOnlyList<ReportSliceDto> AppointmentStatuses,
    /// <summary>Haftanın günü × saat yoğunluğu (0=Pazartesi). Randevu adedi.</summary>
    IReadOnlyList<ReportHeatCellDto> Heatmap);

/// <summary>Yoğunluk haritası hücresi: haftanın günü (0=Pzt) × saat.</summary>
public sealed record ReportHeatCellDto(int DayOfWeek, int Hour, int Count);

// ---------------------------------------------------------------------------
// Çoklu dönem karşılaştırması
// ---------------------------------------------------------------------------

/// <summary>Karşılaştırmaya giren tek dönem isteği (ör. "2021" → 01.01.2021–01.01.2022).</summary>
public sealed record ComparePeriodRequest(string Label, DateTime FromUtc, DateTime ToUtc);

/// <summary>
/// Karşılaştırmadaki bir dönemin karnesi. <see cref="ReportMetricDto.PreviousValue"/> burada
/// <b>temel dönemin</b> (listedeki ilk dönem) değeridir — arayüz farkı ona göre gösterir.
/// </summary>
public sealed record ComparePeriodDto(
    string Key,
    string Label,
    DateTime FromUtc,
    DateTime ToUtc,
    int DayCount,
    /// <summary>Listedeki ilk dönem mi (fark hesabının referansı)?</summary>
    bool IsBaseline,
    IReadOnlyList<ReportMetricDto> Metrics,
    /// <summary>Kovalar dönem başından itibaren sıralıdır; farklı yılları üst üste bindirmek için.</summary>
    IReadOnlyList<ReportPointDto> Series,
    IReadOnlyList<ReportSliceDto> PaymentMethods,
    IReadOnlyList<ReportSliceDto> ExpenseCategories,
    /// <summary>Dönemde en çok uygulanan hizmetler (adet + ciro).</summary>
    IReadOnlyList<ReportSliceDto> TopServices,
    /// <summary>Dönemde en çok katkı yapan personel (adet + ciro).</summary>
    IReadOnlyList<ReportSliceDto> TopStaff);

public sealed record CompareReportDto(
    string Granularity,
    /// <summary>Ortak x ekseni etiketleri — temel dönemin kovalarından türetilir.</summary>
    IReadOnlyList<string> AxisLabels,
    IReadOnlyList<ComparePeriodDto> Periods);

// ---------------------------------------------------------------------------
// Paket & hizmet detay raporu
// ---------------------------------------------------------------------------

/// <summary>"Kim sattı" satırı — satışı yapan personel/yönetici.</summary>
public sealed record ReportSellerDto(
    Guid? StaffMemberId,
    string StaffName,
    int SoldCount,
    int CustomerCount,
    decimal Amount);

/// <summary>"Kim yaptı" satırı — seansı uygulayan personel (tamamlanan randevulardan).</summary>
public sealed record ReportPerformerDto(
    Guid? StaffMemberId,
    string StaffName,
    int SessionCount,
    int CustomerCount,
    decimal Revenue);

/// <summary>Katalog kaleminin (paket ya da hizmet) dönemsel satış + uygulama karnesi.</summary>
public sealed record CatalogItemReportDto(
    Guid Id,
    string Name,
    string Category,
    string? SubCategory,
    /// <summary>Dönemde kaç kez satıldı (satış örneği adedi).</summary>
    int SoldCount,
    int CustomerCount,
    /// <summary>Dönemde satılan tutar (satış toplamından bu kaleme düşen pay).</summary>
    decimal GrossAmount,
    /// <summary>Bu satışlara karşı bugüne dek tahsil edilen.</summary>
    decimal CollectedAmount,
    /// <summary>Kalan (tahsil edilmemiş) tutar.</summary>
    decimal RemainingAmount,
    int SessionsTotal,
    int SessionsUsed,
    int SessionsRemaining,
    /// <summary>Dönem içinde fiilen YAPILAN seans (tamamlanan randevu) adedi.</summary>
    int SessionsInPeriod,
    /// <summary>Dönemde yapılan randevuların cirosu.</summary>
    decimal SessionRevenue,
    /// <summary>Uygulamayı yapan personelin prim maliyeti (komisyon oranından hesaplanır).</summary>
    decimal CommissionCost,
    /// <summary>Uygulama cirosundan prim düşülmüş net (hizmet kârlılığı).</summary>
    decimal NetRevenue,
    int CancelledCount,
    decimal CancelledAmount,
    IReadOnlyList<ReportSellerDto> Sellers,
    IReadOnlyList<ReportPerformerDto> Performers);

/// <summary>Paket/hizmet blokları için toplam satırı (karşılaştırma da aynı tipte döner).</summary>
public sealed record CatalogTotalsDto(
    int SoldCount,
    int CustomerCount,
    decimal GrossAmount,
    decimal CollectedAmount,
    decimal RemainingAmount,
    int SessionsTotal,
    int SessionsUsed,
    int SessionsRemaining,
    int SessionsInPeriod,
    decimal SessionRevenue,
    decimal CommissionCost,
    decimal NetRevenue,
    int CancelledCount,
    decimal CancelledAmount);

public sealed record CatalogReportDto(
    IReadOnlyList<CatalogItemReportDto> Packages,
    IReadOnlyList<CatalogItemReportDto> Services,
    IReadOnlyList<ReportSliceDto> PackageCategories,
    IReadOnlyList<ReportSliceDto> ServiceCategories,
    IReadOnlyList<ReportSellerDto> TopSellers,
    IReadOnlyList<ReportPerformerDto> TopPerformers,
    CatalogTotalsDto PackageTotals,
    CatalogTotalsDto PackageTotalsPrevious,
    CatalogTotalsDto ServiceTotals,
    CatalogTotalsDto ServiceTotalsPrevious);

// ---------------------------------------------------------------------------
// Personel performansı
// ---------------------------------------------------------------------------

public sealed record StaffReportRowDto(
    Guid StaffMemberId,
    string StaffName,
    string Title,
    Guid? BranchId,
    string? BranchName,
    int AppointmentCount,
    int CompletedCount,
    int CancelledCount,
    int NoShowCount,
    int CustomerCount,
    /// <summary>Tamamlanan randevuların cirosu (uygulama cirosu).</summary>
    decimal ServiceRevenue,
    /// <summary>Sattığı paket/hizmet tutarı (satış cirosu).</summary>
    decimal SalesAmount,
    int SalesCount,
    decimal CommissionEarned,
    decimal CommissionPaid,
    decimal CommissionRate,
    /// <summary>Çalışılan dakika (tamamlanan randevu süreleri).</summary>
    int WorkedMinutes,
    double AverageRating,
    int RatingCount,
    decimal PreviousServiceRevenue,
    decimal PreviousSalesAmount,
    int PreviousCompletedCount);

public sealed record StaffReportDto(
    IReadOnlyList<StaffReportRowDto> Rows,
    decimal TotalServiceRevenue,
    decimal TotalSalesAmount,
    decimal TotalCommission,
    int TotalAppointments,
    int TotalCompleted,
    int TotalWorkedMinutes,
    decimal PreviousTotalServiceRevenue,
    decimal PreviousTotalSalesAmount,
    int PreviousTotalCompleted);

// ---------------------------------------------------------------------------
// Şube karşılaştırma
// ---------------------------------------------------------------------------

public sealed record BranchReportRowDto(
    Guid BranchId,
    string BranchName,
    string City,
    decimal Income,
    decimal Expense,
    decimal Net,
    decimal PreviousIncome,
    decimal PreviousExpense,
    decimal PreviousNet,
    /// <summary>Dönemde yapılan satış tutarı (cari + adisyon).</summary>
    decimal SalesAmount,
    /// <summary>Açık alacak (kalan taksit).</summary>
    decimal Receivable,
    int AppointmentCount,
    int CompletedCount,
    int CustomerCount,
    int NewCustomerCount,
    int StaffCount,
    decimal AverageTicket,
    decimal ProfitMargin,
    IReadOnlyList<ReportPointDto> Series);

public sealed record BranchReportDto(
    IReadOnlyList<BranchReportRowDto> Rows,
    decimal TotalIncome,
    decimal TotalExpense,
    decimal TotalNet,
    decimal PreviousTotalIncome,
    decimal PreviousTotalExpense,
    decimal PreviousTotalNet,
    string Granularity,
    /// <summary>Üst menüde tek şube seçili olduğu için rapor o şubeye daraldıysa true.</summary>
    bool ScopedToSingleBranch);

// ---------------------------------------------------------------------------
// Müşteri analitiği
// ---------------------------------------------------------------------------

public sealed record CustomerReportRowDto(
    Guid CustomerId,
    string FullName,
    string Phone,
    int VisitCount,
    decimal Spent,
    decimal Debt,
    DateTime? LastVisitUtc,
    bool IsVip,
    bool KvkkConsent,
    string? BranchName);

public sealed record CustomerReportDto(
    int TotalCustomers,
    int NewCustomers,
    int ActiveCustomers,
    int ReturningCustomers,
    int OneTimeCustomers,
    int LostCustomers,
    int VipCount,
    int BlacklistedCount,
    int KvkkApproved,
    decimal TotalSpent,
    decimal AverageSpent,
    decimal TotalDebt,
    decimal RetentionRate,
    int PreviousNewCustomers,
    int PreviousActiveCustomers,
    decimal PreviousTotalSpent,
    IReadOnlyList<ReportSliceDto> AgeSegments,
    IReadOnlyList<ReportSliceDto> GenderSlices,
    IReadOnlyList<ReportSliceDto> VisitFrequency,
    IReadOnlyList<ReportPointDto> Series,
    IReadOnlyList<CustomerReportRowDto> TopCustomers);

// ---------------------------------------------------------------------------
// Stok / ürün + hediye çeki
// ---------------------------------------------------------------------------

public sealed record ProductReportRowDto(
    Guid ProductId,
    string Name,
    string Category,
    string? Brand,
    decimal SoldQuantity,
    decimal SoldAmount,
    decimal CostAmount,
    decimal Profit,
    decimal UsedQuantity,
    decimal CurrentStock,
    decimal MinStockLevel,
    bool IsCritical,
    decimal StockValue);

public sealed record GiftCardReportRowDto(
    Guid Id,
    string Code,
    string Kind,
    decimal Value,
    decimal Balance,
    decimal UsedAmount,
    int UsedCount,
    int MaxUses,
    bool IsActive,
    DateTime? ValidUntilUtc,
    string? CustomerName);

public sealed record InventoryReportDto(
    int ProductCount,
    int CriticalCount,
    int OutOfStockCount,
    decimal StockValueAtCost,
    decimal StockValueAtSale,
    decimal SoldQuantity,
    decimal SoldAmount,
    decimal SoldCost,
    decimal SoldProfit,
    decimal UsedQuantity,
    decimal DamagedQuantity,
    decimal PurchasedAmount,
    decimal PreviousSoldAmount,
    decimal PreviousSoldProfit,
    IReadOnlyList<ProductReportRowDto> Products,
    IReadOnlyList<ReportSliceDto> Categories,
    IReadOnlyList<ReportSliceDto> MovementTypes,
    IReadOnlyList<ReportPointDto> Series,
    int GiftCardIssuedCount,
    decimal GiftCardIssuedValue,
    decimal GiftCardRedeemedValue,
    decimal GiftCardOutstanding,
    int GiftCardActiveCount,
    int GiftCardExpiredCount,
    IReadOnlyList<GiftCardReportRowDto> GiftCards);

using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.CustomerAccounts;

public sealed record InstallmentDto(
    Guid Id,
    int No,
    DateOnly DueDate,
    decimal Amount,
    decimal PaidAmount,
    InstallmentStatus Status,
    DateTime? PaidAtUtc);

public sealed record AccountPaymentDto(
    Guid Id,
    decimal Amount,
    string? Method,
    string? Reference,
    DateTime OccurredAtUtc);

public sealed record CustomerAccountDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid CustomerId,
    string? CustomerName,
    string? CustomerPhone,
    Guid? ServicePackageId,
    string? ServicePackageName,
    string Name,
    decimal TotalAmount,
    decimal DepositAmount,
    decimal PaidAmount,
    decimal RemainingAmount,
    decimal CreditBalance,
    bool IsActive,
    string? Notes,
    IReadOnlyCollection<InstallmentDto> Installments,
    IReadOnlyCollection<AccountPaymentDto> Payments,
    decimal AppointmentRevenue,
    int CompletedAppointmentCount,
    DateTime CreatedAtUtc,
    // --- satış kimliği (müşteri kartındaki "Paket & Hizmet Satışları" paneli) ---
    /// <summary>Satışın gerçekte yapıldığı tarih (geçmiş kayıtlarda geçmiş bir tarih).</summary>
    DateTime SoldAtUtc = default,
    Guid? SoldByStaffMemberId = null,
    string? SoldByStaffName = null,
    /// <summary>Yazılıma geçmeden önceki satışın elle girilmiş kaydı.</summary>
    bool IsHistorical = false,
    DateTime? CancelledAtUtc = null,
    string? CancellationReason = null,
    // --- seans durumu (paket bitti mi?) ---
    int SessionsTotal = 0,
    int SessionsUsed = 0,
    int SessionsRemaining = 0,
    /// <summary>Satış kalemleri: hizmet adı + tutarı (detay modalindeki küçük kart).</summary>
    IReadOnlyCollection<CustomerAccountItemDto>? Items = null,
    /// <summary>Aktif · Tamamlandı · İptal — panelde rozet olarak gösterilir.</summary>
    string SaleStatus = "Active");

/// <summary>Satıştaki tek kalem: hizmet adı, tutarı ve seans durumu.</summary>
public sealed record CustomerAccountItemDto(
    Guid? ServiceDefinitionId,
    string Name,
    decimal Amount,
    int SessionsTotal,
    int SessionsUsed);

/// <summary>
/// GEÇMİŞ SATIŞ kaydı: yazılıma geçmeden önce (geçmiş yıllarda) yapılmış paket/hizmet satışının
/// sisteme elle girilmesi. Satış tarihi, satan personel, tahsil edilmiş tutar, kalan taksitler ve
/// kullanılmış seanslar birlikte verilir — böylece geçmiş de kartta görünür.
/// </summary>
public sealed record CreateHistoricalSaleRequest(
    Guid CustomerId,
    string Name,
    DateTime SoldAtUtc,
    decimal TotalAmount,
    decimal PaidAmount,
    Guid? SoldByStaffMemberId = null,
    Guid? ServicePackageId = null,
    Guid? ServiceDefinitionId = null,
    int SessionsTotal = 0,
    int SessionsUsed = 0,
    int InstallmentCount = 0,
    DateOnly? FirstDueDate = null,
    string? Notes = null,
    Guid? BranchId = null);

/// <summary>Satış iptali + gerekçesi.</summary>
public sealed record CancelSaleRequest(string? Reason);

public sealed record CreateCustomerAccountRequest(
    Guid? BranchId,
    Guid CustomerId,
    Guid? ServicePackageId,
    string Name,
    decimal TotalAmount,
    decimal DepositAmount,
    int InstallmentCount,
    DateOnly FirstDueDate,
    string? Notes);

public sealed record UpdateCustomerAccountRequest(
    string Name,
    decimal TotalAmount,
    decimal DepositAmount,
    bool IsActive,
    string? Notes);

public sealed record RescheduleAccountRequest(int InstallmentCount, DateOnly FirstDueDate);

public sealed record RegisterAccountPaymentRequest(decimal Amount, string? Method, string? Reference, DateTime? OccurredAtUtc);

public sealed record CustomerPackageSessionDto(
    Guid Id,
    Guid CustomerAccountId,
    Guid ServicePackageId,
    Guid ServiceDefinitionId,
    string ServiceName,
    int TotalSessions,
    int UsedSessions,
    int RemainingSessions);

/// <summary>Bir takvim ayında vadesi gelen taksitlerin özeti (genel rapor için).</summary>
public sealed record AccountMonthlyInstallmentDto(
    int Year,
    int Month,
    decimal Due,        // O ay vadesi gelen taksit toplamı (plan tutarı)
    decimal Collected,  // O aya dağıtılan tahsilat
    decimal Remaining); // Kalan (Due − Collected)

/// <summary>
/// Kurum yöneticisi panosu "Genel Rapor" özeti: paket satışı, yapılacak seans,
/// toplam alınacak taksit ve ay ay taksit takvimi. Tek sorguda hesaplanır.
/// </summary>
public sealed record AccountReportDto(
    int PackageSalesCount,      // Satılan TOPLAM paket adedi (doğrudan cari + onaylı adisyon paket satışları)
    int CustomersWithPackages,  // Paket satın almış benzersiz müşteri sayısı
    // Aşağıdaki iki alan dönem filtresine BAĞLI DEĞİLDİR ve ikisi de KATALOĞU sayar.
    int CatalogPackageCount,    // "Toplam Paket" — kurumda tanımlı paket adedi (Paketler sayfasıyla aynı)
    int PackagesInUseCount,     // "Aktif Paket"  — bunlardan kaç çeşidinin seansı süren satışı var
    int TotalAccounts,
    int ActiveAccounts,
    int SessionsTotal,          // Satılan toplam seans
    int SessionsUsed,           // Kullanılan (yapılan) seans
    int SessionsRemaining,      // Yapılacak (kalan) seans
    decimal TotalReceivable,    // Tüm carilerde kalan taksit toplamı (toplam alınacak)
    decimal TotalCollected,     // Taksitlere dağıtılan toplam tahsilat (= takvimdeki "tahsil edildi" toplamı)
    decimal OverdueAmount,      // Vadesi geçmiş kalan taksit toplamı
    decimal CollectedThisMonth, // Bu takvim ayında alınan tahsilat
    IReadOnlyList<AccountMonthlyInstallmentDto> MonthlyInstallments,
    IReadOnlyList<PackageCategoryBreakdownDto> Categories,   // Kategori → hizmet kırılımı
    IReadOnlyList<PackageCustomerBreakdownDto> Customers);   // Müşteri bazlı taksit/ödeme/seans kırılımı

/// <summary>
/// "Kim sattı" kırılımı — satışı yapan personel bazında adet/seans/tutar.
/// Personel atanmamış (eski/otomatik) satışlar StaffMemberId null ile "Belirtilmemiş" altında toplanır.
/// </summary>
public sealed record PackageSellerDto(
    Guid? StaffMemberId,
    string StaffName,
    int SoldCount,
    int CustomerCount,
    int SessionsTotal,
    decimal Amount);

/// <summary>Kategori kırılımındaki tek hizmet satırı (satılan seans ve tutar payı).</summary>
public sealed record PackageCategoryServiceDto(
    Guid ServiceDefinitionId,
    string ServiceName,
    int SoldCount,          // Bu hizmeti içeren satış (cari) adedi
    int CustomerCount,      // Bu hizmeti satın alan benzersiz müşteri
    int SessionsTotal,
    int SessionsUsed,
    int SessionsRemaining,
    decimal Amount,         // Satış tutarından bu hizmete düşen pay
    IReadOnlyList<PackageSellerDto> Sellers);

/// <summary>Paket satışlarının hizmet kategorisine göre kırılımı.</summary>
public sealed record PackageCategoryBreakdownDto(
    string Category,        // "Kategorisiz" = hizmette kategori tanımlı değil
    int SoldCount,
    int CustomerCount,
    int SessionsTotal,
    int SessionsUsed,
    int SessionsRemaining,
    decimal Amount,
    IReadOnlyList<PackageCategoryServiceDto> Services,
    IReadOnlyList<PackageSellerDto> Sellers);   // Bu kategoriyi kim sattı

/// <summary>Bir müşterinin dönemdeki paket satışları: taksit, tahsilat ve seans durumu.</summary>
public sealed record PackageCustomerBreakdownDto(
    Guid CustomerId,
    string CustomerName,
    int AccountCount,           // Cari (satış) adedi
    IReadOnlyList<string> PackageNames,
    int InstallmentCount,       // İptal edilmemiş taksit adedi
    int PaidInstallmentCount,   // Tamamı tahsil edilmiş taksit adedi
    int OverdueInstallmentCount,
    decimal TotalAmount,        // Satış toplamı
    decimal PaidAmount,         // Taksitlere dağıtılan tahsilat
    decimal RemainingAmount,    // Kalan taksit borcu
    decimal OverdueAmount,
    DateOnly? NextDueDate,      // Sıradaki ödenmemiş taksit vadesi
    decimal NextDueAmount,
    int SessionsTotal,
    int SessionsUsed,
    int SessionsRemaining,
    IReadOnlyList<PackageSellerDto> Sellers);   // Bu müşteriye kim satmış

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
    /// <summary>Geçmiş satışta seansları uygulayan personel ("kim yaptı").</summary>
    Guid? AppliedByStaffMemberId = null,
    string? AppliedByStaffName = null,
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
    Guid? BranchId = null,
    /// <summary>
    /// Geçmiş satışın taksitlerinden KAÇININ ödendiği (vade sırasıyla). Verildiğinde taksit planı
    /// TOPLAM tutar üzerinden kurulur ve ödenmiş her ay, KENDİ VADE TARİHİYLE tahsilat olarak
    /// yazılır — böylece geçmiş satış, geçmiş cari/tahsilat dökümünde de görünür.
    /// <c>null</c> ise eski davranış korunur (ödenen tutar peşinat sayılır, taksitler kalan borcu böler).
    /// </summary>
    int? PaidInstallmentCount = null,
    /// <summary>Geçmiş tahsilatın yöntemi (cash/card/transfer) — ödeme dökümünde görünsün.</summary>
    string? PaymentMethod = null,
    /// <summary>Kullanılmış seansları uygulayan personel ("seansı kim yaptı").</summary>
    Guid? AppliedByStaffMemberId = null,
    /// <summary>
    /// true ise kullanılmış seanslar için TAMAMLANMIŞ geçmiş randevu kaydı da açılır — geçmiş
    /// seanslar randevular sayfasında/müşteri kartında görünür. Fiyat 0 yazılır: satış tutarı
    /// zaten caride, randevuya da yazılsa ciro iki kez sayılırdı.
    /// </summary>
    bool CreateSessionAppointments = false,
    /// <summary>Geçmiş randevular arasındaki gün aralığı (varsayılan 15).</summary>
    int SessionIntervalDays = 15);

/// <summary>
/// Satış iptali. İptalde cari kaydı (taksit/tahsilat/seans dahil) canlı tablolardan silinip
/// <c>cancelled_sales</c> arşivine taşınır.
/// </summary>
/// <param name="Reason">İptal gerekçesi (müşteri vazgeçti, paket iadesi vb.).</param>
/// <param name="RefundedAmount">
/// Tahsil edilmiş paradan müşteriye GERİ ÖDENEN kısım. Kısmi iade desteklenir.
/// null/0 → para kurumda kaldı. Pozitifse gerçek bir kasa çıkışı (<c>refund_transactions</c>)
/// yazılır ve kasa akışı/kâr-zarar bu tutarı gider olarak görür.
/// Negatif ya da tahsil edileni AŞAN değer sessizce kırpılmaz — doğrulama hatası döner.
/// </param>
/// <param name="RefundMethod">İadenin yapıldığı yöntem: cash / card / transfer. Boşsa nakit sayılır.</param>
public sealed record CancelSaleRequest(string? Reason, decimal? RefundedAmount = null, string? RefundMethod = null);

/// <summary>Satış iptalini geri alma isteği.</summary>
/// <param name="VoidRefund">
/// İptalde girilen iade FİİLEN YAPILMAMIŞSA (yanlış kayıt) true gönderilir: kasa çıkışı kaydı da
/// geri alınır. Varsayılan false — para gerçekten müşteriye ödendiyse o kasa hareketi yerinde kalır.
/// Geçmişteki bir ödemeyi bugünkü bir düzeltme yüzünden raporlardan silmek mali izi bozardı.
/// </param>
/// <param name="AllowLegacySnapshot">
/// Eski (v1) yedekler adisyon durumunu ve iptalde değiştirilen prim/sadakat kayıtlarını taşımaz;
/// otomatik geri alma bunları yanlış kurabilir. Yönetici kontrol edip onayladığında true gönderilir.
/// </param>
/// <param name="VoidReason">
/// <c>VoidRefund</c> true iken ZORUNLU: gerçekleşmiş bir kasa çıkışı yok ediliyor, denetim izinde
/// niçin yapıldığı yazmalı.
/// </param>
public sealed record RestoreSaleRequest(
    bool VoidRefund = false,
    bool AllowLegacySnapshot = false,
    string? VoidReason = null);

/// <summary>
/// Arşivdeki iptal edilmiş satış. Canlı cari listesinde YER ALMAZ — "İptal Edilenler" ekranı
/// bu kayıtları ayrı okur. <see cref="CollectedAmount"/> iptal anında tahsil edilmiş olan paradır.
/// </summary>
public sealed record CancelledSaleDto(
    Guid Id,
    Guid OriginalAccountId,
    Guid TenantId,
    Guid? BranchId,
    Guid CustomerId,
    string? CustomerName,
    string? CustomerPhone,
    Guid? ServicePackageId,
    string Name,
    decimal TotalAmount,
    decimal DepositAmount,
    /// <summary>İptal anında müşteriden fiilen tahsil edilmiş toplam.</summary>
    decimal CollectedAmount,
    /// <summary>Bunun müşteriye geri ödenen kısmı.</summary>
    decimal RefundedAmount,
    /// <summary>
    /// Kurumda kalan nakit (tahsil edilen − iade edilen).
    /// <para>
    /// Gelir raporlarında da bu tutar kalır: iptalde tahsilat satırları canlı tablodan silinir ama
    /// kalıcı kopyaları <c>archived_sale_payments</c>'a taşınır (kasa akışı/kâr-zarar oradan okur),
    /// iade edilen kısım ise <c>refund_transactions</c> ile gider yazılır. Net etki = kurumda kalan.
    /// </para>
    /// </summary>
    decimal RetainedAmount,
    DateTime SoldAtUtc,
    Guid? SoldByStaffMemberId,
    string? SoldByStaffName,
    bool IsHistorical,
    int SessionsTotal,
    int SessionsUsed,
    Guid? AdisyonId,
    DateTime CancelledAtUtc,
    string? CancellationReason);

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

/// <param name="SourceAdisyonId">
/// Tahsilatı doğuran adisyon (varsa). Reference ŞİFRELİ olduğu için kaynak eşleştirmesi bu
/// deterministik alanla yapılır — adisyon silinirken tahsilat bu sayede bulunur.
/// </param>
public sealed record RegisterAccountPaymentRequest(decimal Amount, string? Method, string? Reference, DateTime? OccurredAtUtc, Guid? SourceAdisyonId = null);

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
    int PackageSalesCount,      // "Satılan Toplam Paket" — dönemde satılan paket adedi (cari + adisyon)
    int CustomersWithPackages,  // Paket satın almış benzersiz müşteri sayısı
    int ActiveSoldPackageCount, // "Aktif Paket" — satılanlardan seansı hâlâ devam eden adet
    int CancelledSoldPackageCount, // "İptal Edilen" — satılmış ama sonradan iptal edilmiş satış adedi
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
/// Pano "Hizmet Raporu" kartları. Paket raporundan TAMAMEN AYRIDIR: buradaki kategori HİZMETİN
/// kategorisidir ve sayılan şey hizmettir, paket değil. Dönem + kategori birlikte uygulanır.
/// </summary>
public sealed record ServiceReportDto(
    int ServiceSalesCount,          // "Toplam Hizmet" — dönemde satılan hizmet adedi
    int ActiveSoldServiceCount,     // "Aktif Hizmet"  — satılanlardan seansı hâlâ devam eden adet
    int CancelledSoldServiceCount,  // "İptal Edilen"  — satılmış ama sonradan iptal edilmiş adet
    int SessionsTotal,
    int SessionsUsed,
    int SessionsRemaining,
    decimal Revenue);          // Dönemde satılan hizmetlerin tutarı (satış toplamından dağıtılır)

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

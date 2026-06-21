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
    DateTime CreatedAtUtc);

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
    int TotalAccounts,
    int ActiveAccounts,
    int SessionsTotal,          // Satılan toplam seans
    int SessionsUsed,           // Kullanılan (yapılan) seans
    int SessionsRemaining,      // Yapılacak (kalan) seans
    decimal TotalReceivable,    // Tüm carilerde kalan taksit toplamı (toplam alınacak)
    decimal TotalCollected,     // Taksitlere dağıtılan toplam tahsilat (= takvimdeki "tahsil edildi" toplamı)
    decimal OverdueAmount,      // Vadesi geçmiş kalan taksit toplamı
    decimal CollectedThisMonth, // Bu takvim ayında alınan tahsilat
    IReadOnlyList<AccountMonthlyInstallmentDto> MonthlyInstallments);

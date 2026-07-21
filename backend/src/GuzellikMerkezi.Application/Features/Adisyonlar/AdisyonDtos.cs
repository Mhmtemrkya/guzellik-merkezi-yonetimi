using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Adisyonlar;

public sealed record AdisyonItemDto(
    Guid Id,
    AdisyonItemType Type,
    Guid? RefId,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    decimal LineTotal,
    Guid? StaffMemberId,
    string? StaffName,
    bool CoveredByPackage,
    DateTime CreatedAtUtc);

public sealed record AdisyonDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    Guid CustomerId,
    string? CustomerName,
    Guid? CustomerAccountId,
    AdisyonStatus Status,
    DateTime OpenedAtUtc,
    DateTime? ApprovedAtUtc,
    string? Notes,
    decimal ChargeTotal,
    decimal PaymentTotal,
    int PlannedInstallmentCount,
    DateOnly? PlannedFirstDueDate,
    // Faz 2: true ise satış cariye şimdi işlenmedi; müşterinin ilk randevusu tamamlanınca otomatik işlenir.
    bool AutoApproveOnFirstAppointment,
    IReadOnlyCollection<AdisyonItemDto> Items);

public sealed record CreateAdisyonRequest(
    Guid? BranchId,
    Guid CustomerId,
    Guid? CustomerAccountId,
    string? Notes,
    int? InstallmentCount = null,
    DateOnly? FirstDueDate = null,
    // true = mevcut açık fişi yeniden KULLANMA, her seferinde YENİ adisyon aç (satış = kendi adisyonu).
    bool ForceNew = false,
    // Faz 2: true = satış cariye şimdi işlenmez; müşterinin ilk randevusu tamamlanınca otomatik işlenir.
    bool AutoApproveOnFirstAppointment = false);

public sealed record AddAdisyonItemRequest(
    AdisyonItemType Type,
    Guid? RefId,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? StaffMemberId,
    bool CoveredByPackage);

public sealed record UpdateAdisyonRequest(
    Guid? CustomerAccountId,
    string? Notes,
    int? InstallmentCount = null,
    DateOnly? FirstDueDate = null,
    // Faz 2: null = değiştirme; değer verilirse "ilk randevu tamamlanınca otomatik işle" bayrağını günceller.
    bool? AutoApproveOnFirstAppointment = null);

/// <summary>Adisyona hediye çeki / kupon kodu uygula (indirim kalemi eklenir, onayda redeem edilir).</summary>
public sealed record ApplyAdisyonGiftCardRequest(string Code);

/// <summary>Günlük adisyon kartında tek bir satır (bir hizmet/ürün işlemi veya bir tahsilat).</summary>
public sealed record DailyAdisyonRowDto(
    Guid AdisyonId,
    Guid ItemId,
    DateTime OccurredAtUtc,
    Guid CustomerId,
    string? CustomerName,
    AdisyonItemType Type,
    string Description,
    decimal Quantity,
    decimal Amount,
    Guid? StaffMemberId,
    string? StaffName,
    AdisyonStatus AdisyonStatus);

/// <summary>Bir günün adisyon aktivitesi: kime ne yapıldı (saatli), kim yaptı, tahsilatlar ve gün toplamları.</summary>
public sealed record DailyAdisyonDto(
    DateTime FromUtc,
    DateTime ToUtc,
    IReadOnlyCollection<DailyAdisyonRowDto> Rows,
    int ServiceCount,
    int PaymentCount,
    int CustomerCount,
    decimal ChargeTotal,
    decimal PaymentTotal);

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
    IReadOnlyCollection<AdisyonItemDto> Items);

public sealed record CreateAdisyonRequest(
    Guid? BranchId,
    Guid CustomerId,
    Guid? CustomerAccountId,
    string? Notes,
    int? InstallmentCount = null,
    DateOnly? FirstDueDate = null);

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
    DateOnly? FirstDueDate = null);

/// <summary>Adisyona hediye çeki / kupon kodu uygula (indirim kalemi eklenir, onayda redeem edilir).</summary>
public sealed record ApplyAdisyonGiftCardRequest(string Code);

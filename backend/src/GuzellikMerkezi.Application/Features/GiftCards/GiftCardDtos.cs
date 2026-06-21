using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.GiftCards;

public sealed record GiftCardDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    string Code,
    GiftCardKind Kind,
    decimal Value,
    decimal Balance,
    DateTime? ValidUntilUtc,
    int MaxUses,
    int UsedCount,
    bool IsActive,
    string? Note,
    Guid? CustomerId,
    bool IsValid);

/// <summary>Kod boş bırakılırsa sunucu benzersiz bir kod üretir.</summary>
public sealed record CreateGiftCardRequest(
    string? Code,
    GiftCardKind Kind,
    decimal Value,
    DateTime? ValidUntilUtc,
    int MaxUses,
    string? Note,
    Guid? CustomerId,
    Guid? BranchId);

public sealed record RedeemGiftCardRequest(decimal Amount);

public sealed record SetGiftCardActiveRequest(bool Active);

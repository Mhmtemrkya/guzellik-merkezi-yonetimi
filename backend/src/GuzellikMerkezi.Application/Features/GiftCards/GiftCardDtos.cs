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
    DateTime? ValidFromUtc,
    DateTime? ValidUntilUtc,
    int MaxUses,
    int UsedCount,
    bool IsActive,
    string? Note,
    Guid? CustomerId,
    /// <summary>Basılı kartta "geçerli ... çekidir" satırında yazan kapsam (serbest metin).</summary>
    string? ScopeLabel,
    /// <summary>Çekin bağlandığı hizmet (varsa) — satış ekranı bunu otomatik seçer.</summary>
    Guid? ServiceDefinitionId,
    /// <summary>Çekin bağlandığı paket (varsa).</summary>
    Guid? ServicePackageId,
    /// <summary>Kartın üzerine basılan alıcı adı; boşsa elle yazılmak üzere boş bırakılır.</summary>
    string? RecipientName,
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
    Guid? BranchId,
    DateTime? ValidFromUtc = null,
    string? ScopeLabel = null,
    string? RecipientName = null,
    Guid? ServiceDefinitionId = null,
    Guid? ServicePackageId = null);

/// <summary>QR okutularak çekin bir müşteriye bağlanması.</summary>
public sealed record AssignGiftCardCustomerRequest(
    string Code,
    Guid CustomerId,
    /// <summary>Kart başka müşteriye bağlıysa devretmeye izin ver (kullanıcı onayı sonrası).</summary>
    bool AllowReassign = false);

/// <summary>
/// Hediye kartındaki QR okutulunca gösterilen HALKA AÇIK görünüm.
///
/// KASITLI OLARAK DARDIR: iç kayıt notu, müşteri kimliği, şube ve kullanım sayısı buraya GİRMEZ —
/// bu uç kimlik doğrulamasızdır ve kartı eline geçiren herkese açıktır.
/// </summary>
public sealed record PublicGiftCardDto(
    string Code,
    string SalonName,
    GiftCardKind Kind,
    decimal Amount,
    DateTime? ValidFromUtc,
    DateTime? ValidUntilUtc,
    string? ScopeLabel,
    bool IsValid,
    string? InvalidReason);

public sealed record RedeemGiftCardRequest(decimal Amount);

public sealed record SetGiftCardActiveRequest(bool Active);

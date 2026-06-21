using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Loyalty;

public interface ILoyaltyService
{
    Task<Result<LoyaltyBalanceDto>> GetBalanceAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);

    /// <summary>Manuel puan ekleme/düşme (pozitif kazanım, negatif kullanım).</summary>
    Task<Result<LoyaltyBalanceDto>> AdjustAsync(Guid tenantId, AdjustLoyaltyRequest request, CancellationToken cancellationToken = default);
}

/// <summary>Sadakat puan kuralları (sabit MVP — ileride tenant ayarı).</summary>
public static class LoyaltyRules
{
    /// <summary>Her bu kadar ₺ tahsilat 1 puan kazandırır.</summary>
    public const decimal TryPerPoint = 10m;

    public static int EarnedFor(decimal paidAmount) => paidAmount <= 0 ? 0 : (int)Math.Floor(paidAmount / TryPerPoint);
}

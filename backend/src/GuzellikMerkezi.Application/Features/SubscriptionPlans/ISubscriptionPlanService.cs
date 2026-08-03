using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.SubscriptionPlans;

public interface ISubscriptionPlanService
{
    Task<Result<IReadOnlyList<SubscriptionPlanDto>>> ListAsync(CancellationToken ct = default);
    Task<Result<SubscriptionPlanDto>> GetAsync(Guid id, CancellationToken ct = default);
    Task<Result<SubscriptionPlanDto>> GetByKeyAsync(string planKey, CancellationToken ct = default);
    Task<Result<SubscriptionPlanDto>> CreateAsync(CreateSubscriptionPlanRequest req, CancellationToken ct = default);
    Task<Result<SubscriptionPlanDto>> UpdateAsync(Guid id, UpdateSubscriptionPlanRequest req, CancellationToken ct = default);
    Task<Result> DeleteAsync(Guid id, CancellationToken ct = default);
    /// <summary>
    /// Kuruma paket atar / aboneliği başlatır.
    /// </summary>
    /// <param name="selfService">
    /// İstek kurumun KENDİ kullanıcısından geliyorsa true. Bu durumda ücretli pakete geçiş
    /// reddedilir (ödeme alınmadan abonelik başlatılamaz); talep denetim kaydına yazılır.
    /// Platform admin atamalarında false.
    /// </param>
    Task<Result> AssignToTenantAsync(Guid tenantId, Guid subscriptionPlanId, BillingPeriod period, CancellationToken ct = default, bool selfService = false);
}

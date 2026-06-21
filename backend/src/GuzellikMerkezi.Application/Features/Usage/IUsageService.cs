using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Usage;

public interface IUsageService
{
    Task<Result<TenantUsageDto>> GetTenantUsageAsync(Guid tenantId, CancellationToken ct = default);
    Task<Result<PlatformUsageSummaryDto>> GetPlatformSummaryAsync(CancellationToken ct = default);

    /// <summary>
    /// Belirtilen metrik için tenant'ın paket limitini aşıp aşmadığını kontrol eder.
    /// Plan yoksa, paket pasifse veya limit -1 (sınırsız) ise her zaman <see cref="Result.Success()"/> döner.
    /// Limit doluysa <see cref="Result.Failure(Error)"/> döner; çağıran servis bunu HTTP 409 (Conflict) olarak iletir.
    /// </summary>
    /// <param name="metricKey">Geçerli anahtarlar: "branches", "staff", "customers", "appointments", "sms"</param>
    Task<Result> CheckLimitAsync(Guid tenantId, string metricKey, CancellationToken ct = default);
}

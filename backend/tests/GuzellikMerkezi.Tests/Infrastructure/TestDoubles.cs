using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Usage;

namespace GuzellikMerkezi.Tests.Infrastructure;

internal sealed class AlwaysAllowUsageService : IUsageService
{
    public Task<Result<TenantUsageDto>> GetTenantUsageAsync(Guid tenantId, CancellationToken ct = default) =>
        Task.FromResult(Result<TenantUsageDto>.Success(new TenantUsageDto(
            tenantId,
            "Test Tenant",
            null,
            null,
            null,
            0m,
            Array.Empty<UsageMetric>())));

    public Task<Result<PlatformUsageSummaryDto>> GetPlatformSummaryAsync(CancellationToken ct = default) =>
        Task.FromResult(Result<PlatformUsageSummaryDto>.Success(new PlatformUsageSummaryDto(
            0,
            0,
            0,
            0,
            0m,
            0,
            0,
            Array.Empty<PlanUsageBreakdown>(),
            Array.Empty<TenantUsageDto>())));

    public Task<Result> CheckLimitAsync(Guid tenantId, string metricKey, CancellationToken ct = default) =>
        Task.FromResult(Result.Success());
}

internal sealed class NoopAuditLogger : IAuditLogger
{
    public Task LogAsync(
        Guid? tenantId,
        Guid? branchId,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        CancellationToken ct = default) => Task.CompletedTask;

    public Task LogActorAsync(
        Guid? tenantId,
        Guid? branchId,
        Guid? actorUserId,
        string? actorName,
        string? actorRole,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        string? ipAddress = null,
        CancellationToken ct = default) => Task.CompletedTask;
}

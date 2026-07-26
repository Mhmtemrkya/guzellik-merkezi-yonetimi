using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;

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

/// <summary>Kuyruğa yazılan işleri bellekte tutar — testte gerçek arka plan işi çalışmasın.</summary>
internal sealed class CapturingJobQueue : IDurableJobQueue
{
    public List<(string JobType, object Payload)> Jobs { get; } = [];

    public Task EnqueueAsync(string jobType, object payload, CancellationToken ct = default)
    {
        Jobs.Add((jobType, payload));
        return Task.CompletedTask;
    }
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

/// <summary>Testlerde rol/izin/şube bağlamını tek satırda kurmak için.</summary>
internal sealed class TestCurrentUser : ICurrentUser
{
    public TestCurrentUser(UserRole? role = UserRole.InstitutionOwner, Guid? tenantId = null, Guid? branchId = null, params string[] permissions)
    {
        Role = role;
        TenantId = tenantId;
        BranchId = branchId;
        Permissions = permissions;
    }

    public Guid? UserId { get; } = Guid.NewGuid();
    public string? Email => "test@qa.test";
    public UserRole? Role { get; }
    public Guid? TenantId { get; }
    public Guid? BranchId { get; }
    public Guid? CustomerId => null;
    public bool IsAuthenticated => true;
    public bool IsPlatformAdmin => Role == UserRole.PlatformAdmin;
    public string? IpAddress => "127.0.0.1";
    public string? DeviceId => null;
    public string? DeviceInfoJson => null;
    public IReadOnlyCollection<string> Permissions { get; }
}

/// <summary>Paket kapısı testlerin konusu değilse her şeye izin ver.</summary>
internal sealed class AllowAllFeatureService : IFeatureService
{
    public Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken ct = default) => Task.FromResult(true);
    public Task<bool> IsFeatureAllowedAsync(Guid tenantId, string featureKey, CancellationToken ct = default) => Task.FromResult(true);
    public Task<Result<TenantFeaturesDto>> GetTenantFeaturesAsync(Guid tenantId, CancellationToken ct = default) =>
        Task.FromResult(Result<TenantFeaturesDto>.Success(new TenantFeaturesDto(tenantId, null, null, null, Array.Empty<string>())));
    public FeatureCatalogDto GetCatalog() => new(Array.Empty<FeatureCatalogItem>());
    public void InvalidateTenant(Guid tenantId) { }
}

/// <summary>Testlerde tenant/şube kapsamını elle kurmak için (EF global query filter'ı sürer).</summary>
internal sealed class TestTenantContext : ITenantContext
{
    public TestTenantContext(Guid? tenantId = null, Guid? branchId = null, bool isPlatformAdmin = false)
        => Set(tenantId, branchId, isPlatformAdmin);

    public Guid? TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public bool IsPlatformAdmin { get; private set; }

    public void Set(Guid? tenantId, Guid? branchId, bool isPlatformAdmin)
    {
        TenantId = tenantId;
        BranchId = branchId;
        IsPlatformAdmin = isPlatformAdmin;
    }
}

internal static class TestSearchIndex
{
    /// <summary>Testler gerçek HMAC üreticisini kullanır — sahte değil; indeks/arama uyumu böyle doğrulanır.</summary>
    public static ISearchIndexService Create() =>
        new HmacSearchIndexService(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // 32 byte base64 — testte sabit olması indeksin deterministik olduğunu da doğrular.
                ["Encryption:MasterKeyBase64"] = Convert.ToBase64String(new byte[32]),
            })
            .Build());
}

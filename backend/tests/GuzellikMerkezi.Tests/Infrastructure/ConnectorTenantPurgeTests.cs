using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Security;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// KALICI KURUM SİLME — Maydanoz platform panelinden (18 Kas 2026). Değişmezler: kurum adı aynen gönderilmeden silinmez
/// (yanlış kimlik ya da arada yeniden adlandırılmış kurum), bilinmeyen kurum 404, silme platform panelindeki yolla aynı
/// (kurum ve satırları gider).
/// </summary>
public sealed class ConnectorTenantPurgeTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static ConnectorTenantPurge Purge(GuzellikDbContext db) =>
        new(db, new TenantService(db, new PasswordHasher(), new AllowAllFeatureService(), new NoopAuditLogger(), TestSearchIndex.Create()));

    private static async Task<(Guid TenantId, Guid Other)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = new GuzellikDbContext(options);
        var tenant = new Tenant("Işıl Güzellik", $"isil-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
        var branch = tenant.AddBranch("Merkez", "İzmir", true);
        var other = new Tenant("Başka Kurum", $"baska-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
        other.AddBranch("Merkez", "İzmir", true);
        db.Tenants.AddRange(tenant, other);
        db.Customers.Add(new Customer(tenant.Id, branch.Id, "MÜŞTERİ", "0555 111 22 33", null));
        await db.SaveChangesAsync();
        return (tenant.Id, other.Id);
    }

    [Fact]
    public async Task Purge_RequiresTheExactName_ThenDeletesTheTenantAndItsRows()
    {
        var options = NewOptions();
        var (tenantId, other) = await SeedAsync(options);

        await using (var db = new GuzellikDbContext(options))
        {
            var wrong = await Purge(db).PurgeAsync(tenantId, new ConnectorTenantPurgeRequest("Işıl"), CancellationToken.None);
            Assert.Equal("Conflict", wrong.Error.Code);
            var missing = await Purge(db).PurgeAsync(tenantId, new ConnectorTenantPurgeRequest(null), CancellationToken.None);
            Assert.Equal("Conflict", missing.Error.Code);
            Assert.Equal("NotFound", (await Purge(db).PurgeAsync(Guid.NewGuid(), new ConnectorTenantPurgeRequest("Işıl Güzellik"), CancellationToken.None)).Error.Code);
        }

        await using (var db = new GuzellikDbContext(options))
        {
            Assert.True(await db.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Id == tenantId));
            var done = await Purge(db).PurgeAsync(tenantId, new ConnectorTenantPurgeRequest("  Işıl Güzellik "), CancellationToken.None);
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
            Assert.Equal((tenantId, "Işıl Güzellik", "deleted"), (done.Value!.TenantId, done.Value.Name, done.Value.Status));
        }

        await using var check = new GuzellikDbContext(options);
        Assert.False(await check.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Id == tenantId));
        Assert.False(await check.Customers.IgnoreQueryFilters().AnyAsync(c => c.TenantId == tenantId));
        Assert.True(await check.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Id == other));
    }
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services.Llm;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure.Llm;

/// <summary>
/// Yapay zekâ kullanım kaydı: yalnız sayılar yazılır (metin alanı yok), uzun değerler kolon sınırına
/// kırpılır, veritabanı hatası çağıranı etkilemez ve bir kurum yalnız kendi kullanımını görür.
/// </summary>
public sealed class LlmUsageRecorderTests
{
    private static ServiceProvider Services(string databaseName) =>
        new ServiceCollection()
            .AddDbContext<GuzellikDbContext>(o => o.UseInMemoryDatabase(databaseName))
            .BuildServiceProvider();

    private static LlmUsageEntry Entry(Guid? tenant, string feature = "assistant.help", string? model = "nvidia/nemotron-3.5-super-vl") =>
        new(tenant, Guid.NewGuid(), "Staff", feature, "OpenRouter", model ?? string.Empty, 120, 3, 850, true, null, 1);

    [Fact]
    public async Task WritesCountsOnly_AndClipsLongValues()
    {
        var name = Guid.NewGuid().ToString();
        using var services = Services(name);
        var recorder = new LlmUsageRecorder(services.GetRequiredService<IServiceScopeFactory>(), NullLogger<LlmUsageRecorder>.Instance);
        var tenant = Guid.NewGuid();

        await recorder.RecordAsync(Entry(tenant, model: new string('m', 400)), CancellationToken.None);

        using var scope = services.CreateScope();
        var row = Assert.Single(await scope.ServiceProvider.GetRequiredService<GuzellikDbContext>().LlmUsageRecords.ToListAsync());
        Assert.Equal(tenant, row.TenantId);
        Assert.Equal("assistant.help", row.Feature);
        Assert.Equal(120, row.PromptTokens);
        Assert.Equal(3, row.CompletionTokens);
        Assert.Equal(850, row.DurationMs);
        Assert.Equal(150, row.Model.Length);
        Assert.Equal(string.Empty, row.Error);

        // KVKK: tabloda istem/cevap metni taşıyabilecek bir alan YOK. Yeni bir metin alanı eklenirse bu test düşer.
        var stringColumns = typeof(LlmUsageRecord).GetProperties()
            .Where(p => p.PropertyType == typeof(string)).Select(p => p.Name).OrderBy(n => n).ToArray();
        Assert.Equal(["Error", "Feature", "Model", "Provider", "Role"], stringColumns);
    }

    [Fact]
    public async Task DatabaseFailure_IsSwallowed()
    {
        // Kapsamda DbContext yok → yazma istisnası; çağıran (asistan cevabı) yine de devam etmeli.
        using var empty = new ServiceCollection().BuildServiceProvider();
        var recorder = new LlmUsageRecorder(empty.GetRequiredService<IServiceScopeFactory>(), NullLogger<LlmUsageRecorder>.Instance);

        await recorder.RecordAsync(Entry(Guid.NewGuid()), CancellationToken.None);
    }

    [Fact]
    public async Task TenantSeesOnlyOwnUsage_PlatformSeesAll()
    {
        var name = Guid.NewGuid().ToString();
        using var services = Services(name);
        var recorder = new LlmUsageRecorder(services.GetRequiredService<IServiceScopeFactory>(), NullLogger<LlmUsageRecorder>.Instance);
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        await recorder.RecordAsync(Entry(a), CancellationToken.None);
        await recorder.RecordAsync(Entry(b), CancellationToken.None);

        var options = new DbContextOptionsBuilder<GuzellikDbContext>().UseInMemoryDatabase(name).Options;
        await using (var tenantDb = new GuzellikDbContext(options, new TestTenantContext(a)))
            Assert.Equal([a], await tenantDb.LlmUsageRecords.Select(x => x.TenantId).ToListAsync());
        await using (var platformDb = new GuzellikDbContext(options, new TestTenantContext(isPlatformAdmin: true)))
            Assert.Equal(2, await platformDb.LlmUsageRecords.CountAsync());
    }
}

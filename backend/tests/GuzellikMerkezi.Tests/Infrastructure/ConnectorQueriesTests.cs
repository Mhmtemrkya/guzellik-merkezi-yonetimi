using System.Text.Json;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Bağlayıcının kurum görünümü: KİŞİSEL VERİ TAŞIMAZ, sıra kararlı, iptal edilen kurum da gelir.
/// </summary>
public sealed class ConnectorQueriesTests
{
    private static GuzellikMerkezi.Infrastructure.Persistence.GuzellikDbContext InMemory() =>
        new(new DbContextOptionsBuilder<GuzellikMerkezi.Infrastructure.Persistence.GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static async Task<(GuzellikMerkezi.Infrastructure.Persistence.GuzellikDbContext db, Tenant paid, Tenant trial, Tenant cancelled)> SeedAsync()
    {
        var db = InMemory();
        var t0 = new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc);
        var plan = new SubscriptionPlan("BeautyAsist", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        db.SubscriptionPlans.Add(plan);
        // Kayıt zamanı SaveChanges'te damgalanır: ayrı kayıtlarla oluşturulma sırası kurulur. Ad sırası
        // (Deneme, Işıl, Kapanan) bundan farklıdır — liste ada göre değil oluşturulmaya göre dönmeli.
        var paid = new Tenant("Işıl Güzellik", "isil", "BeautyAsist");
        paid.AssignCode("BA-01");
        paid.StartSubscription(plan, BillingPeriod.Yearly, t0);
        paid.AddBranch("Merkez", "İzmir", isDefault: true);
        paid.AddBranch("Karşıyaka", "İzmir");
        db.Tenants.Add(paid);
        await db.SaveChangesAsync();

        var trial = new Tenant("Deneme Salon", "deneme", "BeautyAsist");
        trial.MarkSelfSignup();
        trial.StartTrial(t0.AddDays(1));
        trial.SetContact("05550000000", "1234567890");
        trial.SetProfile(null, "Ayşe Yılmaz");
        trial.SetProfileExtras("Deneme Ltd.", "Konak", "ayse@ornek.example");
        db.Tenants.Add(trial);
        await db.SaveChangesAsync();

        var cancelled = new Tenant("Kapanan Salon", "kapanan", "BeautyAsist");
        cancelled.Cancel();
        db.Tenants.Add(cancelled);
        await db.SaveChangesAsync();
        return (db, paid, trial, cancelled);
    }

    [Fact]
    public async Task List_IsStable_IncludesCancelled_AndCarriesNoPersonalData()
    {
        var (db, paid, trial, cancelled) = await SeedAsync();
        var sut = new ConnectorQueries(db);

        var all = await sut.ListTenantsAsync(1, 50);
        Assert.Equal(3, all.TotalCount);
        Assert.Equal([paid.Id, trial.Id, cancelled.Id], all.Items.Select(x => x.Id));

        var first = all.Items.First();
        Assert.Equal(("BA-01", "Işıl Güzellik", "active", "beautyasist", "yearly", 2), (first.Code, first.Name, first.Status, first.PlanKey?.ToLowerInvariant(), first.Period, first.BranchCount));
        Assert.NotNull(first.SubscriptionEndsAtUtc);
        var second = all.Items.ElementAt(1);
        Assert.Equal(("trial", (string?)null, (string?)null, true), (second.Status, second.PlanKey, second.Period, second.IsSelfSignup));
        Assert.Equal("cancelled", all.Items.Last().Status);

        // Sözleşmede kişisel alan YOK: yeni bir alan eklenirse bu test bilerek kırılır.
        var json = JsonSerializer.Serialize(all.Items.First(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var fields = JsonDocument.Parse(json).RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        Assert.Equal(["id", "code", "name", "status", "planKey", "period", "trialEndsAtUtc", "subscriptionEndsAtUtc", "branchCount", "isSelfSignup", "createdAtUtc"], fields);
        Assert.DoesNotContain("0555", JsonSerializer.Serialize(all.Items));
        Assert.DoesNotContain("ayse@", JsonSerializer.Serialize(all.Items));
        Assert.DoesNotContain("1234567890", JsonSerializer.Serialize(all.Items));
        Assert.DoesNotContain("Ayşe", JsonSerializer.Serialize(all.Items));
    }

    [Fact]
    public async Task Paging_IsClamped_AndGetFindsOne()
    {
        var (db, paid, trial, _) = await SeedAsync();
        var sut = new ConnectorQueries(db);

        var page2 = await sut.ListTenantsAsync(2, 1);
        Assert.Equal([trial.Id], page2.Items.Select(x => x.Id));
        Assert.Equal((2, 1, 3), (page2.Page, page2.PageSize, page2.TotalCount));
        Assert.Equal(ConnectorQueries.MaxPageSize, (await sut.ListTenantsAsync(0, 10_000)).PageSize);
        Assert.Equal(1, (await sut.ListTenantsAsync(1, 0)).PageSize);

        Assert.Equal("BA-01", (await sut.GetTenantAsync(paid.Id))?.Code);
        Assert.Null(await sut.GetTenantAsync(Guid.NewGuid()));
    }

    [Theory]
    [InlineData(TenantStatus.Trial, "trial")]
    [InlineData(TenantStatus.Active, "active")]
    [InlineData(TenantStatus.Suspended, "suspended")]
    [InlineData(TenantStatus.Cancelled, "cancelled")]
    [InlineData((TenantStatus)99, "unknown")]
    public void StatusText_IsFixedWire(TenantStatus status, string wire) => Assert.Equal(wire, ConnectorQueries.StatusText(status));
}

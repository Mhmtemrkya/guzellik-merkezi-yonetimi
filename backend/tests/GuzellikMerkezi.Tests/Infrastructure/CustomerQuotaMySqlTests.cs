using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MÜŞTERİ KOTASI — GERÇEK MySQL. InMemory sağlayıcı satır kilidini sınamaz; kapının yarışa dayanıklılığı
/// yalnız burada doğrulanır.
/// </summary>
public sealed class CustomerQuotaMySqlTests
{
    /// <summary>
    /// ASIL İDDİA: kapasitenin bir eksiğindeyken (1 müşteri, ücretsiz bölüm 2) AYNI ANDA gelen iki kayıttan
    /// YALNIZ BİRİ yazılır. Kurum satırı kilidi olmadan ikisi de "1 &lt; 2" görüp kapasiteyi aşardı.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentCreates_AtTheBoundary_OnlyOneSucceeds()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();

        Guid tenantId, branchId;
        await using (var db = database.NewContext())
        {
            var plan = new SubscriptionPlan($"mus-{Guid.NewGuid():N}"[..16], "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
            plan.SetPricingModel(chargePerBranch: true, [new PricingTier(2, 250m)], [], 10m);
            db.SubscriptionPlans.Add(plan);
            var tenant = new Tenant("Müşteri Yarış", $"musteri-yaris-{Guid.NewGuid():N}"[..24], "BeautyAsist", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            tenant.AssignSubscriptionPlan(plan);
            db.Customers.Add(new Customer(tenant.Id, branch.Id, "AYŞE MÜŞTERİ", "0555 111 22 33", null));
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            branchId = branch.Id;
        }

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Features:FailOpenWhenNoPlan"] = "false" })
            .Build();

        async Task<Result<CustomerDto>> CreateAsync(string phone)
        {
            await using var db = database.NewContext();
            var service = new CustomerService(db, new UsageService(db, configuration), new NoopAuditLogger(),
                new TestCurrentUser(UserRole.InstitutionOwner), new AllowAllFeatureService(), TestSearchIndex.Create(), new CapturingJobQueue());
            return await service.CreateAsync(tenantId,
                new UpsertCustomerRequest(branchId, "Yeni Müşteri", phone, null, null, Gender.Female, true, null));
        }

        var results = await Task.WhenAll(CreateAsync("0532 111 11 11"), CreateAsync("0532 222 22 22"));

        Assert.Single(results, r => r.IsSuccess);
        Assert.Single(results, r => r.IsFailure && r.Error.Code == "CustomerLimitReached");

        await using var check = database.NewContext();
        Assert.Equal(2, await check.Customers.IgnoreQueryFilters().CountAsync(c => c.TenantId == tenantId && !c.IsDeleted));
    }
}

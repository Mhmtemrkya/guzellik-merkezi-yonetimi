using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Consents;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ONAM KOTASI — GERÇEK MySQL. InMemory sağlayıcı satır kilidini sınamaz; kapının yarışa dayanıklılığı
/// yalnız burada doğrulanır.
/// </summary>
public sealed class ConsentQuotaMySqlTests
{
    /// <summary>
    /// ASIL İDDİA: kapasitenin bir eksiğindeyken (1 imzalı, ücretsiz bölüm 2) AYNI ANDA gelen iki imzadan
    /// YALNIZ BİRİ yazılır. Kurum satırı kilidi olmadan ikisi de "1 < 2" görüp kapasiteyi aşardı.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentSignatures_AtTheBoundary_OnlyOneSucceeds()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();

        Guid tenantId;
        Guid tokenA, tokenB;
        await using (var db = database.NewContext())
        {
            var plan = new SubscriptionPlan($"onam-{Guid.NewGuid():N}"[..16], "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
            plan.SetPricingModel(chargePerBranch: true, [], [new PricingTier(2, 250m)], 10m);
            db.SubscriptionPlans.Add(plan);
            var tenant = new Tenant("Onam Yarış", $"onam-yaris-{Guid.NewGuid():N}"[..24], "BeautyAsist", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            tenant.AssignSubscriptionPlan(plan);
            var customer = new Customer(tenant.Id, branch.Id, "AYŞE MÜŞTERİ", "0555 111 22 33", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            CustomerConsentForm NewForm() => new(tenant.Id, branch.Id, customer.Id, null, null, "Lazer onamı", "Metin", null,
                requiresSignature: false, null, "Ayşe", null, null, null, null, null);

            var signed = NewForm();
            signed.StartSession(null, DateTime.UtcNow);
            signed.Sign(null, null, null, "Ayşe", null, null, DateTime.UtcNow);
            var a = NewForm();
            var b = NewForm();
            tokenA = a.StartSession("Kabin 1", DateTime.UtcNow);
            tokenB = b.StartSession("Kabin 2", DateTime.UtcNow);
            db.CustomerConsentForms.AddRange(signed, a, b);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
        }

        async Task<Result<ConsentFormDto>> SignAsync(Guid token)
        {
            await using var db = database.NewContext();
            var service = new ConsentService(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner), new AllowAllFeatureService());
            return await service.SignAsync(tenantId, token, new SignConsentFormRequest(null, null, "Ayşe"));
        }

        var results = await Task.WhenAll(SignAsync(tokenA), SignAsync(tokenB));

        Assert.Single(results, r => r.IsSuccess);
        Assert.Single(results, r => r.IsFailure && r.Error.Code == "ConsentLimitReached");

        await using var check = database.NewContext();
        Assert.Equal(2, await check.CustomerConsentForms.IgnoreQueryFilters()
            .CountAsync(f => f.TenantId == tenantId && f.SignedAtUtc != null));
    }
}

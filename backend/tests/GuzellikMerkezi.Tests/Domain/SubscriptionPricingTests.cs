using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Tests.Domain;

/// <summary>
/// FİYATLAMA MOTORU — tek paket: şube başı aylık 1.000 / yıllık 10.000 TL + KDV; müşteri ve imzalı
/// onam kademeleri 10.000 / 15.000 / 20.000 ÜZERİ için aylık 250 / 500 / 1.000 TL + KDV (yıllıkta × 10).
/// Tahsilat, fatura, platform raporu ve tüm ekranlar bu tek fonksiyondan beslenir.
/// </summary>
public sealed class SubscriptionPricingTests
{
    private static readonly PricingTier[] Tiers = [new(10_000, 250m), new(15_000, 500m), new(20_000, 1_000m)];

    private static SubscriptionPlan SinglePlan()
    {
        var plan = new SubscriptionPlan("BeautyAsist", "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(chargePerBranch: true, Tiers, Tiers, yearlyTierMultiplier: 10m);
        return plan;
    }

    private static void AssertConsistent(SubscriptionQuote q)
    {
        Assert.Equal(q.Subtotal, q.Lines.Sum(l => l.Net));
        Assert.Equal(q.Total, q.Subtotal + q.Vat);
        Assert.Equal(decimal.Round(q.Subtotal * q.VatRate, 2, MidpointRounding.AwayFromZero), q.Vat);
    }

    [Fact]
    public void OneBranch_Monthly_Is1000PlusVat()
    {
        var q = SubscriptionPricing.Quote(SinglePlan(), BillingPeriod.Monthly, new BillingCounts(1, 0, 0));
        Assert.Equal(1_000m, q.Subtotal);
        Assert.Equal(200m, q.Vat);
        Assert.Equal(1_200m, q.Total);
        Assert.Single(q.Lines);
        AssertConsistent(q);
    }

    [Theory]
    [InlineData(BillingPeriod.Monthly, 2, 2_000)]
    [InlineData(BillingPeriod.Yearly, 2, 20_000)]
    [InlineData(BillingPeriod.Monthly, 0, 1_000)]   // şubesiz kayıt: ana şube her zaman ücretlenir
    [InlineData(BillingPeriod.Yearly, 3, 30_000)]
    public void BranchesMultiplyUnitPrice(BillingPeriod period, int branches, decimal expectedNet)
    {
        var q = SubscriptionPricing.Quote(SinglePlan(), period, new BillingCounts(branches, 0, 0));
        Assert.Equal(expectedNet, q.Subtotal);
        AssertConsistent(q);
    }

    /// <summary>Eşik "üzeri"dir: tam 10.000 ücretsiz, 10.001 ilk kademe; kademeler birikmez.</summary>
    [Theory]
    [InlineData(0, 0)]
    [InlineData(10_000, 0)]
    [InlineData(10_001, 250)]
    [InlineData(15_000, 250)]
    [InlineData(15_001, 500)]
    [InlineData(20_000, 500)]
    [InlineData(20_001, 1_000)]
    [InlineData(500_000, 1_000)]
    public void CustomerAndConsentTiers_AreStrictlyAbove_AndNotCumulative(int count, decimal expectedFee)
    {
        var plan = SinglePlan();
        var byCustomers = SubscriptionPricing.Quote(plan, BillingPeriod.Monthly, new BillingCounts(1, count, 0));
        var byConsent = SubscriptionPricing.Quote(plan, BillingPeriod.Monthly, new BillingCounts(1, 0, count));

        Assert.Equal(1_000m + expectedFee, byCustomers.Subtotal);
        Assert.Equal(1_000m + expectedFee, byConsent.Subtotal);
        Assert.Equal(expectedFee > 0, byCustomers.Lines.Any(l => l.Code == "customers"));
        Assert.Equal(expectedFee > 0, byConsent.Lines.Any(l => l.Code == "consent"));
        AssertConsistent(byCustomers);
    }

    [Fact]
    public void Yearly_TierFeesUseMultiplier_NotTwelve()
    {
        var q = SubscriptionPricing.Quote(SinglePlan(), BillingPeriod.Yearly, new BillingCounts(1, 10_001, 0));
        Assert.Equal(10_000m + 2_500m, q.Subtotal);
        Assert.Equal(2_500m, q.Lines.Single(l => l.Code == "customers").Net);
    }

    [Fact]
    public void Combined_TwoBranchesYearly_WithBothTiers()
    {
        var q = SubscriptionPricing.Quote(SinglePlan(), BillingPeriod.Yearly, new BillingCounts(2, 20_001, 12_000));
        Assert.Equal(new[] { "branches", "customers", "consent" }, q.Lines.Select(l => l.Code));
        Assert.Equal(20_000m + 10_000m + 2_500m, q.Subtotal);
        Assert.Equal(6_500m, q.Vat);
        Assert.Equal(39_000m, q.Total);
        AssertConsistent(q);
    }

    /// <summary>Eski paketler (şube başı değil, kademesiz) eskisi gibi tek fiyat öder — geriye uyum.</summary>
    [Fact]
    public void LegacyPlan_IgnoresBranchesAndCounts()
    {
        var legacy = new SubscriptionPlan("Pro", "Profesyonel", 1_665.83m, 3, 10, 5_000, 1_000, 500, yearlyPriceTRY: 16_658.33m);
        var q = SubscriptionPricing.Quote(legacy, BillingPeriod.Monthly, new BillingCounts(5, 30_000, 30_000));
        Assert.Single(q.Lines);
        Assert.Equal(1_665.83m, q.Subtotal);
        Assert.Equal(1_999.00m, q.Total);   // KDV dönüşümü: eski brüt 1.999 aynen korunur
    }

    [Fact]
    public void Proration_HalfMonth_IsHalfPrice()
    {
        var end = new DateTime(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc);
        var now = new DateTime(2026, 11, 16, 0, 0, 0, DateTimeKind.Utc);   // 30 günlük dönemin 15 günü kaldı
        var q = SubscriptionPricing.ProrateBranch(SinglePlan(), BillingPeriod.Monthly, now, end, new BillingCounts(1, 0, 0));
        Assert.Equal(500m, q.Subtotal);
        Assert.Equal(600m, q.Total);
        Assert.Equal(15m, q.Lines.Single().Quantity);
        AssertConsistent(q);
    }

    /// <summary>
    /// Erken yenileme bitişi bir sonraki dönemin sonuna taşır: oran 1'i AŞAR. Sınırlansaydı yeni şube
    /// ödenmiş sonraki dönemde ücretsiz kalırdı.
    /// </summary>
    [Fact]
    public void Proration_AfterEarlyRenewal_CoversNextPeriodToo()
    {
        var end = new DateTime(2027, 1, 1, 0, 0, 0, DateTimeKind.Utc);       // dönem: 1–31 Aralık (31 gün)
        var now = new DateTime(2026, 11, 29, 0, 0, 0, DateTimeKind.Utc);     // 33 gün kaldı
        var q = SubscriptionPricing.ProrateBranch(SinglePlan(), BillingPeriod.Monthly, now, end, new BillingCounts(1, 0, 0));
        Assert.Equal(decimal.Round(1_000m / 31m * 33m, 2, MidpointRounding.AwayFromZero), q.Subtotal);
        Assert.True(q.Subtotal > 1_000m);
        AssertConsistent(q);
    }

    [Fact]
    public void Proration_StartedDayCounts_AndYearlyUsesYearDays()
    {
        var end = new DateTime(2027, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        var now = end.AddDays(-99.2);   // başlamış gün sayılır → 100 gün
        var q = SubscriptionPricing.ProrateBranch(SinglePlan(), BillingPeriod.Yearly, now, end, new BillingCounts(1, 0, 0));
        Assert.Equal(100m, q.Lines.Single().Quantity);
        Assert.Equal(decimal.Round(10_000m / 365m * 100m, 2, MidpointRounding.AwayFromZero), q.Subtotal);
    }

    [Fact]
    public void Proration_ExpiredSubscription_Throws()
    {
        var end = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        Assert.Throws<DomainException>(() =>
            SubscriptionPricing.ProrateBranch(SinglePlan(), BillingPeriod.Monthly, end.AddMinutes(1), end, new BillingCounts(1, 0, 0)));
    }

    [Fact]
    public void Tiers_AreSorted_AndInvalidOnesRejected()
    {
        var sorted = PricingTier.Normalize([new(20_000, 1_000m), new(10_000, 250m)]);
        Assert.Equal(new[] { 10_000, 20_000 }, sorted.Select(t => t.Above));
        Assert.Throws<DomainException>(() => PricingTier.Normalize([new(10_000, 250m), new(10_000, 300m)]));
        Assert.Throws<DomainException>(() => PricingTier.Normalize([new(10_000, -1m)]));
        Assert.Empty(PricingTier.Parse("{bozuk"));
    }

    [Fact]
    public void QuoteSnapshot_RoundTripsThroughJson()
    {
        var q = SubscriptionPricing.Quote(SinglePlan(), BillingPeriod.Yearly, new BillingCounts(2, 20_001, 12_000));
        var back = SubscriptionQuote.FromJson(q.ToJson())!;
        Assert.Equal(q.Total, back.Total);
        Assert.Equal(q.Lines.Select(l => l.Net), back.Lines.Select(l => l.Net));
    }
}

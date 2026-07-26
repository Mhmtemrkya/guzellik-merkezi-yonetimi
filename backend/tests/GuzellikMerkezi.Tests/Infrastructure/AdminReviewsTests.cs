using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Panel yorum kartı: müşteri adı AÇIK gelir (vitrinde maskelidir) ve yalnız gönderilmiş
/// değerlendirmeler sayılır. Kiracı izolasyonu burada da doğrulanır — başka kurumun yorumu sızmamalı.
/// </summary>
public sealed class AdminReviewsTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    /// <summary>Bir kurumda müşteri + gönderilmiş bir değerlendirme kurar.</summary>
    private static async Task<Guid> SeedTenantWithReviewAsync(
        DbContextOptions<GuzellikDbContext> options, string tenantName, string slug, string customerName,
        int staffStars, int salonStars, string comment)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant(tenantName, slug, "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, customerName, "0555 111 22 33", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var now = DateTime.UtcNow;
        var rating = new AppointmentRating(
            tenant.Id, branch.Id, Guid.NewGuid(), Guid.NewGuid(), customer.Id,
            customer.Phone!, "Ayşe UZMAN", "Lazer Epilasyon", tenantName, now, 60);
        rating.Submit(staffStars, salonStars, comment, now);
        db.AppointmentRatings.Add(rating);
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    [Fact]
    public async Task Reviews_ReturnUnmaskedCustomerName_AndAverages()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantWithReviewAsync(options, "Panel QA", "panel-qa", "Merve YILMAZ", 5, 4, "Çok memnun kaldım");

        await using var db = NewDb(options);
        var result = await new RatingService(db).GetRecentReviewsAsync(tenantId);

        Assert.True(result.IsSuccess);
        var summary = result.Value!;
        Assert.Equal(1, summary.TotalCount);
        Assert.Equal(1, summary.WithCommentCount);
        Assert.Equal(5, summary.StaffAverage);
        Assert.Equal(4, summary.SalonAverage);

        var review = Assert.Single(summary.Recent);
        // Vitrinde "M*** Y***" görünür; PANELDE tam ad.
        Assert.Equal("Merve YILMAZ", review.CustomerName);
        Assert.DoesNotContain("*", review.CustomerName);
        Assert.Equal("Çok memnun kaldım", review.Comment);
        Assert.Equal("Ayşe UZMAN", review.StaffName);
    }

    [Fact]
    public async Task Reviews_AreIsolatedPerTenant()
    {
        var options = NewOptions();
        var mine = await SeedTenantWithReviewAsync(options, "Benim Kurum", "benim-kurum", "Kendi MÜŞTERİM", 5, 5, "bizim yorum");
        await SeedTenantWithReviewAsync(options, "Baska Kurum", "baska-kurum", "Yabancı MÜŞTERİ", 1, 1, "başka kurumun yorumu");

        await using var db = NewDb(options);
        var result = await new RatingService(db).GetRecentReviewsAsync(mine, take: 50);

        Assert.True(result.IsSuccess);
        var review = Assert.Single(result.Value!.Recent);
        Assert.Equal("Kendi MÜŞTERİM", review.CustomerName);
        Assert.DoesNotContain(result.Value!.Recent, r => r.Comment == "başka kurumun yorumu");
    }

    [Theory]
    [InlineData(0, 1)]      // 0 → alt sınır
    [InlineData(9999, 50)]  // aşırı büyük → üst sınır (toplu veri kazımaya karşı)
    public async Task Reviews_ClampTakeParameter(int requested, int expectedMax)
    {
        var options = NewOptions();
        var tenantId = await SeedTenantWithReviewAsync(options, "Clamp QA", "clamp-qa", "Test MÜŞTERİ", 4, 4, "yorum");

        await using var db = NewDb(options);
        var result = await new RatingService(db).GetRecentReviewsAsync(tenantId, requested);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.Recent.Count <= expectedMax);
    }
}

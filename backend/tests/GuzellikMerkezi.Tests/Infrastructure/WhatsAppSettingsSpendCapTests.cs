using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// AYLIK HARCAMA TAVANI — ESKİ İSTEMCİ KORUMASI.
///
/// <para>
/// Tavan ₺'den krediye geçti. Mağazadaki eski mobil sürüm ayarları kaydederken tavanı
/// <c>monthlySpendCapTry</c> adıyla gönderir; sunucu bu alanı artık tanımaz, yani
/// <c>MonthlySpendCapCredits</c> null gelir. Null "tavanı kaldır" diye okunsaydı, eski sürümle
/// yapılan HER kayıt kurumun kredi tavanını sessizce silerdi (harcama sınırsızlaşırdı).
/// Bu yüzden boş tavan yalnızca birim işaretini (<c>SpendCapUnit = "Credits"</c>) gönderen —
/// krediyi bilen — istemciden "kaldır" anlamına gelir.
/// </para>
/// </summary>
public sealed class WhatsAppSettingsSpendCapTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(UserRole.InstitutionOwner), null, null, TestSearchIndex.Create());

    private static WhatsAppService NewService(GuzellikDbContext db)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        return new WhatsAppService(
            db,
            Substitute.For<IEncryptionService>(),
            Substitute.For<IHttpClientFactory>(),
            config,
            NullLogger<WhatsAppService>.Instance,
            new AllowAllFeatureService(),
            Substitute.For<IWhatsAppBillingService>(),
            new TestCurrentUser(UserRole.InstitutionOwner),
            Substitute.For<IWaitlistService>(),
            Substitute.For<IAppNotificationService>(),
            Substitute.For<IKvkkDocumentService>(),
            Substitute.For<IServiceProvider>());
    }

    /// <summary>Tavanı 2000 kredi, değerlendirme linki kanalı SMS olan bir kurum.</summary>
    private static async Task<Guid> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenantId = Guid.NewGuid();
        var s = new WhatsAppSettings(tenantId);
        s.UpdateBillingPreferences(marketingEnabled: false, allowWalletOverage: true, monthlySpendCapCredits: 2000m);
        s.UpdateChannelPreferences(NotificationChannel.Sms, NotificationChannel.WhatsApp, NotificationChannel.WhatsApp);
        db.WhatsAppSettings.Add(s);
        await db.SaveChangesAsync();
        return tenantId;
    }

    private static async Task<WhatsAppSettings> ReadAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        return await db.WhatsAppSettings.AsNoTracking().SingleAsync(x => x.TenantId == tenantId);
    }

    [Fact]
    public async Task LegacyClient_WithoutUnit_KeepsExistingCapAndChannels()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            // Eski sürümün gövdesi: tavan alanı (₺) tanınmaz → MonthlySpendCapCredits null, birim yok, kanal yok.
            var result = await NewService(db).SaveSettingsAsync(tenantId,
                new SaveWhatsAppSettingsRequest(ReminderTemplate: "Merhaba", MarketingEnabled: false, AllowWalletOverage: true));
            Assert.True(result.IsSuccess);
        }

        var saved = await ReadAsync(options, tenantId);
        Assert.Equal(2000m, saved.MonthlySpendCapCredits);
        Assert.Equal(NotificationChannel.Sms, saved.RatingLinkChannel);
    }

    [Fact]
    public async Task CreditAwareClient_EmptyCap_ClearsCap()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).SaveSettingsAsync(tenantId,
                new SaveWhatsAppSettingsRequest(ReminderTemplate: null, AllowWalletOverage: true,
                    MonthlySpendCapCredits: null, SpendCapUnit: "Credits"));
            Assert.True(result.IsSuccess);
        }

        Assert.Null((await ReadAsync(options, tenantId)).MonthlySpendCapCredits);
    }

    [Fact]
    public async Task CreditAwareClient_NewCap_IsSaved()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).SaveSettingsAsync(tenantId,
                new SaveWhatsAppSettingsRequest(ReminderTemplate: null, AllowWalletOverage: true,
                    MonthlySpendCapCredits: 500m, SpendCapUnit: "Credits"));
            Assert.True(result.IsSuccess);
        }

        Assert.Equal(500m, (await ReadAsync(options, tenantId)).MonthlySpendCapCredits);
    }
}

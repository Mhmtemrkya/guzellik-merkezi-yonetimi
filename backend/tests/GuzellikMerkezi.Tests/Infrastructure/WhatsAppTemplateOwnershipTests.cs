using System.Text.Json;
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
/// META ONAYLI ŞABLON ADLARI PLATFORMUNDUR.
///
/// <para>
/// Meta Business Manager platformun (tek BM + tek sistem token'ı); şablonları kurum oluşturamaz.
/// Bu yüzden şablon adlarını yalnız platformun bağlama ucu yazar. İki tuzak korunur:
/// (1) Kurumun ayar kaydı adları SİLMEZ — mağazadaki eski mobil sürüm bu alanları hâlâ gönderir;
/// alanlar artık istekte yoktur ve yok sayılır. (2) Platform penceresi yalnız durumu değiştirmek
/// için kaydedilse bile (alanlar gönderilmezse) adlar korunur; boş metin bilerek temizler.
/// </para>
/// </summary>
public sealed class WhatsAppTemplateOwnershipTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(UserRole.InstitutionOwner), null, null, TestSearchIndex.Create());

    private static WhatsAppService NewService(GuzellikDbContext db) =>
        new(db,
            Substitute.For<IEncryptionService>(),
            Substitute.For<IHttpClientFactory>(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
            NullLogger<WhatsAppService>.Instance,
            new AllowAllFeatureService(),
            Substitute.For<IWhatsAppBillingService>(),
            new TestCurrentUser(UserRole.InstitutionOwner),
            Substitute.For<IWaitlistService>(),
            Substitute.For<IAppNotificationService>(),
            Substitute.For<IKvkkDocumentService>(),
            Substitute.For<IServiceProvider>());

    /// <summary>Platformun bağladığı numara + şablon adları olan bir kurum.</summary>
    private static async Task<Guid> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Şablon QA", $"tpl-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        var s = new WhatsAppSettings(tenant.Id);
        s.BindConnection("123456789012345", "WABA1", "+90 555 000 00 00", WhatsAppConnectionStatus.Connected, null);
        s.UpdateTemplateBindings("kvkk_acik_riza", "randevu_hatirlatma", "tr", "bekleme_teklif", "bekleme_onay", "degerlendirme");
        db.WhatsAppSettings.Add(s);
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    private static async Task<WhatsAppSettings> ReadAsync(DbContextOptions<GuzellikDbContext> options, Guid tenantId)
    {
        await using var db = NewDb(options);
        return await db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.TenantId == tenantId);
    }

    /// <summary>
    /// Mağazadaki eski mobil sürümün GERÇEK gövdesi (şablon adları dahil) JSON'dan çözülür: alanlar
    /// istekte olmadığı için yok sayılır ve platformun girdiği adlar aynen kalır.
    /// </summary>
    [Fact]
    public async Task TenantSave_WithTemplateNamesInBody_DoesNotChangeThem()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);
        const string legacyBody = """
            {
              "reminderTemplate": "Merhaba {ad}",
              "allowWalletOverage": true,
              "kvkkTemplateName": "",
              "reminderTemplateName": "kurumun_uydurdugu_ad",
              "templateLanguageCode": "en",
              "ratingTemplateName": null
            }
            """;
        var request = JsonSerializer.Deserialize<SaveWhatsAppSettingsRequest>(legacyBody, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).SaveSettingsAsync(tenantId, request);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        var saved = await ReadAsync(options, tenantId);
        Assert.Equal("Merhaba {ad}", saved.ReminderTemplate);
        Assert.Equal("kvkk_acik_riza", saved.KvkkTemplateName);
        Assert.Equal("randevu_hatirlatma", saved.ReminderTemplateName);
        Assert.Equal("tr", saved.TemplateLanguageCode);
        Assert.Equal("degerlendirme", saved.RatingTemplateName);
    }

    /// <summary>Platform penceresi yalnız durumu değiştirse de (şablon alanları gönderilmez) adlar korunur.</summary>
    [Fact]
    public async Task PlatformBind_WithoutTemplateFields_KeepsThem()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).BindConnectionAsync(tenantId,
                new BindWhatsAppConnectionRequest("123456789012345", "WABA1", "+90 555 000 00 00", "Disabled", null, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal("kvkk_acik_riza", result.Value!.KvkkTemplateName);
            Assert.Equal("bekleme_onay", result.Value.WaitlistActivatedTemplateName);
        }

        var saved = await ReadAsync(options, tenantId);
        Assert.Equal(WhatsAppConnectionStatus.Disabled, saved.ConnectionStatus);
        Assert.Equal("randevu_hatirlatma", saved.ReminderTemplateName);
        Assert.Equal("bekleme_teklif", saved.WaitlistOfferTemplateName);
    }

    /// <summary>Platform şablon adını değiştirir; boş metin bilerek temizler; liste de adları taşır.</summary>
    [Fact]
    public async Task PlatformBind_SetsAndClearsTemplateNames_AndListCarriesThem()
    {
        var options = NewOptions();
        var tenantId = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).BindConnectionAsync(tenantId,
                new BindWhatsAppConnectionRequest("123456789012345", "WABA1", "+90 555 000 00 00", "Connected", null, null,
                    KvkkTemplateName: "kvkk_v2", RatingTemplateName: ""));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        var saved = await ReadAsync(options, tenantId);
        Assert.Equal("kvkk_v2", saved.KvkkTemplateName);
        Assert.Null(saved.RatingTemplateName);
        Assert.Equal("randevu_hatirlatma", saved.ReminderTemplateName);

        await using var read = NewDb(options);
        var row = Assert.Single((await NewService(read).GetConnectionsAsync()).Value!, c => c.TenantId == tenantId);
        Assert.Equal("kvkk_v2", row.KvkkTemplateName);
        Assert.Equal("randevu_hatirlatma", row.ReminderTemplateName);
        Assert.Equal("tr", row.TemplateLanguageCode);
    }
}

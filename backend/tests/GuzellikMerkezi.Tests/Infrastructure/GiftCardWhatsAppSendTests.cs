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
/// HEDİYE KARTI WHATSAPP GÖNDERİMİ — kapıların regresyon koruması.
///
/// <para>
/// Uç, kurumun KONTÖRÜYLE dışarıya BELGE gönderir; dolayısıyla üç şeyi birden korumak zorundadır:
/// kimin kartı (kapsam), kimin numarası (bağ) ve neyin gönderildiği (dosya). Bu testler ağ
/// katmanına hiç inmez — hepsi çağrı gövdesindeki kapılar, ilk HTTP isteğinden ÖNCE.
/// </para>
///
/// <list type="number">
/// <item>Başka şubenin kartı, kimliği bilinse bile gönderilemez (BOLA). Yanıt "yetkiniz yok"
/// değil "bulunamadı"dır: ayrı mesaj kartın VARLIĞINI sızdırırdı.</item>
/// <item>Karta bağlı müşteri varsa numara ONUN kayıtlı numarasıdır; serbest numara verilirse uç,
/// kurumun kontörüyle istenen numaraya belge gönderen bir kanala dönerdi.</item>
/// <item>Gönderilen dosya gerçekten PDF olmalı ve makul boyutta olmalı — aksi hâlde uç keyfi
/// dosya taşıyan bir kanaldır.</item>
/// <item>Geçersiz kart (süresi dolmuş / bakiyesi bitmiş) hiç gönderilmez: kontör boşa gider ve
/// müşteri işletmeye boşuna gelir.</item>
/// </list>
/// </summary>
public sealed class GiftCardWhatsAppSendTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    /*
     * KAPSAM GERÇEKTEN KURULUR. EF global query filter'ları `ITenantContext`'i okur — 2. parametre.
     * Testlerin çoğu oraya `null` verip filtreleri kapatır; BOLA senaryosu tam olarak o filtreyi
     * sınadığı için burada kapsam AÇIKÇA kurulur, aksi hâlde test hiçbir şey doğrulamazdı.
     */
    private static GuzellikDbContext NewDb(
        DbContextOptions<GuzellikDbContext> options, ICurrentUser user, ITenantContext? scope = null) =>
        new(options, scope, user, null, null, TestSearchIndex.Create());

    /// <summary>Gerçek bir PDF'in ilk baytları + dolgu (imza ve boyut kapısını geçmek için).</summary>
    private static string FakePdfBase64()
    {
        var bytes = new byte[1024];
        bytes[0] = 0x25; bytes[1] = 0x50; bytes[2] = 0x44; bytes[3] = 0x46; bytes[4] = 0x2D; // "%PDF-"
        return Convert.ToBase64String(bytes);
    }

    private static WhatsAppService NewService(GuzellikDbContext db, ICurrentUser user)
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
            user,
            Substitute.For<IWaitlistService>(),
            Substitute.For<IAppNotificationService>(),
            Substitute.For<IKvkkDocumentService>(),
            Substitute.For<IServiceProvider>());
    }

    private sealed record Seed(Guid TenantId, Guid BranchA, Guid BranchB, Guid CustomerId, Guid CardOfBranchB, Guid CardWithCustomer, Guid ExpiredCard);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        // Kurulum kapsamsız bağlamda yapılır (şube filtresi kapalı) — senaryolar kapsamı sonra daraltır.
        await using var db = NewDb(options, new TestCurrentUser(UserRole.InstitutionOwner));
        var tenant = new Tenant("WA QA", $"wa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var a = tenant.AddBranch("Merkez", "İstanbul", true);
        var b = tenant.AddBranch("Şube 2", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, a.Id, "MÜŞTERİ A", "0555 111 22 33", null);
        db.Customers.Add(customer);

        var cardB = new GiftCard(tenant.Id, b.Id, "WA111111", GiftCardKind.StoredValue, 500m, null, 0, null, null);
        var cardWithCustomer = new GiftCard(tenant.Id, a.Id, "WA222222", GiftCardKind.StoredValue, 500m, null, 0, null, customer.Id);
        var expired = new GiftCard(tenant.Id, a.Id, "WA333333", GiftCardKind.StoredValue, 500m,
            DateTime.UtcNow.AddDays(-1), 0, null, null);
        db.GiftCards.AddRange(cardB, cardWithCustomer, expired);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, a.Id, b.Id, customer.Id, cardB.Id, cardWithCustomer.Id, expired.Id);
    }

    [Fact]
    public async Task BaskaSubeninKartiGonderilemez()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        // Kullanıcı A şubesinde: B şubesinin kartını kimliğiyle istese bile göremez.
        var user = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        await using var db = NewDb(options, user, new TestTenantContext(seed.TenantId, seed.BranchA));

        var result = await NewService(db, user).SendGiftCardAsync(seed.TenantId,
            new SendGiftCardRequest(seed.CardOfBranchB, "0555 999 88 77", FakePdfBase64()));

        Assert.True(result.IsFailure, "Başka şubenin kartı gönderilebildi (BOLA).");
        // Sızıntı yok: "yetkiniz yok" değil "bulunamadı".
        Assert.Equal("NotFound", result.Error.Code);
    }

    [Fact]
    public async Task MusteriyeBagliKartYalnizOnunNumarasinaGider()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        var user = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        await using var db = NewDb(options, user, new TestTenantContext(seed.TenantId, seed.BranchA));

        var result = await NewService(db, user).SendGiftCardAsync(seed.TenantId,
            new SendGiftCardRequest(seed.CardWithCustomer, "0532 000 00 00", FakePdfBase64()));

        Assert.True(result.IsFailure, "Karta bağlı müşteri varken serbest numaraya gönderilebildi.");
        Assert.Equal("Validation", result.Error.Code);
        Assert.Contains("kayıtlı numarasına", result.Error.Message);
    }

    [Fact]
    public async Task PdfOlmayanDosyaReddedilir()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        var user = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        await using var db = NewDb(options, user);

        // Doğru boyutta ama PDF imzası olmayan içerik.
        var notPdf = Convert.ToBase64String(new byte[1024]);
        var result = await NewService(db, user).SendGiftCardAsync(seed.TenantId,
            new SendGiftCardRequest(seed.CardWithCustomer, null, notPdf));

        Assert.True(result.IsFailure, "PDF olmayan dosya gönderilebildi.");
        Assert.Equal("Validation", result.Error.Code);
        Assert.Contains("PDF değil", result.Error.Message);
    }

    [Fact]
    public async Task GecersizKartGonderilemez()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        var user = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchA);
        await using var db = NewDb(options, user, new TestTenantContext(seed.TenantId, seed.BranchA));

        var result = await NewService(db, user).SendGiftCardAsync(seed.TenantId,
            new SendGiftCardRequest(seed.ExpiredCard, "0555 111 22 33", FakePdfBase64()));

        Assert.True(result.IsFailure, "Süresi dolmuş kart gönderilebildi.");
        Assert.Equal("Validation", result.Error.Code);
    }
}

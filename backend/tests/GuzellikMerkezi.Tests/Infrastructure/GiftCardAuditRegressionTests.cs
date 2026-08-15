using GuzellikMerkezi.Application.Features.GiftCards;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// HEDİYE ÇEKİ DENETİM TURU — bulunan açıkların regresyon koruması.
///
/// <list type="number">
/// <item>Kart üzerindeki KISITLAR (müşteri, şube, katalog hedefi) kayıtta duruyor ama kullanım
/// anında hiç okunmuyordu: A müşterisine ve X paketine bağlı çek, B müşterisinin Y paketinde
/// harcanabiliyordu (müşteriler arası parasal değer aktarımı).</item>
/// <item>Kullanılmış kart başka müşteriye devredilebiliyordu; eski satışın iptali YENİ sahibin
/// bakiyesini şişiriyordu.</item>
/// <item>Bakiye değişiminin DEFTERİ yoktu: "bu çekin parası nereye gitti" ve "iptalde gerçekten
/// geri geldi mi" sorularının cevabı hiçbir yerde tutulmuyordu.</item>
/// <item>Düzeltme ucu yoktu; yanlış girilen geçerlilik/kapsam düzeltilemiyordu. Ucu eklerken
/// KOD/TÜR/DEĞER'in değişmez kalması ve kullanılmış kartın devredilememesi şarttır.</item>
/// <item>Ters tarih aralığı sessizce takas ediliyordu — operatör yanlışını hiç görmüyordu.</item>
/// </list>
/// </summary>
public sealed class GiftCardAuditRegressionTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static GiftCardService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser());

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid OtherBranchId, Guid CustomerA, Guid CustomerB, Guid ServiceX, Guid ServiceY, Guid ProductId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Cek QA", $"cek-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        var other = tenant.AddBranch("Şube 2", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var a = new Customer(tenant.Id, branch.Id, "MÜŞTERİ A", "0555 111 22 33", null);
        var b = new Customer(tenant.Id, branch.Id, "MÜŞTERİ B", "0555 444 55 66", null);
        var x = new ServiceDefinition(tenant.Id, branch.Id, "X Hizmeti", 60, 1000m, "Cilt");
        var y = new ServiceDefinition(tenant.Id, branch.Id, "Y Hizmeti", 45, 800m, "Cilt");
        var product = new Product(tenant.Id, branch.Id, "Şampuan", ProductCategory.Sale, "adet", 120m, 250m, 10m, 2m);
        db.Customers.AddRange(a, b);
        db.ServiceDefinitions.AddRange(x, y);
        db.Products.Add(product);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, other.Id, a.Id, b.Id, x.Id, y.Id, product.Id);
    }

    // ── 1) Kısıtlar KULLANIM anında uygulanır ────────────────────────────────────────────

    [Fact]
    public void BaskaMusteriyeTanimliCekKullanilamaz()
    {
        var tenantId = Guid.NewGuid();
        var owner = Guid.NewGuid();
        var card = new GiftCard(tenantId, null, "AA111111", GiftCardKind.StoredValue, 500m, null, 0, null, owner);

        var problem = card.UsageProblemFor(DateTime.UtcNow, Guid.NewGuid(), null, Array.Empty<Guid>());

        Assert.NotNull(problem);
        Assert.Contains("başka bir müşteriye", problem);
    }

    [Fact]
    public void BaskaSubeyeTanimliCekKullanilamaz()
    {
        var tenantId = Guid.NewGuid();
        var branch = Guid.NewGuid();
        var customer = Guid.NewGuid();
        var card = new GiftCard(tenantId, branch, "AA222222", GiftCardKind.StoredValue, 500m, null, 0, null, customer);

        var problem = card.UsageProblemFor(DateTime.UtcNow, customer, Guid.NewGuid(), Array.Empty<Guid>());

        Assert.NotNull(problem);
        Assert.Contains("başka bir şubeye", problem);
    }

    [Fact]
    public void KatalogaBagliCekBaskaKalemdeKullanilamaz()
    {
        var tenantId = Guid.NewGuid();
        var customer = Guid.NewGuid();
        var serviceX = Guid.NewGuid();
        var serviceY = Guid.NewGuid();
        var card = new GiftCard(tenantId, null, "AA333333", GiftCardKind.StoredValue, 500m, null, 0, null, customer,
            serviceDefinitionId: serviceX);

        // Fişte yalnız Y var → kart uygulanamaz.
        Assert.NotNull(card.UsageProblemFor(DateTime.UtcNow, customer, null, new[] { serviceY }));
        // Fişte X de varsa uygulanır.
        Assert.Null(card.UsageProblemFor(DateTime.UtcNow, customer, null, new[] { serviceY, serviceX }));
    }

    [Fact]
    public void UrunHedefiDeKullanimdaUygulanir()
    {
        var tenantId = Guid.NewGuid();
        var customer = Guid.NewGuid();
        var productId = Guid.NewGuid();
        var card = new GiftCard(tenantId, null, "AA444444", GiftCardKind.FixedAmount, 50m, null, 0, null, customer,
            productId: productId);

        Assert.NotNull(card.UsageProblemFor(DateTime.UtcNow, customer, null, new[] { Guid.NewGuid() }));
        Assert.Null(card.UsageProblemFor(DateTime.UtcNow, customer, null, new[] { productId }));
    }

    [Fact]
    public void CekAyniAndaBirdenFazlaKataloğaBaglanamaz()
    {
        var ex = Assert.Throws<DomainException>(() => new GiftCard(
            Guid.NewGuid(), null, "AA555555", GiftCardKind.FixedAmount, 50m, null, 0, null, null,
            serviceDefinitionId: Guid.NewGuid(), servicePackageId: Guid.NewGuid()));

        Assert.Contains("yalnız bir", ex.Message);
    }

    // ── 2) Ters tarih SESSİZCE takas edilmez ─────────────────────────────────────────────

    [Fact]
    public void TersGecerlilikAraligiReddedilir()
    {
        var card = new GiftCard(Guid.NewGuid(), null, "AA666666", GiftCardKind.FixedAmount, 50m, null, 0, null, null);
        var ex = Assert.Throws<DomainException>(() =>
            card.SetValidity(new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc), new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        Assert.Contains("bitişten sonra", ex.Message);
    }

    // ── 3) Hareket defteri: harcama + geri alma ──────────────────────────────────────────

    /// <summary>
    /// DEFTERİN DEĞİŞMEZİ: <c>Σ BalanceDelta == Balance − Value</c> ve <c>Σ UsesDelta == UsedCount</c>.
    /// Harcama → geri alma → yeniden harcama döngüsünden sonra da tutmalıdır; tutmuyorsa
    /// mutasyon yollarından biri defteri atlamış demektir.
    /// </summary>
    [Fact]
    public async Task DefterBakiyeyleTutarliKalir()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var card = new GiftCard(seed.TenantId, seed.BranchId, "AA777777", GiftCardKind.StoredValue, 500m, null, 0, null, seed.CustomerA);
        db.GiftCards.Add(card);
        await db.SaveChangesAsync();

        var now = DateTime.UtcNow;
        GiftCardLedger.Redeem(db, card, 200m, now, GiftCardLedger.SourceAdisyon, Guid.NewGuid(), seed.CustomerA, null);
        await db.SaveChangesAsync();
        GiftCardLedger.Undo(db, card, 200m, now, GiftCardLedger.SourceAdisyon, Guid.NewGuid(), seed.CustomerA, null);
        await db.SaveChangesAsync();
        GiftCardLedger.Redeem(db, card, 120m, now, GiftCardLedger.SourceDirect, null, seed.CustomerA, null);
        await db.SaveChangesAsync();

        var rows = await db.GiftCardTransactions.AsNoTracking().Where(t => t.GiftCardId == card.Id).ToListAsync();

        Assert.Equal(3, rows.Count);
        Assert.Equal(card.Balance - card.Value, rows.Sum(r => r.BalanceDelta));
        Assert.Equal(card.UsedCount, rows.Sum(r => r.UsesDelta));
        Assert.Equal(380m, card.Balance);
        // Son satır, kartın o anki hâlinin fotoğrafını taşır.
        var last = rows.OrderBy(r => r.CreatedAtUtc).Last();
        Assert.Equal(card.Balance, last.BalanceAfter);
        Assert.Equal(card.UsedCount, last.UsedCountAfter);
    }

    /// <summary>Kural ihlalinde (yetersiz bakiye) defter satırı da YAZILMAZ — yarım kayıt olmaz.</summary>
    [Fact]
    public async Task BasarisizHarcamaDeftereYazilmaz()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var card = new GiftCard(seed.TenantId, seed.BranchId, "AA888888", GiftCardKind.StoredValue, 100m, null, 0, null, null);
        db.GiftCards.Add(card);
        await db.SaveChangesAsync();

        Assert.Throws<DomainException>(() =>
            GiftCardLedger.Redeem(db, card, 250m, DateTime.UtcNow, GiftCardLedger.SourceDirect, null, null, null));

        Assert.Empty(db.GiftCardTransactions.Local);
        Assert.Equal(100m, card.Balance);
    }

    // ── 4) Atama: kullanılmış kart devredilemez, geçersiz kart eşleşmez ──────────────────

    [Fact]
    public async Task KullanilmisKartBaskaMusteriyeDevredilemez()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        Guid cardId;
        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "AA999999", GiftCardKind.StoredValue, 500m, null, 0, null, seed.CustomerA);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            GiftCardLedger.Redeem(db, card, 100m, DateTime.UtcNow, GiftCardLedger.SourceDirect, null, seed.CustomerA, null);
            await db.SaveChangesAsync();
            cardId = card.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).AssignCustomerAsync(seed.TenantId,
                new AssignGiftCardCustomerRequest("AA999999", seed.CustomerB, AllowReassign: true));

            Assert.True(result.IsFailure, "Kullanılmış kart başka müşteriye devredilebildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }

        await using (var verify = NewDb(options))
        {
            var card = await verify.GiftCards.AsNoTracking().FirstAsync(g => g.Id == cardId);
            Assert.Equal(seed.CustomerA, card.CustomerId);
        }
    }

    [Fact]
    public async Task BaskaKurumunMusterisineKartBaglanamaz()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            db.GiftCards.Add(new GiftCard(seed.TenantId, seed.BranchId, "BB111111", GiftCardKind.StoredValue, 300m, null, 0, null, null));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).AssignCustomerAsync(seed.TenantId,
                new AssignGiftCardCustomerRequest("BB111111", Guid.NewGuid()));

            Assert.True(result.IsFailure);
            Assert.Equal("NotFound", result.Error.Code);
        }
    }

    // ── 5) Düzeltme ucu: neyi düzeltir, neyi REDDEDER ────────────────────────────────────

    [Fact]
    public async Task DuzeltmeKapsamVeGecerliligiGunceller()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        Guid cardId;
        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "BB222222", GiftCardKind.StoredValue, 400m, null, 0, null, null);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            cardId = card.Id;
        }

        await using (var db = NewDb(options))
        {
            var until = DateTime.UtcNow.AddDays(30);
            var result = await NewService(db).UpdateAsync(seed.TenantId, cardId, new UpdateGiftCardRequest(
                ValidFromUtc: null, ValidUntilUtc: until, MaxUses: 3, Note: "düzeltildi",
                ScopeLabel: "Cilt bakımı", RecipientName: "Ayşe", CustomerId: seed.CustomerA,
                ServiceDefinitionId: seed.ServiceX, ServicePackageId: null, ProductId: null));

            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal("Cilt bakımı", result.Value.ScopeLabel);
            Assert.Equal(seed.ServiceX, result.Value.ServiceDefinitionId);
            Assert.Equal(seed.CustomerA, result.Value.CustomerId);
            // KOD VE DEĞER DEĞİŞMEZ — düzeltme ucu bunlara hiç dokunmaz.
            Assert.Equal("BB222222", result.Value.Code);
            Assert.Equal(400m, result.Value.Value);
        }
    }

    [Fact]
    public async Task DuzeltmeKullanilmisKartinMusterisiniDegistiremez()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        Guid cardId;
        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "BB333333", GiftCardKind.StoredValue, 400m, null, 0, null, seed.CustomerA);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            GiftCardLedger.Redeem(db, card, 50m, DateTime.UtcNow, GiftCardLedger.SourceDirect, null, seed.CustomerA, null);
            await db.SaveChangesAsync();
            cardId = card.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).UpdateAsync(seed.TenantId, cardId, new UpdateGiftCardRequest(
                null, null, 0, null, null, null, seed.CustomerB, null, null, null));

            Assert.True(result.IsFailure, "Kullanılmış kartın müşterisi düzeltme ucundan değiştirilebildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }
    }

    [Fact]
    public async Task DuzeltmeKullanimHakkiniMevcutKullanimAltinaIndiremez()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        Guid cardId;
        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "BB444444", GiftCardKind.FixedAmount, 40m, null, 5, null, null);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            GiftCardLedger.Redeem(db, card, 40m, DateTime.UtcNow, GiftCardLedger.SourceDirect, null, null, null);
            GiftCardLedger.Redeem(db, card, 40m, DateTime.UtcNow, GiftCardLedger.SourceDirect, null, null, null);
            await db.SaveChangesAsync();
            cardId = card.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).UpdateAsync(seed.TenantId, cardId, new UpdateGiftCardRequest(
                null, null, MaxUses: 1, null, null, null, null, null, null, null));

            Assert.True(result.IsFailure, "Kullanım hakkı mevcut kullanımın altına indirilebildi.");
            Assert.Equal("Validation", result.Error.Code);
        }
    }

    [Fact]
    public async Task DuzeltmeBaskaKurumunHizmetineBaglanamaz()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        Guid cardId;
        await using (var db = NewDb(options))
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "BB555555", GiftCardKind.StoredValue, 400m, null, 0, null, null);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            cardId = card.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewService(db).UpdateAsync(seed.TenantId, cardId, new UpdateGiftCardRequest(
                null, null, 0, null, null, null, null, ServiceDefinitionId: Guid.NewGuid(), null, null));

            Assert.True(result.IsFailure, "Var olmayan hizmet kimliği düzeltme ucundan yazılabildi.");
            Assert.Equal("Validation", result.Error.Code);
        }
    }

    // ── 6) Anonim doğrulama ucu: kısa kod sorgulanamaz ───────────────────────────────────

    [Fact]
    public async Task AnonimUcKisaKodlariSorgulatmaz()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using var db = NewDb(options);
        var slug = await db.Tenants.AsNoTracking().Where(t => t.Id == seed.TenantId).Select(t => t.Slug).FirstAsync();
        db.GiftCards.Add(new GiftCard(seed.TenantId, seed.BranchId, "VIP", GiftCardKind.FixedAmount, 100m, null, 0, null, null));
        await db.SaveChangesAsync();

        var result = await NewService(db).GetPublicByCodeAsync(slug, "VIP");

        Assert.True(result.IsFailure, "Kaba kuvvetle tahmin edilebilir kısa kod anonim uçtan okunabildi.");
        Assert.Equal("NotFound", result.Error.Code);
    }
}

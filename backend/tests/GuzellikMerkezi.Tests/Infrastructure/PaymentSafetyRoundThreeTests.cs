using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÖDEME GÜVENLİĞİ — DENETİM TURU 3.
///
/// <para>
/// Üç ayrı kusur, tek ortak tema: <b>bir para hareketi ya kesindir ya değildir; "belirsiz"i
/// kesin saymak parayı ikinci kez hareket ettirir.</b>
/// </para>
/// <list type="number">
/// <item>Manuel kontör talebi iki kez onaylanabiliyordu (kontrol işlemin dışında, kilitsiz).</item>
/// <item>Saklı kart çekiminde ara/bilinmeyen sonuç terminal "Failed" yazılıyor, sonraki tur
/// AYNI dönemi yeniden çekiyordu.</item>
/// <item>iyzico Non-3DS yolu sonucun kesinliğini (<see cref="PaymentOutcome"/>) hiç
/// işaretlemiyordu; çağıran "red mi, belirsiz mi" ayrımını yapamıyordu.</item>
/// </list>
/// </summary>
public sealed class PaymentSafetyRoundThreeTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static WhatsAppBillingService NewService(GuzellikDbContext db) =>
        new(db, NullLogger<WhatsAppBillingService>.Instance, new PaymentTestDoubles.SimulationResolver(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static async Task<Guid> SeedTenantAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Odeme QA", $"odeme-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        // Otomatik onay KAPALI olmalı: talep Pending kalsın ki elle onay yolu ölçülebilsin.
        db.WhatsAppBillingSettings.Add(new WhatsAppBillingSettings());
        await db.SaveChangesAsync();
        return tenant.Id;
    }

    /// <summary>
    /// AYNI KONTÖR TALEBİ İKİ KEZ ONAYLANAMAZ.
    ///
    /// Durum kontrolü işlemin DIŞINDA ve kilitsizdi: iki yönetici (ya da çift tıklama) aynı anda
    /// onaylayınca ikisi de "Pending" görüyor, bakiye İKİ KEZ artıyordu — kurum bir ödemeye
    /// karşılık iki kez kontör kazanıyordu.
    /// </summary>
    [Fact]
    public async Task ApprovePurchase_IsIdempotent_SecondApprovalRejected()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);

        Guid purchaseId;
        await using (var db = NewDb(options))
        {
            var requested = await NewService(db).RequestPurchaseAsync(tenantId, new TopUpRequest(null, 500m), null);
            Assert.True(requested.IsSuccess, requested.IsFailure ? requested.Error.Message : null);
            purchaseId = requested.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var first = await NewService(db).ApprovePurchaseAsync(purchaseId, null);
            Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Message : null);
        }

        await using (var db = NewDb(options))
        {
            // İKİNCİ onay REDDEDİLMELİ.
            var second = await NewService(db).ApprovePurchaseAsync(purchaseId, null);
            Assert.True(second.IsFailure);
        }

        await using (var verify = NewDb(options))
        {
            var wallet = await verify.TenantMessagingWallets.IgnoreQueryFilters()
                .SingleAsync(w => w.TenantId == tenantId);
            // Bakiye BİR kez artmalı: iki onay geçseydi 1.000 olurdu.
            Assert.Equal(500m, wallet.BalanceTry);

            // Defterde de tek yükleme satırı olmalı.
            var topUps = await verify.WalletTransactions.IgnoreQueryFilters()
                .CountAsync(t => t.TenantId == tenantId && t.Type == WalletTransactionType.TopUp);
            Assert.Equal(1, topUps);
        }
    }

    /// <summary>ONAYLANMIŞ talep ayrıca REDDEDİLEMEZ — bakiye artmışken talep "reddedildi" görünemez.</summary>
    [Fact]
    public async Task RejectPurchase_AfterApprove_IsRejected()
    {
        var options = NewOptions();
        var tenantId = await SeedTenantAsync(options);

        Guid purchaseId;
        await using (var db = NewDb(options))
        {
            var requested = await NewService(db).RequestPurchaseAsync(tenantId, new TopUpRequest(null, 300m), null);
            purchaseId = requested.Value!.Id;
        }

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).ApprovePurchaseAsync(purchaseId, null)).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewService(db).RejectPurchaseAsync(purchaseId, null, "geç kalan red")).IsFailure);

        await using (var verify = NewDb(options))
        {
            var purchase = await verify.WhatsAppCreditPurchases.IgnoreQueryFilters().SingleAsync(p => p.Id == purchaseId);
            Assert.Equal(CreditPurchaseStatus.Approved, purchase.Status);
        }
    }

    /// <summary>
    /// iyzico Non-3DS (saklı kart) çekimi SONUCUN KESİNLİĞİNİ işaretlemeli.
    ///
    /// `Outcome` hiç yazılmadığı için varsayılan `Unresolved` kalıyordu: açık bir red bile
    /// "belirsiz" görünüyor, çağıran denemeyi kapatamıyordu. Ters yön daha tehlikeli —
    /// "belirsiz"i red sayan bir çağıran, parası çekilmiş olabilecek dönemi ikinci kez çeker.
    /// </summary>
    [Fact]
    public async Task StoredCardCharge_MarksOutcome_NotDefaultUnresolved()
    {
        // Simülasyon sağlayıcısı gerçek iyzico'yu taklit eder: başarılı çekim Succeeded olmalı.
        var gateway = new SimulationPaymentGateway(PaymentTestDoubles.SigningSecret);
        var charge = await gateway.ChargeStoredCardAsync(new StoredCardChargeRequest(
            $"conv-{Guid.NewGuid():N}", 250m, "card-user", "card-token", "Abonelik",
            "buyer", "Ad", "Soyad", "a@b.c", "0555", "11111111111", "Adres", "İstanbul", "127.0.0.1"));

        Assert.True(charge.IsSuccess, charge.IsFailure ? charge.Error.Message : null);
        Assert.True(charge.Value!.Succeeded);
        // ASIL İDDİA: başarı "belirsiz" olarak damgalanamaz.
        Assert.Equal(PaymentOutcome.Succeeded, charge.Value.Outcome);
    }

    /// <summary>
    /// SORGU YOLU "bilmiyorum" derse bu RED DEĞİLDİR.
    ///
    /// Kurtarma yolu her başarısız sorguyu terminal `Failed` yazıyordu; deneme kapanınca sonraki
    /// tur AYNI dönemi yeniden çekiyor ve parası çekilmiş olabilecek kart ikinci kez çekiliyordu.
    /// </summary>
    [Fact]
    public async Task RetrievePayment_UnknownConversation_IsUnresolved_NotDeclined()
    {
        var gateway = new SimulationPaymentGateway(PaymentTestDoubles.SigningSecret);
        var probe = await gateway.RetrievePaymentAsync($"bilinmeyen-{Guid.NewGuid():N}");

        Assert.True(probe.IsSuccess, probe.IsFailure ? probe.Error.Message : null);
        Assert.False(probe.Value!.Succeeded);
        // "Bulunamadı" ≠ "reddedildi": Declined damgası denemeyi kalıcı kapatır.
        Assert.NotEqual(PaymentOutcome.Declined, probe.Value.Outcome);
    }
}

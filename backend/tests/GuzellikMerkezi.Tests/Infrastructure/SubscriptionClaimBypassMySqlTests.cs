using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ABONELİK KURTARMA YOLUNDA SAHİPLİK KAPISI (denetim turu 3'ün beşinci riski).
///
/// <para>
/// "Yanıtı kaybedilen deneme" yolu sağlayıcıya sorup "başarılıymış" cevabını alınca aboneliği
/// uzatıyordu — ama ödemeyi SAHİPLENMEDEN. Aynı sağlayıcı ödemesi hem kontör defterine hem
/// aboneliğe sayılabiliyor, TEK tahsilatla İKİ şey satın alınmış oluyordu.
/// </para>
///
/// <para>
/// BU TESTLER NEDEN MariaDB İSTER: sahiplik <c>ProviderPaymentClaims.TryClaimAsync</c> ile alınır
/// ve bağlayıcı olan tek şey BENZERSİZ İNDEKS'tir. InMemory sağlayıcı benzersiz indeksi zorlamaz;
/// orada bu koruma her zaman "başarılı" döner ve test hiçbir şey kanıtlamaz.
/// </para>
/// </summary>
public sealed class SubscriptionClaimBypassMySqlTests
{
    private const string Provider = "Simulation";
    private const string RakipOdemeKimligi = "prov-pay-tek-tahsilat";

    private sealed record Seed(Guid TenantId, Guid PaymentId, string ConversationId, DateTime EndsAtUtc);

    /// <summary>Sorgu yolunda BAŞARILI ve tutarı/anahtarı BİZİM denememizle uyuşan sonuç döner.</summary>
    private sealed class RecoveringGateway : IPaymentGateway
    {
        private readonly string _conversationId;
        private readonly decimal _amount;

        public RecoveringGateway(string conversationId, decimal amount)
        {
            _conversationId = conversationId;
            _amount = amount;
        }

        public string Provider => SubscriptionClaimBypassMySqlTests.Provider;

        public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
            Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(
                true, _conversationId, RakipOdemeKimligi, _amount, null, null, "TRY", PaymentOutcome.Succeeded)));

        // Kurtarma yolu bunları ÇAĞIRMAMALI: çağrılırsa test kasıtlı patlar (körlemesine yeniden çekim).
        public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default) =>
            throw new InvalidOperationException("Kurtarma yolunda YENİDEN ÇEKİM yapılamaz.");

        public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class FixedResolver : IPaymentGatewayResolver
    {
        private readonly IPaymentGateway _gateway;
        public FixedResolver(IPaymentGateway gateway) => _gateway = gateway;

        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Success(
                new PaymentGatewayContext(_gateway, "https://panel.test/admin/paket")));
    }

    private sealed class PassthroughEncryption : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    private static BillingService NewService(GuzellikDbContext db, IPaymentGateway gateway) =>
        new(db, new FixedResolver(gateway), new PassthroughEncryption(), new NoopAuditLogger(),
            new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
            NullLogger<BillingService>.Instance);

    /// <summary>Vadesi GELMİŞ abonelik + saklı kart + yanıtı kaybedilmiş PENDING deneme.</summary>
    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();

        var plan = new SubscriptionPlan("qa-claim", "Başlangıç", 500m, 1, 3, 500, 300, 100);
        db.SubscriptionPlans.Add(plan);

        var tenant = new Tenant("Sahiplik QA", $"sahiplik-{Guid.NewGuid():N}"[..24], "Başlangıç", TenantStatus.Active);
        tenant.AddBranch("Merkez", "İstanbul", true);
        // Bir ay önce başlatılır → bitiş BUGÜN, yani yenileme vadesi gelmiş olur.
        tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddMonths(-1));
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        db.TenantPaymentMethods.Add(new TenantPaymentMethod(
            tenant.Id, Provider, "cuzdan-anahtari", "kart-token", "1234", "MasterCard", "Bonus", "QA Bank"));

        // İşlem anahtarı DÖNEM ÖN EKİNİ taşımalı; servis denemeleri bu ön ekle bulur.
        var periodStart = tenant.SubscriptionEndsAtUtc!.Value;
        var conversationId = $"sub-{tenant.Id:N}-{periodStart:yyyyMMdd}-1";
        var payment = new SubscriptionPayment(
            tenant.Id, plan.Id, BillingPeriod.Monthly, 500m, Provider, conversationId, 1);
        db.SubscriptionPayments.Add(payment);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, payment.Id, conversationId, periodStart);
    }

    /// <summary>
    /// ÖDEME BAŞKA BİR DEFTERE SAHİPLENMİŞSE ABONELİK UZATILMAZ.
    ///
    /// <para>
    /// Sahiplik satırı var ama kontör YÜKLEME satırı yok — yani çapraz-tablo kontrolü (kontör
    /// tablosuna bakan kontrol) BU DURUMU GÖREMEZ. Eşzamanlı bir kontör callback'i tam olarak bu
    /// ara durumu bırakır. Kapıyı tutan tek şey benzersiz indeks üzerindeki sahipliktir.
    /// </para>
    /// <para>
    /// Deneme PENDING KALMALI: "başarısız" demek yeniden çekim yolunu açar ve gerçekte çekilmiş
    /// olabilecek tutar ikinci kez çekilir.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task Yenileme_OdemeBaskaDefterceSahiplenmisse_UzatmazVePendingBirakir()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // RAKİP DEFTER önce sahiplenir (kontör tarafı).
        await using (var db = database.NewContext())
        {
            db.ProviderPaymentClaims.Add(new ProviderPaymentClaim(
                Provider, RakipOdemeKimligi, ProviderPaymentClaim.WhatsAppCreditLedger, Guid.NewGuid(), seed.TenantId));
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var outcome = await NewService(db, new RecoveringGateway(seed.ConversationId, 500m))
                .ChargeRenewalAsync(seed.TenantId);

            Assert.True(outcome.IsSuccess, outcome.IsFailure ? outcome.Error.Message : null);
            // Uzatma YOK.
            Assert.False(outcome.Value!.Charged);
        }

        await using (var verify = database.NewContext())
        {
            var payment = await verify.SubscriptionPayments.IgnoreQueryFilters()
                .SingleAsync(p => p.Id == seed.PaymentId);
            // TERMINAL DAMGA YOK: insan kararı gerekir.
            Assert.Equal(SubscriptionPayment.Pending, payment.Status);

            var tenant = await verify.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == seed.TenantId);
            // Abonelik bitişi OYNAMADI — bedava bir ay verilmedi.
            Assert.True((tenant.SubscriptionEndsAtUtc!.Value - seed.EndsAtUtc).Duration() < TimeSpan.FromSeconds(1),
                $"Abonelik bitişi değişmiş: {seed.EndsAtUtc:O} → {tenant.SubscriptionEndsAtUtc:O}");

            // Rakip defterin sahipliği tek satır olarak duruyor; abonelik ikinci bir satır AÇAMADI.
            var claims = await verify.ProviderPaymentClaims.IgnoreQueryFilters()
                .Where(c => c.ProviderPaymentId == RakipOdemeKimligi).ToListAsync();
            Assert.Single(claims);
            Assert.Equal(ProviderPaymentClaim.WhatsAppCreditLedger, claims[0].Ledger);
        }
    }

    /// <summary>
    /// SAHİPSİZ ÖDEME KURTARILIR — ve sahiplik GERÇEKTEN YAZILIR.
    ///
    /// <para>
    /// Kapının "her şeyi reddeden" bir kapı olmadığını gösterir: normal kurtarma çalışır. Asıl
    /// iddia ikinci kısımdır — kurtarma sonrası AYNI ödeme kimliğini rakip bir defter artık
    /// sahiplenemez. Sahiplik yazılmasaydı bu çağrı başarılı olur ve tek tahsilat iki deftere
    /// sayılırdı.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task Yenileme_SahipsizOdemeyiKurtarir_VeSahipligiYazar()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            var outcome = await NewService(db, new RecoveringGateway(seed.ConversationId, 500m))
                .ChargeRenewalAsync(seed.TenantId);

            Assert.True(outcome.IsSuccess, outcome.IsFailure ? outcome.Error.Message : null);
            Assert.True(outcome.Value!.Charged);
        }

        await using (var verify = database.NewContext())
        {
            var payment = await verify.SubscriptionPayments.IgnoreQueryFilters()
                .SingleAsync(p => p.Id == seed.PaymentId);
            Assert.Equal(SubscriptionPayment.Succeeded, payment.Status);

            var claim = await verify.ProviderPaymentClaims.IgnoreQueryFilters()
                .SingleAsync(c => c.ProviderPaymentId == RakipOdemeKimligi);
            Assert.Equal(ProviderPaymentClaim.SubscriptionLedger, claim.Ledger);
        }

        // ASIL İDDİA: aynı ödeme kimliği ARTIK ikinci bir deftere yazılamaz.
        //
        // Sahiplenme yardımcısı `internal`; testten çağrılamıyor. Zaten bağlayıcı olan da yardımcı
        // değil, ALTINDAKİ BENZERSİZ İNDEKS — burada doğrudan o zorlanır. İndeks düşerse
        // `TryClaimAsync` sessizce "başarılı" dönmeye başlar ve koruma tamamen kaybolurdu.
        await using (var rival = database.NewContext())
        {
            rival.ProviderPaymentClaims.Add(new ProviderPaymentClaim(
                Provider, RakipOdemeKimligi, ProviderPaymentClaim.WhatsAppCreditLedger,
                Guid.NewGuid(), seed.TenantId));
            await Assert.ThrowsAsync<DbUpdateException>(() => rival.SaveChangesAsync());
        }
    }
}

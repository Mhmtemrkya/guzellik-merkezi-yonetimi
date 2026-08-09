using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// İLK CHECKOUT'TA BELİRSİZ SONUÇ TERMİNAL "Failed" OLAMAZ.
///
/// <para>
/// Kural yenileme yollarına uygulanmış ama İLK ABONELİK CHECKOUT'u atlanmıştı: orada
/// <c>!result.Succeeded</c> görülür görülmez <c>MarkFailed</c> yazılıyordu. Oysa 3DS'in
/// ortasında sorulan bir checkout "başarısız" değil BELİRSİZdir; ağ hatası ve sağlayıcı 5xx'i
/// de aynı dala düşer. Failed damgası kaydı KALICI kapatır: sonradan ödemesi geçen müşterinin
/// kaydı kapanmış olur, para karşılıksız kalır.
/// </para>
/// </summary>
public sealed class CheckoutUnresolvedOutcomeTests
{
    private const string Provider = "Simulation";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private sealed record Seed(Guid TenantId, Guid PaymentId, string ConversationId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var plan = new SubscriptionPlan("qa-checkout", "Başlangıç", 500m, 1, 3, 500, 300, 100);
        db.SubscriptionPlans.Add(plan);

        var tenant = new Tenant("Checkout QA", $"checkout-{Guid.NewGuid():N}"[..20], "Deneme", TenantStatus.Trial);
        tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var conversationId = $"sub-{tenant.Id:N}-ilk";
        var payment = new SubscriptionPayment(tenant.Id, plan.Id, BillingPeriod.Monthly, 500m, Provider, conversationId, 1);
        db.SubscriptionPayments.Add(payment);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, payment.Id, conversationId);
    }

    private static BillingService NewService(GuzellikDbContext db, PaymentOutcome outcome, string conversationId) =>
        new(db, new FixedResolver(new ProbeGateway(conversationId, outcome)), new PassthroughEncryption(),
            new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
            NullLogger<BillingService>.Instance);

    /// <summary>BELİRSİZ sonuç: kayıt PENDING kalmalı, abonelik de başlamamalı.</summary>
    [Fact]
    public async Task BelirsizSonuc_KaydiPendingBirakir()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var completed = await NewService(db, PaymentOutcome.Unresolved, seed.ConversationId)
                .CompleteCheckoutAsync("tok");
            Assert.True(completed.IsSuccess, completed.IsFailure ? completed.Error.Message : null);
            Assert.False(completed.Value!.Succeeded);
        }

        await using (var verify = NewDb(options))
        {
            var payment = await verify.SubscriptionPayments.IgnoreQueryFilters().SingleAsync(p => p.Id == seed.PaymentId);
            // TERMİNAL DAMGA YOK: sonradan gelen webhook/dönüş sonucu çözebilmeli.
            Assert.Equal(SubscriptionPayment.Pending, payment.Status);

            var tenant = await verify.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == seed.TenantId);
            Assert.Null(tenant.SubscriptionEndsAtUtc);
        }
    }

    /// <summary>
    /// KESİN RED terminal Failed OLMALI — kapı "her şeyi beklet" hâline gelmemeli.
    /// Aksi hâlde gerçekten reddedilmiş kayıtlar sonsuza dek açık kalır ve müşteri
    /// kartını düzeltse bile yeni deneme açılmaz.
    /// </summary>
    [Fact]
    public async Task KesinRed_TerminalFailedYazar()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var completed = await NewService(db, PaymentOutcome.Declined, seed.ConversationId)
                .CompleteCheckoutAsync("tok");
            Assert.True(completed.IsSuccess, completed.IsFailure ? completed.Error.Message : null);
            Assert.False(completed.Value!.Succeeded);
        }

        await using (var verify = NewDb(options))
        {
            var payment = await verify.SubscriptionPayments.IgnoreQueryFilters().SingleAsync(p => p.Id == seed.PaymentId);
            Assert.Equal(SubscriptionPayment.Failed, payment.Status);
        }
    }

    // ---- test ikizleri ----

    /// <summary>Başarısız ama KESİNLİĞİ ayarlanabilir bir checkout sonucu döner.</summary>
    private sealed class ProbeGateway : IPaymentGateway
    {
        private readonly string _conversationId;
        private readonly PaymentOutcome _outcome;

        public ProbeGateway(string conversationId, PaymentOutcome outcome)
        {
            _conversationId = conversationId;
            _outcome = outcome;
        }

        public string Provider => CheckoutUnresolvedOutcomeTests.Provider;

        public Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default) =>
            Task.FromResult(Result<CheckoutResult>.Success(new CheckoutResult(
                false, _conversationId, null, 0m, null, null, null, null, null, null,
                "PROBE", "Sonuç alınamadı.", "TRY", _outcome)));

        public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
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
}

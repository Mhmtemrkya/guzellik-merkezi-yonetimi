using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Infrastructure.Payments;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Ödeme sağlayıcısı test ikizleri — kontör ve cüzdan testleri ortak kullanır.
/// <para>
/// (<c>SubscriptionBillingTests</c> kendi özel kopyalarını taşımaya devam ediyor; çalışan bir para
/// testini yalnız kopya azaltmak için ellemedik.)
/// </para>
/// </summary>
internal static class PaymentTestDoubles
{
    /// <summary>Simülasyon form anahtarını imzalayan test sırrı (üretimde sunucu sırrı kullanılır).</summary>
    public const string SigningSecret = "qa-simulation-signing-secret";

    /// <summary>
    /// Faturalama AÇIK, otomatik onay KAPALI ve 1 kredi = ₺1 olan ayar.
    ///
    /// <para>
    /// Paket dışı (özel miktarlı) kredi alımında fiyatı SUNUCU belirler: kredi × birim fiyat.
    /// Ödeme testleri ödenen ₺ ile yüklenen krediyi aynı sayıyla okuyabilsin diye birim fiyat 1
    /// tutulur; fiyatlandırmanın kendisi ayrı bir testte (varsayılan birim fiyatla) sınanır.
    /// </para>
    /// </summary>
    public static GuzellikMerkezi.Domain.Entities.WhatsAppBillingSettings BillingOneTryPerCredit()
    {
        var settings = new GuzellikMerkezi.Domain.Entities.WhatsAppBillingSettings();
        settings.Update(billingEnabled: true, chargeSimulated: false, usdTryRate: 40m,
            lowBalanceThresholdCredits: 350m, defaultMonthlySpendCapCredits: 3500m, autoApproveTopUps: false,
            smsCreditsPerPart: 2m, creditUnitPriceTry: 1m);
        return settings;
    }

    /// <summary>Her zaman simülasyon sağlayıcısını döner (gerçek çekim yok).</summary>
    public sealed class SimulationResolver : IPaymentGatewayResolver
    {
        private readonly string _returnUrl;

        public SimulationResolver(string returnUrl = "https://panel.test/admin/whatsapp") => _returnUrl = returnUrl;

        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Success(
                new PaymentGatewayContext(new SimulationPaymentGateway(SigningSecret), _returnUrl)));
    }

    /// <summary>Ödeme altyapısı kapalı — gerçek çözücünün ayar yokken verdiği cevabın aynısı.</summary>
    public sealed class DisabledResolver : IPaymentGatewayResolver
    {
        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(Result<PaymentGatewayContext>.Failure(
                Error.Conflict("Ödeme altyapısı henüz etkin değil.")));
    }
}

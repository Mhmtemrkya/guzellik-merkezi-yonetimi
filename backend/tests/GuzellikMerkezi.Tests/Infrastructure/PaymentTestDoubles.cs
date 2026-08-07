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

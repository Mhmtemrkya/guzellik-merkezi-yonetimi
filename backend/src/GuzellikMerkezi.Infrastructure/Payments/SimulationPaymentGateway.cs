using System.Globalization;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;

namespace GuzellikMerkezi.Infrastructure.Payments;

/// <summary>
/// Gerçek çekim yapmayan simülasyon sağlayıcısı.
///
/// <para>
/// Amacı: abonelik akışının tamamını (form → callback → kart saklama → yenileme → fatura)
/// iyzico anahtarı olmadan uçtan uca çalıştırabilmek. Sağlayıcı anahtarları girilene kadar
/// varsayılan budur; canlıda <c>PaymentProvider = "Iyzico"</c> seçilir.
/// </para>
/// <para>
/// DURUM TUTMAZ: form anahtarı işlem anahtarını ve tutarı kendi içinde taşır
/// (<c>sim_{conversationId}_{kuruş}</c>), böylece sonuç sorgusu ek bir tabloya ihtiyaç duymaz.
/// </para>
/// </summary>
public sealed class SimulationPaymentGateway : IPaymentGateway
{
    public string Provider => "Simulation";

    private const string TokenPrefix = "sim_";

    public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default)
    {
        var cents = (long)Math.Round(request.AmountTry * 100, MidpointRounding.AwayFromZero);
        var token = $"{TokenPrefix}{request.ConversationId}_{cents}";
        // Kullanıcı bu adrese gider; callback ucu sonucu işleyip panele geri döndürür.
        var url = $"{request.CallbackUrl}{(request.CallbackUrl.Contains('?') ? '&' : '?')}token={Uri.EscapeDataString(token)}";
        var html =
            "<div style=\"font:14px system-ui;padding:24px;text-align:center\">" +
            "<p><strong>Simülasyon ödemesi</strong> — gerçek çekim yapılmaz.</p>" +
            $"<p><a href=\"{url}\">Ödemeyi tamamla</a></p></div>";
        return Task.FromResult(Result<CheckoutInitResult>.Success(new CheckoutInitResult(token, html, url)));
    }

    public Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default)
    {
        if (!TryParse(checkoutToken, out var conversationId, out var amount))
        {
            return Task.FromResult(Result<CheckoutResult>.Success(new CheckoutResult(
                false, string.Empty, null, 0m, null, null, null, null, null, null,
                "SIM_BAD_TOKEN", "Simülasyon form anahtarı çözümlenemedi.")));
        }

        return Task.FromResult(Result<CheckoutResult>.Success(new CheckoutResult(
            true,
            conversationId,
            $"sim-pay-{conversationId}",
            amount,
            $"sim-carduser-{conversationId}",
            $"sim-cardtoken-{conversationId}",
            "552879******0004",
            "MASTER_CARD",
            "Bonus",
            "Simülasyon Bankası",
            null,
            null)));
    }

    public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default) =>
        Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(
            true, request.ConversationId, $"sim-pay-{request.ConversationId}", request.AmountTry, null, null)));

    public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
        Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(
            true, conversationId, $"sim-pay-{conversationId}", 0m, null, null)));

    public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
        Task.FromResult(Result.Success());

    private static bool TryParse(string token, out string conversationId, out decimal amount)
    {
        conversationId = string.Empty;
        amount = 0m;
        if (string.IsNullOrWhiteSpace(token) || !token.StartsWith(TokenPrefix, StringComparison.Ordinal)) return false;
        var rest = token[TokenPrefix.Length..];
        var split = rest.LastIndexOf('_');
        if (split <= 0) return false;
        conversationId = rest[..split];
        if (!long.TryParse(rest[(split + 1)..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var cents)) return false;
        amount = cents / 100m;
        return true;
    }
}

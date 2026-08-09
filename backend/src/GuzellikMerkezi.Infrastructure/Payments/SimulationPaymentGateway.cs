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

    /// <summary>
    /// Form anahtarını İMZALAYAN gizli anahtar.
    ///
    /// <para>
    /// Anahtar eskiden yalnız <c>sim_{conversationId}_{kuruş}</c> idi: tahmin edilebilir bir işlem
    /// kimliğiyle DIŞARIDAN üretilebiliyordu. Kullanıcı callback ucuna kendi ürettiği anahtarla
    /// gelip ödeme yapmadan "başarılı" sonuç aldırabiliyordu (tutar denetimi eklenmiş olsa bile,
    /// doğru tutarla üretilen sahte anahtar geçerdi). Artık anahtar sunucu sırrıyla imzalanır ve
    /// imzasız/yanlış imzalı anahtar reddedilir.
    /// </para>
    /// </summary>
    private readonly byte[] _signingKey;

    public SimulationPaymentGateway(string signingSecret)
    {
        if (string.IsNullOrWhiteSpace(signingSecret))
            throw new ArgumentException("Simülasyon ödeme anahtarı için imza sırrı gerekli.", nameof(signingSecret));
        _signingKey = System.Text.Encoding.UTF8.GetBytes(signingSecret);
    }

    public Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default)
    {
        var cents = (long)Math.Round(request.AmountTry * 100, MidpointRounding.AwayFromZero);
        var token = $"{TokenPrefix}{request.ConversationId}_{cents}_{Sign(request.ConversationId, cents)}";
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
            // KESİN RED: anahtar imzasız/bozuk. Bu bir belirsizlik değil, geçersiz istektir —
            // beklemede bırakmak kaydı sonsuza kadar açık tutardı.
            return Task.FromResult(Result<CheckoutResult>.Success(new CheckoutResult(
                false, string.Empty, null, 0m, null, null, null, null, null, null,
                "SIM_BAD_TOKEN", "Simülasyon form anahtarı çözümlenemedi.",
                Outcome: PaymentOutcome.Declined)));
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
            null,
            Outcome: PaymentOutcome.Succeeded)));
    }

    /// <summary>
    /// Saklı kart çekimi (Non-3DS eşdeğeri). SONUCUN KESİNLİĞİ AÇIKÇA işaretlenir: `Outcome`
    /// yazılmayınca varsayılan `Unresolved` kalıyordu ve BAŞARILI bir çekim bile "belirsiz"
    /// görünüyordu — simülasyon, gerçek sağlayıcıdan farklı davranınca testler asıl hatayı
    /// gizler (bu kusur önce iyzico yolunda bulundu, burada da aynısı vardı).
    /// </summary>
    public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default) =>
        Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(
            true, request.ConversationId, $"sim-pay-{request.ConversationId}", request.AmountTry, null, null, "TRY",
            PaymentOutcome.Succeeded)));

    /// <summary>
    /// DURUM TUTMAYAN SAĞLAYICI "ÖDENDİ" DİYEMEZ.
    ///
    /// <para>
    /// Eskiden her sorguya <c>Succeeded=true</c> ve <c>tutar=0</c> dönüyordu: yanıtı kaybedilen bir
    /// denemeyi çözmek için yapılan sorgu, hiç yapılmamış bir çekimi "başarılı" ilan edip aboneliği
    /// uzatıyordu. Simülasyonun geçmiş kaydı yok; doğru cevap "bilmiyorum"dur.
    /// </para>
    /// </summary>
    public Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default) =>
        Task.FromResult(Result<ChargeResult>.Success(new ChargeResult(
            false, conversationId, null, 0m, "SIM_NO_HISTORY",
            "Simülasyon sağlayıcısı geçmiş tahsilat kaydı tutmaz.", "TRY",
            // "Bilmiyorum" RED DEĞİLDİR: Declined damgası denemeyi kalıcı kapatır ve gerçekte
            // çekilmiş olabilecek bir tutar bir daha sorgulanmaz.
            PaymentOutcome.Unresolved)));

    public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
        Task.FromResult(Result.Success());

    /// <summary>İşlem kimliği + tutarın kısaltılmış HMAC-SHA256 imzası (hex).</summary>
    private string Sign(string conversationId, long cents)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(_signingKey);
        var payload = System.Text.Encoding.UTF8.GetBytes($"{conversationId}|{cents}");
        return Convert.ToHexString(hmac.ComputeHash(payload))[..32].ToLowerInvariant();
    }

    /// <summary>
    /// Anahtarı çözer ve İMZASINI DOĞRULAR. İmza sabit zamanlı karşılaştırılır; imzasız (eski
    /// biçim) ya da yanlış imzalı anahtar geçersizdir — dışarıdan üretilen anahtar kabul edilmez.
    /// </summary>
    private bool TryParse(string token, out string conversationId, out decimal amount)
    {
        conversationId = string.Empty;
        amount = 0m;
        if (string.IsNullOrWhiteSpace(token) || !token.StartsWith(TokenPrefix, StringComparison.Ordinal)) return false;

        var parts = token[TokenPrefix.Length..].Split('_');
        if (parts.Length < 3) return false;                     // imza zorunlu

        var signature = parts[^1];
        if (!long.TryParse(parts[^2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var cents)) return false;
        var id = string.Join('_', parts[..^2]);                 // işlem kimliği '_' içerebilir
        if (id.Length == 0) return false;

        var expected = Sign(id, cents);
        if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(expected), System.Text.Encoding.UTF8.GetBytes(signature)))
        {
            return false;
        }

        conversationId = id;
        amount = cents / 100m;
        return true;
    }
}

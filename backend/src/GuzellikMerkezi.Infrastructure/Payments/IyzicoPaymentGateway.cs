using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Payments;

/// <summary>
/// iyzico ödeme sağlayıcısı.
///
/// <para>
/// KİMLİK DOĞRULAMA (IYZWSv2 / HMAC-SHA256): imza, <c>randomKey + uriPath + gövde</c> dizisinin
/// secret key ile HMAC'idir. İmza GÖNDERİLEN GÖVDENİN BİREBİR AYNISI üzerinden hesaplanmalıdır;
/// bu yüzden gövde bir kez string'e serileştirilir, hem imzada hem istekte O string kullanılır.
/// (Yeniden serileştirme boşluk/sıra farkı üretip imzayı geçersiz kılar — 401'in klasik sebebi.)
/// </para>
/// <para>
/// Eski IYZWS (SHA1 + pkiString) şeması bilerek kullanılmadı: pkiString, gövdenin sağlayıcıya özel
/// bir metin biçiminde yeniden üretilmesini gerektiriyor ve alan sırası değişince sessizce bozuluyor.
/// </para>
/// </summary>
public sealed class IyzicoPaymentGateway : IPaymentGateway
{
    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _secretKey;
    private readonly string _baseUrl;
    private readonly ILogger _logger;

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public IyzicoPaymentGateway(HttpClient http, string apiKey, string secretKey, string baseUrl, ILogger logger)
    {
        _http = http;
        _apiKey = apiKey;
        _secretKey = secretKey;
        _baseUrl = baseUrl.TrimEnd('/');
        _logger = logger;
    }

    public string Provider => "Iyzico";

    private const string CheckoutInitPath = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
    private const string CheckoutDetailPath = "/payment/iyzipos/checkoutform/auth/ecom/detail";
    private const string PaymentAuthPath = "/payment/auth";
    private const string PaymentDetailPath = "/payment/detail";
    private const string RefundPath = "/payment/refund";

    public async Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default)
    {
        var price = Money(request.AmountTry);
        var body = new Dictionary<string, object?>
        {
            ["locale"] = "tr",
            ["conversationId"] = request.ConversationId,
            ["price"] = price,
            ["paidPrice"] = price,
            ["currency"] = "TRY",
            ["basketId"] = request.ConversationId,
            ["paymentGroup"] = "SUBSCRIPTION",
            ["callbackUrl"] = request.CallbackUrl,
            // Abonelikte taksit yok: tek çekim.
            ["enabledInstallments"] = new[] { 1 },
            // Kartın saklanması bu iki alana bağlı; cüzdan anahtarı varsa yeni kart ONA eklenir,
            // yoksa iyzico yeni bir cüzdan açıp cardUserKey döner.
            ["registerCard"] = request.RegisterCard ? 1 : 0,
            ["buyer"] = Buyer(request.BuyerId, request.BuyerName, request.BuyerSurname, request.BuyerEmail,
                request.BuyerPhone, request.BuyerIdentityNumber, request.BuyerAddress, request.BuyerCity, request.BuyerIp),
            ["billingAddress"] = Address(request.BuyerName + " " + request.BuyerSurname, request.BuyerAddress, request.BuyerCity),
            ["basketItems"] = new[] { BasketItem(request.ConversationId, request.BasketItemName, price) },
        };
        if (!string.IsNullOrWhiteSpace(request.CardUserKey)) body["cardUserKey"] = request.CardUserKey;

        var response = await PostAsync(CheckoutInitPath, body, ct);
        if (response.IsFailure) return Result<CheckoutInitResult>.Failure(response.Error);

        var json = response.Value!;
        if (!IsSuccess(json))
            return Result<CheckoutInitResult>.Failure(Error.Validation(ErrorText(json, "Ödeme formu başlatılamadı.")));

        var token = Str(json, "token");
        if (string.IsNullOrWhiteSpace(token))
            return Result<CheckoutInitResult>.Failure(Error.Validation("Ödeme sağlayıcısı form anahtarı döndürmedi."));

        return Result<CheckoutInitResult>.Success(new CheckoutInitResult(
            token!, Str(json, "checkoutFormContent"), Str(json, "paymentPageUrl")));
    }

    public async Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?> { ["locale"] = "tr", ["token"] = checkoutToken };
        var response = await PostAsync(CheckoutDetailPath, body, ct);
        if (response.IsFailure) return Result<CheckoutResult>.Failure(response.Error);

        var json = response.Value!;
        var conversationId = Str(json, "conversationId") ?? string.Empty;

        // status=success YALNIZCA "sorgu çalıştı" demektir; ödemenin kendisi paymentStatus'tadır.
        // İkisini karıştırmak, başarısız ödemeyi başarılı sanıp aboneliği açardı.
        var paid = IsSuccess(json) && string.Equals(Str(json, "paymentStatus"), "SUCCESS", StringComparison.OrdinalIgnoreCase);

        return Result<CheckoutResult>.Success(new CheckoutResult(
            paid,
            conversationId,
            Str(json, "paymentId"),
            Decimal(json, "paidPrice"),
            Str(json, "cardUserKey"),
            Str(json, "cardToken"),
            MaskCard(Str(json, "binNumber"), Str(json, "lastFourDigits")),
            Str(json, "cardAssociation"),
            Str(json, "cardFamily"),
            Str(json, "cardBankName"),
            paid ? null : Str(json, "errorCode"),
            paid ? null : ErrorText(json, "Ödeme tamamlanamadı."),
            Str(json, "currency")));
    }

    public async Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default)
    {
        var price = Money(request.AmountTry);
        var body = new Dictionary<string, object?>
        {
            ["locale"] = "tr",
            ["conversationId"] = request.ConversationId,
            ["price"] = price,
            ["paidPrice"] = price,
            ["currency"] = "TRY",
            ["installment"] = 1,
            ["basketId"] = request.ConversationId,
            ["paymentChannel"] = "WEB",
            ["paymentGroup"] = "SUBSCRIPTION",
            ["paymentCard"] = new Dictionary<string, object?>
            {
                ["cardUserKey"] = request.CardUserKey,
                ["cardToken"] = request.CardToken,
            },
            ["buyer"] = Buyer(request.BuyerId, request.BuyerName, request.BuyerSurname, request.BuyerEmail,
                request.BuyerPhone, request.BuyerIdentityNumber, request.BuyerAddress, request.BuyerCity, request.BuyerIp),
            ["billingAddress"] = Address(request.BuyerName + " " + request.BuyerSurname, request.BuyerAddress, request.BuyerCity),
            ["basketItems"] = new[] { BasketItem(request.ConversationId, request.BasketItemName, price) },
        };

        var response = await PostAsync(PaymentAuthPath, body, ct);
        if (response.IsFailure) return Result<ChargeResult>.Failure(response.Error);

        var json = response.Value!;
        var ok = IsSuccess(json);
        return Result<ChargeResult>.Success(new ChargeResult(
            ok,
            Str(json, "conversationId") ?? request.ConversationId,
            Str(json, "paymentId"),
            Decimal(json, "paidPrice"),
            ok ? null : Str(json, "errorCode"),
            ok ? null : ErrorText(json, "Kartdan tahsilat yapılamadı.")));
    }

    public async Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["locale"] = "tr",
            ["conversationId"] = conversationId,
            ["paymentConversationId"] = conversationId,
        };
        var response = await PostAsync(PaymentDetailPath, body, ct);
        if (response.IsFailure) return Result<ChargeResult>.Failure(response.Error);

        var json = response.Value!;
        var ok = IsSuccess(json) && string.Equals(Str(json, "paymentStatus"), "SUCCESS", StringComparison.OrdinalIgnoreCase);
        return Result<ChargeResult>.Success(new ChargeResult(
            ok, conversationId, Str(json, "paymentId"), Decimal(json, "paidPrice"),
            ok ? null : Str(json, "errorCode"), ok ? null : ErrorText(json, "Tahsilat bulunamadı.")));
    }

    public async Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["locale"] = "tr",
            ["conversationId"] = providerPaymentId,
            ["paymentTransactionId"] = providerPaymentId,
            ["price"] = Money(amount),
            ["currency"] = "TRY",
        };
        var response = await PostAsync(RefundPath, body, ct);
        if (response.IsFailure) return Result.Failure(response.Error);
        return IsSuccess(response.Value!)
            ? Result.Success()
            : Result.Failure(Error.Validation(ErrorText(response.Value!, "İade yapılamadı.")));
    }

    // ---- HTTP + imza ----------------------------------------------------------------------

    private async Task<Result<JsonElement>> PostAsync(string path, Dictionary<string, object?> body, CancellationToken ct)
    {
        // Gövde BİR KEZ serileştirilir: imza ile gönderilen içerik birebir aynı olmak zorunda.
        var payload = JsonSerializer.Serialize(body, JsonOptions);
        var randomKey = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}{Random.Shared.Next(100000, 999999)}";

        using var message = new HttpRequestMessage(HttpMethod.Post, _baseUrl + path)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        message.Headers.TryAddWithoutValidation("Authorization", BuildAuthorization(path, payload, randomKey));
        message.Headers.TryAddWithoutValidation("x-iyzi-rnd", randomKey);

        try
        {
            using var response = await _http.SendAsync(message, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            if (string.IsNullOrWhiteSpace(text))
            {
                return Result<JsonElement>.Failure(Error.Validation(
                    $"Ödeme sağlayıcısı boş yanıt döndü (HTTP {(int)response.StatusCode})."));
            }

            using var doc = JsonDocument.Parse(text);
            return Result<JsonElement>.Success(doc.RootElement.Clone());
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // AĞ HATASI ≠ BAŞARISIZ ÖDEME. Çekim gerçekleşmiş ama yanıt kaybolmuş olabilir;
            // çağıran bunu "başarısız" sayıp körlemesine tekrar denememeli (bkz. RetrievePaymentAsync).
            _logger.LogWarning(ex, "iyzico isteği tamamlanamadı: {Path}", path);
            return Result<JsonElement>.Failure(Error.Conflict(
                "Ödeme sağlayıcısına ulaşılamadı. İşlemin durumu doğrulanmadan tekrar denenmemeli."));
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "iyzico yanıtı çözümlenemedi: {Path}", path);
            return Result<JsonElement>.Failure(Error.Validation("Ödeme sağlayıcısının yanıtı okunamadı."));
        }
    }

    private string BuildAuthorization(string path, string payload, string randomKey)
    {
        var signature = HmacHex(_secretKey, randomKey + path + payload);
        var authParams = $"apiKey:{_apiKey}&randomKey:{randomKey}&signature:{signature}";
        return "IYZWSv2 " + Convert.ToBase64String(Encoding.UTF8.GetBytes(authParams));
    }

    private static string HmacHex(string key, string data)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(data))).ToLowerInvariant();
    }

    // ---- gövde yardımcıları ---------------------------------------------------------------

    /// <summary>iyzico tutarları NOKTA ayraçlı metin bekler; yerel kültür virgül üretirse istek reddedilir.</summary>
    private static string Money(decimal amount) => amount.ToString("0.00", CultureInfo.InvariantCulture);

    private static Dictionary<string, object?> Buyer(string id, string name, string surname, string email,
        string phone, string identityNumber, string address, string city, string ip) => new()
    {
        ["id"] = id,
        ["name"] = Fallback(name, "Kurum"),
        ["surname"] = Fallback(surname, "Yetkilisi"),
        ["gsmNumber"] = Fallback(phone, "+905000000000"),
        ["email"] = Fallback(email, "fatura@beautyasist.com"),
        // iyzico TC kimlik alanını zorunlu tutar; kurumsal müşteride vergi no ya da 11 haneli
        // dolgu kullanılır (doğrulama yapmaz, format bekler).
        ["identityNumber"] = Fallback(identityNumber, "11111111111"),
        ["registrationAddress"] = Fallback(address, "Belirtilmedi"),
        ["city"] = Fallback(city, "İstanbul"),
        ["country"] = "Turkey",
        ["ip"] = Fallback(ip, "127.0.0.1"),
    };

    private static Dictionary<string, object?> Address(string contactName, string address, string city) => new()
    {
        ["contactName"] = Fallback(contactName, "Kurum Yetkilisi"),
        ["city"] = Fallback(city, "İstanbul"),
        ["country"] = "Turkey",
        ["address"] = Fallback(address, "Belirtilmedi"),
    };

    private static Dictionary<string, object?> BasketItem(string id, string name, string price) => new()
    {
        ["id"] = id,
        ["name"] = Fallback(name, "Abonelik"),
        ["category1"] = "Abonelik",
        ["itemType"] = "VIRTUAL",
        ["price"] = price,
    };

    private static string Fallback(string? value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    // ---- yanıt okuma ----------------------------------------------------------------------

    private static bool IsSuccess(JsonElement json) =>
        json.TryGetProperty("status", out var s) && string.Equals(s.GetString(), "success", StringComparison.OrdinalIgnoreCase);

    private static string? Str(JsonElement json, string name) =>
        json.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.String ? v.GetString() : null;

    private static decimal Decimal(JsonElement json, string name)
    {
        if (!json.TryGetProperty(name, out var v)) return 0m;
        return v.ValueKind switch
        {
            JsonValueKind.Number => v.GetDecimal(),
            JsonValueKind.String when decimal.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d) => d,
            _ => 0m,
        };
    }

    private static string ErrorText(JsonElement json, string fallback)
    {
        var message = Str(json, "errorMessage");
        var code = Str(json, "errorCode");
        if (string.IsNullOrWhiteSpace(message)) return fallback;
        return string.IsNullOrWhiteSpace(code) ? message! : $"{message} ({code})";
    }

    private static string? MaskCard(string? bin, string? lastFour)
    {
        if (string.IsNullOrWhiteSpace(bin) && string.IsNullOrWhiteSpace(lastFour)) return null;
        return $"{bin ?? "******"}******{lastFour ?? "****"}";
    }
}

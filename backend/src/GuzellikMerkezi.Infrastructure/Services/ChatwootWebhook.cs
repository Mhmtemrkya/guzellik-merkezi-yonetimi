using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>Chatwoot olayından çıkarılan, işlenecek tek müşteri yanıtı.</summary>
/// <param name="InboxId">Chatwoot gelen kutusu — kurum bu kimlikle bulunur (<c>WhatsAppSettings.ChatwootInboxId</c>).</param>
/// <param name="FromPhone">Müşterinin numarası, yalnız rakam (Meta'nın <c>from</c>/wa_id biçimi).</param>
/// <param name="Text">Mesaj metni.</param>
/// <param name="MessageId">Tekilleştirme anahtarı: Meta mesaj kimliği (wamid) ya da yoksa <c>cw:{chatwoot id}</c>.</param>
public sealed record ChatwootInbound(int InboxId, string FromPhone, string Text, string MessageId);

/// <summary>
/// Ayrıştırma sonucu: işlenecek yanıt ya da NEDEN yok sayıldığı. Neden yalnız yapısal bilgidir (olay adı,
/// mesaj türü, kanal; mesaj metni ve telefon ASLA) — canlıda "hiç gelmedi" ile "geldi ama reddedildi"
/// ayırt edilebilsin diye günlüğe yazılır (Chatwoot hesap webhook'unu yeniden DENEMEZ; kaçan yanıt kaybolur).
/// </summary>
/// <param name="Routine">Beklenen gürültü (temsilci yanıtı, özel not, başka olay): günlükte Debug seviyesinde kalır.</param>
public sealed record ChatwootParseResult(ChatwootInbound? Inbound, string? IgnoredReason, bool Routine)
{
    internal static ChatwootParseResult Ignore(string reason, bool routine = false) => new(null, reason, routine);
}

/// <summary>
/// CHATWOOT KÖPRÜSÜ — kimlik doğrulama ve olay ayrıştırma (saf, durumsuz; bkz. <see cref="WhatsAppService.HandleChatwootInboundAsync"/>).
///
/// <para>
/// <b>Neden var:</b> Meta, bir uygulamanın bir numarasının olaylarını TEK adrese yollar ve bu adres Chatwoot'tur
/// (canlı destek orada yürür). Müşteri yanıtları (randevu EVET/HAYIR/ERTELE, KVKK ONAYLIYORUM, bekleme listesi
/// EVET) BeautyAsist'e Chatwoot'un kendi webhook'uyla ulaşır ve Meta'dan gelmiş gibi aynı yoldan işlenir.
/// </para>
///
/// <para>
/// <b>İki kabul yolu, ikisi de AYNI platform anahtarıyla</b> (Chatwoot sürümüne göre):
/// (1) Chatwoot webhook'u imzalıyorsa <c>X-Chatwoot-Signature</c> = <c>sha256=</c> + HMAC-SHA256(anahtar,
/// <c>"{X-Chatwoot-Timestamp}.{ham gövde}"</c>) ve zaman damgası en çok <see cref="MaxSignatureAge"/> eski;
/// (2) imzalamıyorsa webhook adresinin sonundaki uzun rastgele anahtar. Karşılaştırmalar sabit zamanlıdır.
/// </para>
/// </summary>
public static class ChatwootWebhook
{
    /// <summary>İmzalı isteğin kabul edilen en büyük yaşı (tekrar oynatma freni).</summary>
    public static readonly TimeSpan MaxSignatureAge = TimeSpan.FromMinutes(5);

    private const string SignaturePrefix = "sha256=";

    /// <summary>
    /// İstek bu anahtarla gönderilmiş mi? <paramref name="pathToken"/> verilmişse (adreste anahtar yolu) yalnız o
    /// karşılaştırılır; verilmemişse imza başlıkları ZORUNLUDUR.
    /// </summary>
    public static bool IsAuthorized(string secret, string rawBody, string? pathToken, string? signatureHeader, string? timestampHeader, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(secret)) return false;
        if (pathToken is not null)
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(pathToken), Encoding.UTF8.GetBytes(secret));

        if (string.IsNullOrWhiteSpace(signatureHeader) || string.IsNullOrWhiteSpace(timestampHeader)) return false;
        var timestamp = timestampHeader.Trim();
        // DateTimeOffset'in taşıyabildiği aralık dışı değer FromUnixTimeSeconds'ı patlatır: önce eleriz.
        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var unix) || unix > 253_402_300_799) return false;
        if ((now - DateTimeOffset.FromUnixTimeSeconds(unix)).Duration() > MaxSignatureAge) return false;

        var provided = signatureHeader.Trim();
        if (!provided.StartsWith(SignaturePrefix, StringComparison.OrdinalIgnoreCase)) return false;
        byte[] providedBytes;
        try { providedBytes = Convert.FromHexString(provided[SignaturePrefix.Length..]); }
        catch (FormatException) { return false; }

        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{timestamp}.{rawBody}"));
        return CryptographicOperations.FixedTimeEquals(providedBytes, expected);
    }

    /// <summary>
    /// "message_created" olayından yalnız WhatsApp'tan GELEN, herkese açık METİN mesajını çıkarır; gerisi
    /// (giden, özel not, ek, başka kanal, bilinmeyen olay) <c>null</c>. Biçimsiz JSON <see cref="JsonException"/> atar.
    /// <para>
    /// Telefon önce konuşmanın <c>contact_inbox.source_id</c>'sinden okunur (Meta'daki wa_id ile birebir), yoksa
    /// göndericinin numarasından. Tekilleştirme anahtarı Meta mesaj kimliğidir (<c>source_id</c> = wamid): Meta
    /// webhook'u ileride BeautyAsist'e de gelse aynı mesaj iki yoldan iki kez işlenmez.
    /// </para>
    /// </summary>
    public static ChatwootInbound? Parse(string payloadJson) => Read(payloadJson).Inbound;

    /// <summary><see cref="Parse"/> ile aynı kurallar; ek olarak yok sayma NEDENİNİ döner (günlük için).</summary>
    public static ChatwootParseResult Read(string payloadJson)
    {
        using var doc = JsonDocument.Parse(payloadJson);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return ChatwootParseResult.Ignore("gövde nesne değil");
        var eventName = Str(root, "event");
        if (eventName != "message_created") return ChatwootParseResult.Ignore($"olay={Clip(eventName)}", routine: true);

        // message_type webhook'ta metindir ("incoming", Message#webhook_data enum adını yazar); API biçiminde sayı (0).
        if (!root.TryGetProperty("message_type", out var type))
            return ChatwootParseResult.Ignore("message_type yok");
        var incoming =
            (type.ValueKind == JsonValueKind.String && type.GetString() == "incoming") ||
            (type.ValueKind == JsonValueKind.Number && type.TryGetInt32(out var typeNumber) && typeNumber == 0);
        if (!incoming)
        {
            var raw = type.ValueKind == JsonValueKind.String ? type.GetString() : type.GetRawText();
            // Temsilci yanıtı / etkinlik / şablon beklenen gürültüdür; tanınmayan bir değer ise biçim değişikliği işaretidir.
            var routine = raw is "outgoing" or "activity" or "template" or "1" or "2" or "3";
            return ChatwootParseResult.Ignore($"message_type={Clip(raw)}", routine);
        }
        if (root.TryGetProperty("private", out var isPrivate) && isPrivate.ValueKind == JsonValueKind.True)
            return ChatwootParseResult.Ignore("özel not", routine: true);
        var contentType = Str(root, "content_type");
        if (contentType is not null && contentType != "text") return ChatwootParseResult.Ignore($"content_type={Clip(contentType)}");
        var text = Str(root, "content");
        if (string.IsNullOrWhiteSpace(text)) return ChatwootParseResult.Ignore("metin boş");

        var conversation = root.TryGetProperty("conversation", out var c) && c.ValueKind == JsonValueKind.Object ? c : (JsonElement?)null;
        var channel = conversation is { } conv ? Str(conv, "channel") : null;
        if (channel is not null && channel != "Channel::Whatsapp") return ChatwootParseResult.Ignore($"kanal={Clip(channel)}");

        int? inboxId = root.TryGetProperty("inbox", out var inbox) && inbox.ValueKind == JsonValueKind.Object ? Int(inbox, "id") : null;
        inboxId ??= conversation is { } conv2 ? Int(conv2, "inbox_id") : null;
        inboxId ??= Int(root, "inbox_id");
        if (inboxId is not > 0) return ChatwootParseResult.Ignore("gelen kutusu kimliği yok");

        string? phone = null;
        if (conversation is { } conv3 && conv3.TryGetProperty("contact_inbox", out var contactInbox) && contactInbox.ValueKind == JsonValueKind.Object)
            phone = Str(contactInbox, "source_id");
        if (string.IsNullOrWhiteSpace(phone) && root.TryGetProperty("sender", out var sender) && sender.ValueKind == JsonValueKind.Object)
            phone = Str(sender, "phone_number");
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length < 7) return ChatwootParseResult.Ignore("telefon yok");

        var sourceId = Str(root, "source_id");
        var messageId = !string.IsNullOrWhiteSpace(sourceId) ? sourceId : Int(root, "id") is { } chatwootId ? $"cw:{chatwootId}" : null;
        if (messageId is null) return ChatwootParseResult.Ignore("mesaj kimliği yok");

        return new ChatwootParseResult(new ChatwootInbound(inboxId.Value, digits, text, messageId), null, false);
    }

    /// <summary>Günlüğe giden yapısal değer: denetim karakteri yok, en çok 40 karakter (log enjeksiyonu/şişmesi freni).</summary>
    private static string Clip(string? value) =>
        value is null ? "(yok)" : new string(value.Where(ch => !char.IsControl(ch)).Take(40).ToArray());

    private static string? Str(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? Int(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : null;
}

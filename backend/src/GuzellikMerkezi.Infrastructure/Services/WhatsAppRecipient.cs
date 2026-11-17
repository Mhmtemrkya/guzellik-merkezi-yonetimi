using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Meta Cloud API'ye giden alıcı numarası (<c>to</c>) — her zaman <b>"+" ve ülke koduyla</b>.
/// </summary>
/// <remarks>
/// <para>
/// NEDEN: Meta, başında "+" olmayan numaranın önüne <b>gönderen işletme numarasının ülke kodunu
/// ekler</b>. Türkiye'deki bir işletme için kayıtlı "0532 123 45 67" rakamlara indirilince
/// "05321234567" olur ve Meta bunu "+90 05321234567" diye okur, yani yanlış numaraya gider ya da
/// hiç teslim edilmez. Meta'nın önerisi numarayı "+" ve ülke koduyla göndermektir
/// (Cloud API, "WhatsApp user phone number formats").
/// </para>
/// <para>
/// YALNIZ YÜKTEKİ <c>to</c> ALANI İÇİN. Saklanan numara (mesaj satırı, eşleştirme) rakam olarak
/// kalır: gelen yanıtlar ve 24 saat penceresi son 10 haneyle eşleşir
/// (<c>SearchText.NormalizePhone</c>). Ortak <c>NormalizePhone</c> yardımcılarına bu yüzden
/// dokunulmadı; SMS sağlayıcıları (Netgsm baştaki 0'ı kabul eder) onların çıktısına dayanır.
/// </para>
/// </remarks>
public static class WhatsAppRecipient
{
    /// <param name="digits">Yalnız rakamlardan oluşan numara (ör. <c>NormalizePhone</c> çıktısı).</param>
    /// <returns>"+905321234567" biçimi; boş girdi boş döner.</returns>
    public static string Format(string? digits)
    {
        var d = new string((digits ?? string.Empty).Where(char.IsDigit).ToArray());
        if (d.Length == 0) return string.Empty;

        // "00" uluslararası çıkış öneki: 0049… → +49…
        if (d.Length > 4 && d.StartsWith("00", StringComparison.Ordinal)) return "+" + d[2..];

        // Türkiye yerel biçimleri (SMS yolundaki ToMsisdn ile aynı kurallar).
        if (d.Length == 12 && d.StartsWith("90", StringComparison.Ordinal)) return "+" + d;
        if (d.Length == 13 && d.StartsWith("900", StringComparison.Ordinal)) return "+90" + d[3..]; // "+90 0532…" yazımı
        if (d.Length == 11 && d[0] == '0') return "+90" + d[1..];
        // 10 hane = baştaki 0'ı yazılmamış Türkiye numarası (cep 5xx ya da sabit hat 212…).
        // Eskiden "+"sız giden bu numaraya Meta zaten +90 ekliyordu; davranış korunur.
        if (d.Length == 10) return "+90" + d;

        // Diğerleri ülke koduyla kaydedilmiş sayılır (ör. "+1 555…" → +1555…).
        return "+" + d;
    }

    /// <summary>
    /// Meta'nın yanıttaki <c>contacts[0].wa_id</c> değeri gönderdiğimiz numarayla aynı mı?
    /// Farklıysa Meta numarayı başka biçimde çözmüştür (yanlış kişiye gidebilir) ve bu loglanmalı.
    /// Brezilya/Meksika numaralarında Meta öneki bilerek değiştirebilir; orada fark uyarı sayılır, hata değil.
    /// </summary>
    public static bool SameAsSent(string sentTo, string? waId)
    {
        if (string.IsNullOrWhiteSpace(waId)) return true; // yanıt alanı yoksa karşılaştırılacak bir şey yok
        var sent = new string(sentTo.Where(char.IsDigit).ToArray());
        var got = new string(waId.Where(char.IsDigit).ToArray());
        return sent == got;
    }

    /// <summary>
    /// Kabul edilen gönderimin alıcısını loglar (maskeli). Numara biçiminin doğru çözüldüğünü
    /// görmenin tek yolu Meta'nın döndürdüğü <c>wa_id</c>'dir; fark varsa UYARI yazılır.
    /// </summary>
    public static void LogAccepted(ILogger logger, JsonElement response, string sentTo, string? messageId)
    {
        string? waId = null;
        if (response.TryGetProperty("contacts", out var contacts) && contacts.ValueKind == JsonValueKind.Array
            && contacts.GetArrayLength() > 0 && contacts[0].TryGetProperty("wa_id", out var w))
            waId = w.GetString();

        if (SameAsSent(sentTo, waId))
            logger.LogInformation("[WhatsApp] Meta gönderimi kabul etti: {MessageId}, alıcı {Recipient}",
                messageId, PhoneMask.Mask(sentTo));
        else
            logger.LogWarning("[WhatsApp] Meta alıcıyı FARKLI çözdü: gönderilen {Sent}, wa_id {WaId} ({MessageId}). Numara biçimini kontrol edin.",
                PhoneMask.Mask(sentTo), PhoneMask.Mask(waId), messageId);
    }
}

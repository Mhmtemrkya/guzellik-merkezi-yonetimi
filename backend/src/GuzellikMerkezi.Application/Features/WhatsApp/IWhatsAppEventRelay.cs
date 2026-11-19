namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>
/// OLAYLAR ÖNCE BEAUTYASIST'E: Meta webhook'u BeautyAsist'e gelir; imzası doğrulanan her olay (müşteri mesajı,
/// teslim/okundu durumu, temsilci yanıtlarının durumu dahil) AYNEN Chatwoot'a iletilir ki canlı destek
/// konuşmaları orada görünmeye devam etsin. Gövde ve <c>X-Hub-Signature-256</c> değişmeden gider; Chatwoot
/// imzayı aynı uygulama sırrıyla doğrular ve olayı gövdedeki numaraya göre doğru gelen kutusuna koyar.
/// </summary>
public interface IWhatsAppEventRelay
{
    /// <summary>
    /// Olayı iletir: önce DOĞRUDAN (kısa zaman aşımı); olmazsa kalıcı kuyruğa yazar (uzun yeniden deneme).
    /// İletim adresi tanımlı değilse hiçbir şey yapmaz.
    /// <para>
    /// Kuyruğa da yazılamazsa İSTİSNA fırlatır: çağıran Meta'ya 200 DÖNMEMELİ ki Meta olayı yeniden göndersin
    /// (aksi hâlde olay Chatwoot için kaybolur).
    /// </para>
    /// </summary>
    Task RelayAsync(string payloadJson, string signatureHeader, CancellationToken cancellationToken = default);

    /// <summary>Kuyruktaki iletimi bir kez dener; başarısızsa istisna fırlatır (kuyruk yeniden dener).</summary>
    Task SendQueuedAsync(string payloadJson, string signatureHeader, CancellationToken cancellationToken = default);
}

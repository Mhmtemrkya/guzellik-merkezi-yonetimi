using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Idempotent istek kaydı: masaüstü çevrimdışı kuyruğu (outbox) bağlantı gelince istekleri
/// yeniden oynatır; kesinti/tekrar durumunda aynı <c>Idempotency-Key</c> ikinci kez geldiğinde
/// endpoint YENİDEN çalıştırılmaz, burada saklanan ilk yanıt aynen döndürülür (çift kayıt önlenir).
/// Tenant kapsam filtresine girmez; yalnızca soft-delete süzülür (BackgroundJob ile aynı model).
/// </summary>
public sealed class ProcessedClientRequest : Entity
{
    private ProcessedClientRequest() { }

    public ProcessedClientRequest(
        Guid tenantId,
        Guid userId,
        string idempotencyKey,
        string method,
        string path,
        int statusCode,
        string? contentType,
        string? responseBody,
        string? requestFingerprint = null)
    {
        if (string.IsNullOrWhiteSpace(idempotencyKey)) throw new DomainException("Idempotency anahtarı zorunlu.");
        TenantId = tenantId;
        UserId = userId;
        IdempotencyKey = idempotencyKey.Trim();
        Method = method;
        Path = path.Length > 512 ? path[..512] : path;
        StatusCode = statusCode;
        ContentType = contentType;
        ResponseBody = responseBody;
        RequestFingerprint = requestFingerprint;
    }

    public Guid TenantId { get; private set; }
    public Guid UserId { get; private set; }
    public string IdempotencyKey { get; private set; } = string.Empty;
    public string Method { get; private set; } = string.Empty;
    public string Path { get; private set; } = string.Empty;

    /// <summary>
    /// İSTEĞİN PARMAK İZİ — metot + yol + sorgu dizesi + gövdenin SHA-256'sı.
    ///
    /// <para>
    /// Anahtar tek başına yetmez: idempotency anahtarı istemcinin ürettiği serbest bir dizedir.
    /// Aynı anahtar BAŞKA bir uca ya da başka bir gövdeyle gönderilirse (istemci hatası, kuyruk
    /// yeniden kullanımı, kötü niyet) sistem eski ve ALAKASIZ yanıtı geri oynatıyor, YENİ mutasyonu
    /// sessizce atlıyordu — kullanıcı "kaydedildi" görüyor ama hiçbir şey yazılmamış oluyordu.
    /// Parmak izi eşleşmezse istek 409 <c>IdempotencyKeyReuse</c> ile açıkça reddedilir.
    /// </para>
    /// <para>
    /// Eski kayıtlarda (bu alan eklenmeden önce yazılanlar) <c>null</c>'dur; o kayıtlarda eski
    /// davranış korunur — geçiş sırasında kimsenin akışı kırılmasın.
    /// </para>
    /// </summary>
    public string? RequestFingerprint { get; private set; }

    /// <summary>Yanıt kodu. <c>0</c> = anahtar REZERVE edildi, istek hâlâ işleniyor (henüz yanıt yok).</summary>
    public int StatusCode { get; private set; }
    public string? ContentType { get; private set; }
    public string? ResponseBody { get; private set; }

    /// <summary>Yanıt henüz üretilmemiş (yalnızca rezervasyon) mi?</summary>
    public bool IsPending => StatusCode == 0;

    /// <summary>
    /// Rezervasyonu gerçek yanıtla tamamlar.
    /// <para>
    /// Kayıt eskiden yalnızca iş BİTTİKTEN sonra ekleniyordu; aynı anahtarla eşzamanlı gelen iki
    /// istek ön kontrolden birlikte geçip işi İKİ KEZ yapabiliyordu (çift tahsilat). Artık anahtar
    /// önce rezerve edilir (unique indeks ikinciyi eler), yanıt sonra buraya yazılır.
    /// </para>
    /// </summary>
    public void Complete(int statusCode, string? contentType, string? responseBody)
    {
        StatusCode = statusCode;
        ContentType = contentType;
        ResponseBody = responseBody;
        Touch();
    }
}

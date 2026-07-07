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
        string? responseBody)
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
    }

    public Guid TenantId { get; private set; }
    public Guid UserId { get; private set; }
    public string IdempotencyKey { get; private set; } = string.Empty;
    public string Method { get; private set; } = string.Empty;
    public string Path { get; private set; } = string.Empty;
    public int StatusCode { get; private set; }
    public string? ContentType { get; private set; }
    public string? ResponseBody { get; private set; }
}

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Maydanoz bağlayıcısının (<c>/api/connector/v1</c>) TEK KULLANIMLIK istek kimliği.
/// <para>
/// İmzalı bir istek yakalanıp tekrar gönderilirse imza yine geçerlidir; tekrarı bu tablodaki
/// benzersiz (anahtar, nonce) indeksi durdurur. Zaman damgası ±5 dakikayla sınırlı olduğu için
/// kayıt 10 dakika saklanır, sonra süpürülür. Bellek içi depo KULLANILMAZ: birden çok API örneği
/// ya da yeniden başlatma tekrarı geçirirdi.
/// </para>
/// </summary>
public sealed class ConnectorNonce
{
    private ConnectorNonce() { }

    public ConnectorNonce(string keyId, string nonce, DateTime expiresAtUtc)
    {
        KeyId = keyId;
        Nonce = nonce;
        ExpiresAtUtc = expiresAtUtc;
    }

    public long Id { get; private set; }
    public string KeyId { get; private set; } = string.Empty;
    public string Nonce { get; private set; } = string.Empty;
    public DateTime ExpiresAtUtc { get; private set; }
}

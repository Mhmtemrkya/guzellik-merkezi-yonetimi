using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Evrensel onay kapısının yakaladığı HTTP isteğini (PendingOperationType.HttpReplay payload'u),
/// kurum yöneticisi onayladığında aynen yeniden çalıştırır (replay). Başarısızsa onay commit edilmez.
/// </summary>
public interface IApprovalReplayer
{
    /// <param name="idempotencyKey">
    /// KARARLI anahtar (bekleyen işlem Id'sinden türetilir). Hedef uç bu anahtarla mutasyonu
    /// TAM BİR KEZ uygular: hedef commit ettikten sonra yanıt yolda kaybolsa bile aynı anahtarla
    /// yapılan tekrar, saklanan ilk yanıtı döndürür ve iş İKİNCİ KEZ YAPILMAZ.
    /// </param>
    Task<Result<Guid?>> ReplayAsync(string payloadJson, string idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sonucu BİLİNMEYEN replay hatası (taşıma hatası / 5xx). Bu durumda işlem uygulanmış OLABİLİR;
    /// çağıran sahiplenmeyi serbest bırakmamalı, uzlaştırma (retry) yoluna gitmelidir.
    /// </summary>
    public const string UnknownOutcomeCode = "ReplayUnknown";
}

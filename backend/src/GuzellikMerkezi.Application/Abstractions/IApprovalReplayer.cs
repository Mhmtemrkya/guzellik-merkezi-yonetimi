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
    /// <param name="requesterAccessToken">
    /// İSTEK SAHİBİNİN kapsamıyla üretilmiş KISA ÖMÜRLÜ token.
    /// <para>
    /// Replay eskiden ONAYLAYANIN token'ıyla gidiyordu: personelin isteği kurum sahibinin geniş
    /// yetkisiyle çalışıyordu (privilege laundering). Şube A personeli gövdeye Şube B kimlikleri
    /// koyup onaylatınca kapsam denetimleri onaylayanın yetkisine göre değerlendiği için işlem
    /// geçiyordu; ayrıca isteği açan personel sonradan pasifleştirilse/izni alınsa bile işlem
    /// uygulanabiliyordu. Token istek sahibinin GÜNCEL rol/izin/şube kapsamıyla üretilir; böylece
    /// uçtaki ve servisteki tüm kapsam kontrolleri doğru kimlik üzerinde yeniden çalışır.
    /// </para>
    /// </param>
    Task<Result<Guid?>> ReplayAsync(string payloadJson, string idempotencyKey, string requesterAccessToken, CancellationToken cancellationToken = default);

    /// <summary>Onay replay'ini işaretleyen claim — personel onay kapısı bu isteği yeniden taslağa ALMAZ.</summary>
    public const string ReplayClaimType = "replay_of";

    /// <summary>
    /// Sonucu BİLİNMEYEN replay hatası (taşıma hatası / 5xx). Bu durumda işlem uygulanmış OLABİLİR;
    /// çağıran sahiplenmeyi serbest bırakmamalı, uzlaştırma (retry) yoluna gitmelidir.
    /// </summary>
    public const string UnknownOutcomeCode = "ReplayUnknown";
}

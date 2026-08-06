using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// ONAY REPLAY'İNİN ÇALIŞACAĞI KİMLİK — isteği AÇAN personelin güncel kapsamı.
///
/// <para>
/// Replay onaylayanın (kurum sahibi) token'ıyla yapılıyordu: istek, sahibinin değil ONAYLAYANIN
/// yetkisiyle çalışıyordu. Sonuçları: (1) Şube A personeli gövdeye Şube B kimliklerini koyup
/// onaylatarak şubeler arası mutasyon yaptırabiliyordu — kapsam kontrolleri onaylayanın geniş
/// yetkisine göre değerlendiriliyordu; (2) isteği açan personel sonradan pasifleştirilse, başka
/// şubeye alınsa ya da izni geri alınsa bile bekleyen istek uygulanabiliyordu.
/// </para>
/// <para>
/// Bu servis onay ANINDA istek sahibini yeniden doğrular ve yalnız o kapsamda, kısa ömürlü,
/// tek işe özel bir token üretir. Doğrulama başarısızsa onay HİÇBİR MUTASYON YAPMADAN reddedilir.
/// </para>
/// </summary>
public interface IApprovalRequesterScope
{
    /// <param name="operationBranchId">İsteğin kaydedildiği (değişmez) şube kapsamı.</param>
    /// <param name="operationId">Replay işaretlemesi için bekleyen işlem kimliği.</param>
    /// <param name="requesterSecurityStampUtc">
    /// İstek gönderilirken kaydedilen güvenlik damgası. Onay anındaki damga bundan FARKLIYSA
    /// aradan bir iptal olayı (parola sıfırlama, zorunlu çıkış, yetki değişimi) geçmiş demektir ve
    /// işlem uygulanmaz. Eski kayıtlarda <c>null</c>'dur; o durumda karşılaştırma yapılmaz.
    /// </param>
    Task<Result<string>> CreateAccessTokenAsync(
        Guid tenantId, Guid requesterUserId, Guid? operationBranchId, Guid operationId,
        DateTime? requesterSecurityStampUtc = null, CancellationToken cancellationToken = default);
}

namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Müşteri onam formu kaydının yaşam döngüsü.</summary>
public enum ConsentFormStatus
{
    /// <summary>Personel formu açtı/doldurdu, henüz imzaya gönderilmedi.</summary>
    Draft = 0,

    /// <summary>Tablete aktarıldı; müşterinin okuyup imzalaması bekleniyor (token geçerli).</summary>
    AwaitingSignature = 1,

    /// <summary>Müşteri onay kutularını işaretleyip imzaladı — kayıt kilitlenir.</summary>
    Signed = 2,

    /// <summary>Personel vazgeçti ya da imza oturumu iptal edildi.</summary>
    Cancelled = 3,
}

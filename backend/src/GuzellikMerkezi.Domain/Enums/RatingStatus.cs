namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Müşteri memnuniyet yıldızının yaşam döngüsü.</summary>
public enum RatingStatus
{
    /// <summary>Link üretildi, müşteri henüz puanlamadı (15 dk geçerli).</summary>
    Pending = 0,

    /// <summary>Müşteri telefon eşleşmesiyle puanladı — ortalamaya katılır.</summary>
    Submitted = 1,

    /// <summary>15 dk doldu, puanlanmadan geçersiz oldu.</summary>
    Expired = 2,
}

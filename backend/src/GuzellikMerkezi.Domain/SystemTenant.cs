namespace GuzellikMerkezi.Domain;

/// <summary>
/// Kuruma bağlı olmayan (kendi kayıt olan / bireysel) müşterilerin tutulduğu sistem kurumu.
/// Bu kuruma bağlı müşteri = "pazaryeri" müşterisi: tüm kurumları görüp randevu alabilir.
/// Bir kuruma randevu alındığında o kurum altında gölge müşteri kaydı açılır (kurum izolasyonu korunur).
/// </summary>
public static class SystemTenant
{
    public const string IndividualSlug = "bireysel-musteriler";
    public const string IndividualName = "Bireysel Müşteriler";
    public const string IndividualBranchName = "Bireysel";
}

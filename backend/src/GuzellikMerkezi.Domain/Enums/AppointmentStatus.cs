namespace GuzellikMerkezi.Domain.Enums;

public enum AppointmentStatus
{
    Scheduled = 1,
    Confirmed = 2,
    Completed = 3,
    Cancelled = 4,
    NoShow = 5,
    /// <summary>Personel tarafından önerilen, kurum yöneticisi onayı bekleyen taslak randevu. Onaylanınca Scheduled olur.</summary>
    Draft = 6,
    /// <summary>Müşteri şu an işlemde (hizmet uygulanıyor). Çizelgede mor kart; bitince Completed yapılır.</summary>
    InProgress = 7
}

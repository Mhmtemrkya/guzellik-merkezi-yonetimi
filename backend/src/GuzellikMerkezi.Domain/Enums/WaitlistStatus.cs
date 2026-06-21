namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Bekleme listesi kaydının durumu.</summary>
public enum WaitlistStatus
{
    /// <summary>Sırada bekliyor.</summary>
    Waiting = 0,

    /// <summary>Boşalan yer için bilgilendirildi (teklif gönderildi).</summary>
    Notified = 1,

    /// <summary>Randevuya dönüştürüldü.</summary>
    Booked = 2,

    /// <summary>İptal edildi / vazgeçti.</summary>
    Cancelled = 3,
}

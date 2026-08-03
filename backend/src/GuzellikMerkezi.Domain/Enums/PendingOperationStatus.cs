namespace GuzellikMerkezi.Domain.Enums;

public enum PendingOperationStatus
{
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Cancelled = 3,

    /// <summary>
    /// SAHİPLENİLDİ — bir yönetici onayı başlattı, asıl operasyon (HTTP replay / dispatcher)
    /// şu anda yürüyor. Onay iki adımlıdır çünkü replay AYRI bir bağlantıda çalışır: bu satırı
    /// önce atomik olarak sahiplenmezsek iki eşzamanlı onay aynı işlemi İKİ KEZ uygulayabilirdi
    /// (satış, tahsilat, silme...). Replay başarılıysa Approved'a, başarısızsa Pending'e döner.
    /// </summary>
    Processing = 4,
}

/// <summary>
/// Personel tarafından önerilen işlem tipi. ApprovalDispatcher onaylanan operasyonu bu tipe göre yürütür.
/// </summary>
public enum PendingOperationType
{
    CreateCustomer = 0,
    UpdateCustomer = 1,
    DeleteCustomer = 2,
    CreateAppointment = 10,
    UpdateAppointment = 11,
    ChangeAppointmentStatus = 12,
    DeleteAppointment = 13,
    CreateExpense = 20,
    DeleteExpense = 21,
    CreateAccount = 30,
    RegisterAccountPayment = 31,
    RescheduleAccount = 32,
    CreateStockMovement = 40,
    CreateProduct = 41,
    Other = 99,
    /// <summary>Evrensel personel onay kapısı: yakalanan HTTP isteği (method+path+body). Onayda aynen replay edilir.</summary>
    HttpReplay = 100,
}

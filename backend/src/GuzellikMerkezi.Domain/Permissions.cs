namespace GuzellikMerkezi.Domain;

/// <summary>
/// Personel için sayfa bazlı izinler. Her key bir frontend sayfasına / iş alanına denk gelir
/// (sidebar'daki <c>permissionKey</c> ile birebir). Kurum yöneticisi personel oluştururken bu listeden seçer.
/// </summary>
public static class Permissions
{
    public const string Customers = "Customers";
    public const string Appointments = "Appointments";
    public const string Services = "Services";
    public const string Stock = "Stock";
    public const string CashRegister = "CashRegister";
    public const string Accounting = "Accounting";
    public const string Reports = "Reports";
    public const string Notifications = "Notifications";
    public const string Logs = "Logs";
    public const string Settings = "Settings";

    /// <summary>
    /// UI label + açıklamasıyla tüm izinler — Frontend bunu kullanarak checkbox grid yapar.
    /// Sıra panel menüsünü takip eder. Yalnızca gerçek bir sayfayı açan key'ler burada bulunur.
    /// </summary>
    public static readonly IReadOnlyList<(string Key, string Label, string Description)> All = new[]
    {
        (Customers, "Müşteriler", "Müşteri ekleme, görüntüleme, düzenleme ve geçmişi"),
        (Appointments, "Randevular", "Randevu açma, düzenleme, durum yönetimi ve takvim"),
        (Services, "Paket, Hizmet & Seans", "Hizmet/paket kataloğu, paket satışı ve seans takibi"),
        (Stock, "Stok & Ürün", "Ürün listesi ve stok giriş/çıkış hareketleri"),
        (CashRegister, "Günlük Kasa", "Tahsilat alma, gün sonu ve gider girişi"),
        (Accounting, "Ön Muhasebe", "Adisyon, cari hesap, taksit, tahsilat ve giderler"),
        (Reports, "Raporlar", "Finans, müşteri ve personel performans raporları"),
        (Notifications, "Bildirimler", "SMS / WhatsApp / e-posta şablonları ve gönderimi"),
        (Logs, "Loglar", "Sistem ve denetim (audit) günlükleri"),
        (Settings, "Ayarlar", "Şube ve genel ayarlar — yönetici alanı (personele genelde verilmez)"),
    };
}

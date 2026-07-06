namespace GuzellikMerkezi.Domain;

/// <summary>
/// Personel için iki seviyeli izinler:
/// - SAYFA izni (ör. "Accounting") → sayfayı görme + okuma erişimi (sidebar <c>permissionKey</c> ile birebir).
/// - İŞLEM izni (ör. "Accounting.Accounts") → sayfa içindeki belirli yazma aksiyonu.
/// Kurum yöneticisi personel formunda sayfayı işaretleyip altındaki işlemleri tek tek açar/kapar
/// ("ön muhasebeyi görsün ama cari oluşturmasın" gibi).
///
/// GERİYE UYUMLULUK: Eski personel kayıtlarında yalnız sayfa anahtarları vardır. Bir personelin
/// sayfa izni VARKEN o sayfaya ait hiçbir işlem anahtarı yoksa "eski format" sayılır ve işlemler
/// tam yetkili kabul edilir (bkz. <see cref="IsActionAllowed"/>). Yönetici formu bir kez kaydedince
/// yeni ayrıntılı format devreye girer.
/// </summary>
public static class Permissions
{
    public const string Customers = "Customers";
    public const string Appointments = "Appointments";
    public const string Waitlist = "Waitlist";
    public const string Services = "Services";
    public const string GiftCards = "GiftCards";
    public const string Stock = "Stock";
    public const string CashRegister = "CashRegister";
    public const string CashClosing = "CashClosing";
    public const string Accounting = "Accounting";
    public const string Reports = "Reports";
    public const string Notifications = "Notifications";
    public const string Logs = "Logs";
    public const string Settings = "Settings";

    // ---- İşlem (aksiyon) izinleri — "Sayfa.Aksiyon" biçiminde ----
    public const string CustomersManage = "Customers.Manage";
    public const string CustomersDelete = "Customers.Delete";
    public const string CustomersTags = "Customers.Tags";
    public const string AppointmentsCreate = "Appointments.Create";
    public const string AppointmentsStatus = "Appointments.Status";
    public const string WaitlistManage = "Waitlist.Manage";
    public const string ServicesManage = "Services.Manage";
    public const string GiftCardsManage = "GiftCards.Manage";
    public const string StockManage = "Stock.Manage";
    public const string StockMovements = "Stock.Movements";
    public const string CashRegisterEntry = "CashRegister.Entry";
    public const string CashClosingClose = "CashClosing.Close";
    public const string AccountingAdisyon = "Accounting.Adisyon";
    public const string AccountingAccounts = "Accounting.Accounts";
    public const string AccountingCollect = "Accounting.Collect";
    public const string AccountingExpenses = "Accounting.Expenses";
    public const string NotificationsSend = "Notifications.Send";
    public const string NotificationsTemplates = "Notifications.Templates";

    /// <summary>
    /// UI label + açıklama + işlem listesiyle tüm izinler — Frontend bunu kullanarak
    /// sayfa checkbox'ı + altında işlem seçimleri grid'i yapar. Sıra panel menüsünü takip eder.
    /// </summary>
    public static readonly IReadOnlyList<PermissionPage> All = new PermissionPage[]
    {
        new(Customers, "Müşteriler", "Müşteri kartı, bilgi-onay formu ve tedavi günlüğünü görme", new PermissionAction[]
        {
            new(CustomersManage, "Müşteri ekleme / düzenleme"),
            new(CustomersDelete, "Müşteri silme"),
            new(CustomersTags, "VIP & kara liste etiketi"),
        }),
        new(Appointments, "Randevular", "Takvim, çizelge görünümü ve randevuları görme", new PermissionAction[]
        {
            new(AppointmentsCreate, "Randevu oluşturma / düzenleme"),
            new(AppointmentsStatus, "Durum güncelleme (Tamamlandı / İptal / Gelmedi)"),
        }),
        new(Waitlist, "Bekleme Listesi", "Dolu güne talep listesini görme", new PermissionAction[]
        {
            new(WaitlistManage, "Talep ekleme / kapatma / slot teklifi"),
        }),
        new(Services, "Paket, Hizmet & Seans", "Hizmet/paket kataloğu, kampanyalar ve seans takibini görme", new PermissionAction[]
        {
            new(ServicesManage, "Hizmet / paket / kampanya tanımlama"),
        }),
        new(GiftCards, "Hediye Çeki & Kupon", "Hediye çeki ve kuponları görme", new PermissionAction[]
        {
            new(GiftCardsManage, "Çek / kupon tanımlama ve iptal"),
        }),
        new(Stock, "Stok & Ürün", "Ürün listesi ve kritik stok uyarılarını görme", new PermissionAction[]
        {
            new(StockManage, "Ürün tanımlama / düzenleme"),
            new(StockMovements, "Stok giriş / çıkış hareketi"),
        }),
        new(CashRegister, "Günlük Kasa", "Kasa ve gelir-gider akışını görme", new PermissionAction[]
        {
            new(CashRegisterEntry, "Gelir / gider girişi"),
        }),
        new(CashClosing, "Kasa Kapanışı", "Gün sonu Z raporlarını görme", new PermissionAction[]
        {
            new(CashClosingClose, "Kapanış kaydı oluşturma (sayım + mutabakat)"),
        }),
        new(Accounting, "Ön Muhasebe", "Adisyon, cari hesap, taksit ve giderleri görme", new PermissionAction[]
        {
            new(AccountingAdisyon, "Adisyon açma / kalem ekleme"),
            new(AccountingAccounts, "Cari hesap oluşturma / düzenleme"),
            new(AccountingCollect, "Tahsilat kaydı alma"),
            new(AccountingExpenses, "Gider girişi"),
        }),
        new(Reports, "Raporlar", "Finans, müşteri, personel ve hizmet raporlarını görme (PDF/Excel)", Array.Empty<PermissionAction>()),
        new(Notifications, "Bildirimler", "Mesaj şablonları ve gönderim geçmişini görme", new PermissionAction[]
        {
            new(NotificationsSend, "SMS / WhatsApp / e-posta gönderimi"),
            new(NotificationsTemplates, "Şablon oluşturma / düzenleme"),
        }),
        new(Logs, "Loglar", "Sistem ve denetim (audit) günlükleri", Array.Empty<PermissionAction>()),
        new(Settings, "Ayarlar", "Şube ve genel ayarlar — yönetici alanı (personele genelde verilmez)", Array.Empty<PermissionAction>()),
    };

    /// <summary>
    /// Personelin verilen İŞLEM iznine sahip olup olmadığı (geriye uyumlu).
    /// Kural: işlem anahtarı doğrudan verilmişse izinli. Verilmemişse: sayfa izni VAR ve o sayfaya ait
    /// HİÇBİR işlem anahtarı atanmamışsa (eski format) izinli sayılır; en az bir işlem anahtarı atanmış
    /// ama istenen atanmamışsa REDDEDİLİR (yönetici bilinçli olarak kısıtlamıştır).
    /// </summary>
    public static bool IsActionAllowed(IReadOnlyCollection<string> granted, string actionKey)
    {
        if (string.IsNullOrEmpty(actionKey)) return true;
        if (granted.Any(p => string.Equals(p, actionKey, StringComparison.OrdinalIgnoreCase))) return true;

        var dot = actionKey.IndexOf('.');
        if (dot <= 0) return false;
        var pageKey = actionKey[..dot];
        var hasPage = granted.Any(p => string.Equals(p, pageKey, StringComparison.OrdinalIgnoreCase));
        if (!hasPage) return false;
        // Eski format: sayfa izni var ama sayfanın hiçbir işlem anahtarı atanmamış → tam yetkili say.
        var pagePrefix = pageKey + ".";
        return !granted.Any(p => p.StartsWith(pagePrefix, StringComparison.OrdinalIgnoreCase));
    }
}

public sealed record PermissionAction(string Key, string Label);
public sealed record PermissionPage(string Key, string Label, string Description, IReadOnlyList<PermissionAction> Actions);

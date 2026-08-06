using GuzellikMerkezi.Domain.Enums;

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
    /// <summary>
    /// Yanlış tamamlanan randevunun TAMAMLAMASINI geri alma. Durum güncellemeden AYRI yetki:
    /// tüketilmiş seansı geri verir ve verilmiş sayılan hizmeti geri çeker — düzeltme yetkisidir.
    /// </summary>
    public const string AppointmentsVoidCompletion = "Appointments.VoidCompletion";
    public const string WaitlistManage = "Waitlist.Manage";
    /// <summary>Bekleme kaydını randevuya çevirme — gerçek randevu açar, ayrı yetki.</summary>
    public const string WaitlistConvert = "Waitlist.Convert";
    public const string ServicesManage = "Services.Manage";
    /// <summary>Hizmet / paket / kategori / kampanya SİLME (toplu silme dahil).</summary>
    public const string ServicesDelete = "Services.Delete";
    public const string GiftCardsManage = "GiftCards.Manage";
    public const string StockManage = "Stock.Manage";
    /// <summary>Ürün SİLME (toplu silme dahil).</summary>
    public const string StockDelete = "Stock.Delete";
    public const string StockMovements = "Stock.Movements";
    public const string CashRegisterEntry = "CashRegister.Entry";
    public const string CashClosingClose = "CashClosing.Close";
    public const string AccountingAdisyon = "Accounting.Adisyon";
    public const string AccountingAccounts = "Accounting.Accounts";
    public const string AccountingCollect = "Accounting.Collect";
    public const string AccountingExpenses = "Accounting.Expenses";
    /// <summary>
    /// GERÇEKLEŞMİŞ bir para iadesini geçersiz kılma (iptali geri alırken kasa çıkışını silme).
    /// Ayrı izin: normal cari/tahsilat yetkisiyle geçmiş bir kasa hareketi yok edilememeli.
    /// </summary>
    public const string AccountingVoidRefund = "Accounting.VoidRefund";

    /// <summary>
    /// ONAYLANMIŞ bir gideri geçersiz kılma (void). Normal gider yetkisiyle geçmiş bir kasa
    /// çıkışının muhasebe toplamlarından düşürülmesi engellenir — iade geçersiz kılmayla aynı sınıf.
    /// </summary>
    public const string AccountingVoidExpense = "Accounting.VoidExpense";
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
            new(AppointmentsVoidCompletion, "Yanlış tamamlamayı geri alma (seansı iade eder)"),
        }),
        new(Waitlist, "Bekleme Listesi", "Dolu güne talep listesini görme", new PermissionAction[]
        {
            new(WaitlistManage, "Talep ekleme / kapatma / slot teklifi"),
            new(WaitlistConvert, "Bekleme kaydını randevuya aktarma"),
        }),
        new(Services, "Paket, Hizmet & Seans", "Hizmet/paket kataloğu, kampanyalar ve seans takibini görme", new PermissionAction[]
        {
            new(ServicesManage, "Hizmet / paket / kampanya tanımlama"),
            new(ServicesDelete, "Hizmet / paket silme (toplu silme dahil)"),
        }),
        new(GiftCards, "Hediye Çeki & Kupon", "Hediye çeki ve kuponları görme", new PermissionAction[]
        {
            new(GiftCardsManage, "Çek / kupon tanımlama ve iptal"),
        }),
        new(Stock, "Stok & Ürün", "Ürün listesi ve kritik stok uyarılarını görme", new PermissionAction[]
        {
            new(StockManage, "Ürün tanımlama / düzenleme"),
            new(StockDelete, "Ürün silme (toplu silme dahil)"),
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
            new(AccountingVoidRefund, "Yapılmış para iadesini geçersiz kılma"),
            new(AccountingVoidExpense, "Onaylanmış gideri geçersiz kılma"),
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

    /// <summary>
    /// TEK YETKİLENDİRME KARAR NOKTASI — "bu rol + bu izin listesi, şu izne sahip mi?"
    ///
    /// <para>
    /// Kural iki yerde ayrı ayrı yazılıydı: uçlarda <c>PermissionEndpointFilter</c> ("Staff değilse
    /// serbest"), servislerde ise elle yazılmış <c>Role == Staff &amp;&amp; !IsActionAllowed(...)</c>
    /// koşulları. Rol literalinin çağrı yerlerine dağılması iki sorun üretiyordu: (1) payload'a bağlı
    /// (ör. "istek satış içeriyorsa adisyon izni de iste") kontroller yalnız Staff yolunda uygulanıyor,
    /// başka roller sessizce atlıyordu; (2) rol modeli değişirse her çağrı yerinin ayrı düzeltilmesi
    /// gerekiyordu. ASP.NET Core'un yetkilendirme rehberi de kararı tek bir requirement/handler'da
    /// toplamayı önerir; çağrı yerleri yalnız "hangi izin" der, "hangi rol" demez.
    /// </para>
    /// <para>
    /// ROL MODELİ (burada, bir kez): platform yöneticisi ve kurum yönetici rolleri tam erişimlidir;
    /// yalnız PERSONEL sayfa/işlem iznine tabidir. Yönetici rollerin JWT'sinde "permission" claim'i
    /// bulunmaz (bkz. <c>ICurrentUser.Permissions</c>), bu yüzden onları izin listesine bakarak
    /// değerlendirmek herkesi kilitlerdi.
    /// </para>
    /// </summary>
    public static bool IsGrantedTo(UserRole? role, bool isPlatformAdmin, IReadOnlyCollection<string> granted, string permissionKey)
    {
        if (string.IsNullOrEmpty(permissionKey)) return true;
        if (isPlatformAdmin) return true;
        if (role is null) return false;
        // KURUM SAHİBİ / ŞUBE YÖNETİCİSİ: TAM ERİŞİM — BU BİLİNÇLİ BİR TASARIM KARARIDIR.
        //
        // Denetimlerde "BranchManager granular izni atlıyor" diye iki kez işaretlendi; kayda
        // geçiyoruz: ince yetki listesi bu üründe YALNIZ personel (Staff) için vardır. İzin listesi
        // (TenantUser.Permissions) yalnızca Staff hesabı açılırken/güncellenirken atanır
        // (bkz. StaffService.SetPermissions çağrıları); yönetici rollerine hiç liste yazılmaz.
        // Dolayısıyla burada "atlanan" bir kısıt yoktur — kısıt hiç tanımlanmamıştır.
        //
        // Bileşik kuralların (ör. "satışlı randevu ayrıca Accounting.Adisyon ister") amacı
        // BİLEŞİMLE YETKİ YÜKSELTMEYİ engellemektir; yönetici rolünde yükseltilecek bir şey yoktur,
        // muhasebe erişimi zaten rolün parçasıdır. Yöneticiyi burada kısıtlamak, sahip olması
        // gereken işlevleri kapatmak olurdu.
        //
        // Yönetici rollerini gerçekten kısıtlamak istenirse doğru yol bu satırı değiştirmek değil,
        // o roller için de bir izin listesi TANIMLAMAK ve atamaktır (ürün kararı).
        if (role != UserRole.Staff) return true;

        return permissionKey.Contains('.')
            ? IsActionAllowed(granted, permissionKey)
            : granted.Any(p => string.Equals(p, permissionKey, StringComparison.OrdinalIgnoreCase));
    }
}

public sealed record PermissionAction(string Key, string Label);
public sealed record PermissionPage(string Key, string Label, string Description, IReadOnlyList<PermissionAction> Actions);

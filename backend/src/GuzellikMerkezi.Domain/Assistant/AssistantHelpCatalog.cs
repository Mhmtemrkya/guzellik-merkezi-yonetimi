using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Assistant;

/// <summary>
/// Maydi'nin "nasıl yapılır / nerede" cevapları için elle yazılmış yardım makalesi.
/// <list type="bullet">
/// <item><b>Routes</b>: portal → o portaldaki gerçek web sayfası. Makale yalnız Routes'ta bulunan portala gösterilir;
/// böylece hiçbir rol açamayacağı bir sayfaya yönlendirilmez. Mobil istemci aynı rotayı kendi ekranına çevirir.</item>
/// <item><b>FeatureKeys</b>: kurumun paketinde bunlardan EN AZ BİRİ yoksa makale gösterilmez (boş = her pakette).
/// Web menüsündeki <c>featureKeys</c> kapısıyla aynı anahtarlar.</item>
/// <item><b>StaffPermission</b>: personel portalında sayfanın izin anahtarı (web menüsündeki <c>permissionKey</c>).
/// Kurum sahibi ve şube yöneticisi tam yetkilidir (bkz. <see cref="Permissions.IsGrantedTo"/>).</item>
/// <item><b>PurchaseSurface</b>: satın alma/abonelik ekranı. App Store ve Mac App Store sürümlerinde (3.1.1) gösterilmez.</item>
/// <item><b>Keywords</b>: aksansız, küçük harf anahtar ifadeler (eşleşme puanı için).</item>
/// </list>
/// </summary>
public sealed record AssistantHelpArticle(
    string Id,
    string TitleTr,
    string TitleEn,
    IReadOnlyList<string> Keywords,
    IReadOnlyList<string> StepsTr,
    IReadOnlyList<string> StepsEn,
    IReadOnlyDictionary<string, string> Routes)
{
    public IReadOnlyList<string> FeatureKeys { get; init; } = [];
    public string? StaffPermission { get; init; }
    public bool PurchaseSurface { get; init; }
}

/// <summary>
/// Maydi'nin portalları. Rol → portal eşlemesi tek yerde durur.
/// </summary>
public static class AssistantPortals
{
    public const string Owner = "owner";
    public const string Branch = "branch";
    public const string Staff = "staff";
    public const string Customer = "customer";

    public static readonly IReadOnlyList<string> All = [Owner, Branch, Staff, Customer];

    /// <summary>Platform yöneticisinin Maydi portalı yoktur (kurum verisine bakmaz).</summary>
    public static string? Of(UserRole? role) => role switch
    {
        UserRole.InstitutionOwner => Owner,
        UserRole.BranchManager => Branch,
        UserRole.Staff => Staff,
        UserRole.Customer => Customer,
        _ => null,
    };
}

/// <summary>
/// BeautyAsist yardım kataloğu. Yapay zekâ cevap UYDURMAZ: soru bu listedeki bir makaleyle eşleşir ya da
/// Maydi bilmediğini söyler. Adımlar her zaman buradan gelir; yapay zekâ yalnız makaleyi seçer.
/// Yeni ekran eklenince buraya makale eklenmeli; rotaların gerçekten var olduğunu ve portalın menüsünde
/// bulunduğunu <c>AssistantHelpCatalogTests</c> web kaynağına karşı doğrular.
/// </summary>
public static class AssistantHelpCatalog
{
    private const string O = AssistantPortals.Owner, B = AssistantPortals.Branch, S = AssistantPortals.Staff, C = AssistantPortals.Customer;

    private static Dictionary<string, string> R(params (string Portal, string Route)[] routes) =>
        routes.ToDictionary(item => item.Portal, item => item.Route);

    /// <summary>Kurum sahibi + şube yöneticisi /panel'de, personel /ekip'te aynı sayfaya gider.</summary>
    private static Dictionary<string, string> Managers(string panelRoute, string? staffRoute = null)
    {
        var routes = new Dictionary<string, string> { [O] = panelRoute, [B] = panelRoute };
        if (staffRoute is not null) routes[S] = staffRoute;
        return routes;
    }

    private const string DraftNoteTr = "Personel hesabıyla yaptığınız değişiklik onay bekleyen taslak olarak yöneticinize düşer; onaylanınca uygulanır.";
    private const string DraftNoteEn = "Changes made from a staff account go to your manager as a pending draft and apply once approved.";

    public static readonly IReadOnlyList<AssistantHelpArticle> Articles =
    [
        // ── Randevu ─────────────────────────────────────────────────────────
        new("appointment-create", "Randevu oluşturma", "Creating an appointment",
            ["randevu olustur", "randevu ver", "yeni randevu", "randevu ekle", "randevu al", "randevu acmak", "musteriye randevu", "new appointment", "book appointment", "create appointment", "yer ayir", "gun ayarla", "saat ver", "takvime yaz", "takvime ekle"],
            ["Randevular sayfasını açın.", "Takvimde boş saate tıklayın ya da Yeni randevu'ya basın.", "Müşteriyi, hizmeti, personeli ve saati seçip kaydedin; müşteriye hatırlatma otomatik gider.", DraftNoteTr],
            ["Open the Appointments page.", "Click a free slot on the calendar or press New appointment.", "Choose customer, service, staff and time, then save; the customer gets a reminder automatically.", DraftNoteEn],
            Managers("/panel/randevular", "/ekip/randevular")) { StaffPermission = Permissions.Appointments },
        new("appointment-approve", "Taslak randevuyu onaylama", "Approving a draft appointment",
            ["taslak randevu", "onay bekleyen randevu", "randevu onayla", "randevuyu onayla", "approve appointment", "draft appointment", "randevulari kabul", "girdigi randevu", "randevu kabul"],
            ["Onay Bekleyenler sayfasını açın.", "Taslağı inceleyin; ne değiştiği yan yana görünür.", "Onayla ya da Reddet'e basın; onaylanan randevu otomatik oluşur."],
            ["Open Pending Approvals.", "Review the draft; the changes are shown side by side.", "Press Approve or Reject; an approved appointment is created automatically."],
            R((O, "/panel/onaylar"), (B, "/panel/onaylar"))) { FeatureKeys = [FeatureCatalog.ApprovalWorkflow] },
        new("appointment-complete", "Randevuyu tamamlama ve seans düşme", "Completing an appointment and using a session",
            ["randevu tamamla", "randevuyu tamamla", "seans dus", "seans duser", "islem bitti", "tamamlandi isaretle", "complete appointment", "mark as done"],
            ["Randevular'da randevuyu açın.", "Durumu Tamamlandı olarak işaretleyin.", "Müşterinin paketi varsa seans otomatik düşer; kalan seans müşteri kartında görünür."],
            ["Open the appointment on the Appointments page.", "Set its status to Completed.", "If the customer has a package, a session is deducted automatically; the remainder shows on the customer card."],
            Managers("/panel/randevular", "/ekip/randevular")) { StaffPermission = Permissions.Appointments },
        new("appointment-cancel", "Randevu iptali ve gelmedi", "Cancelling and no-shows",
            ["randevu iptal", "randevuyu iptal", "gelmedi", "gelmedi isaretle", "randevu sil", "no show", "cancel appointment", "ugramadi", "gelemeyecek", "randevuya gelmedi"],
            ["Randevular'da randevuyu açın.", "İptal ya da Gelmedi olarak işaretleyin.", "Boşalan saat bekleme listesindeki uygun müşteriye teklif edilir."],
            ["Open the appointment on the Appointments page.", "Mark it as Cancelled or No-show.", "The freed slot is offered to a matching customer on the waitlist."],
            Managers("/panel/randevular", "/ekip/randevular")) { StaffPermission = Permissions.Appointments },
        new("calendar-views", "Takvim görünümleri", "Calendar views",
            ["takvim", "gunluk gorunum", "haftalik gorunum", "aylik gorunum", "bugunku randevular", "bekleyen randevular", "calendar", "weekly view"],
            ["Randevular sayfasını açın.", "Üstten gün, hafta ya da ay görünümünü seçin.", "Menüdeki Bugün, Bu hafta, Bu ay ve Bekleyenler filtreleriyle listeyi daraltın."],
            ["Open the Appointments page.", "Pick day, week or month view at the top.", "Use the Today, This week, This month and Pending filters in the menu."],
            Managers("/panel/randevular", "/ekip/randevular")) { StaffPermission = Permissions.Appointments },
        new("waitlist", "Bekleme listesi", "Waitlist",
            ["bekleme listesi", "bekleme listesine", "sira", "dolu saat", "yer acilinca", "yer acilirsa", "waitlist", "waiting list"],
            ["Bekleme Listesi sayfasını açın.", "Dolu gün ya da saat için müşteriyi listeye ekleyin.", "Yer açıldığında müşteriye WhatsApp'tan otomatik teklif gider; kabul ederse randevuya çevrilir."],
            ["Open the Waitlist page.", "Add the customer for a fully booked day or time.", "When a slot opens, the customer gets an automatic WhatsApp offer; if accepted it becomes an appointment."],
            Managers("/panel/bekleme-listesi", "/ekip/bekleme-listesi"))
            { FeatureKeys = [FeatureCatalog.AppointmentsWaitlist], StaffPermission = Permissions.Waitlist },

        // ── Müşteri ─────────────────────────────────────────────────────────
        new("customer-add", "Müşteri ekleme", "Adding a customer",
            ["musteri ekle", "yeni musteri", "musteri kaydi", "musteri kaydet", "danisan kaydi", "danisan ekle", "add customer", "new customer", "bilgilerini gir", "ilk kez gelen", "kisi ekle"],
            ["Müşteriler sayfasında Yeni müşteri'ye basın.", "Ad, telefon ve KVKK onayını girin.", "Kaydedin; müşteri listede ve randevu ekranında hemen görünür.", DraftNoteTr],
            ["Press New customer on the Customers page.", "Enter name, phone and the privacy (KVKK) consent.", "Save; the customer appears in the list and booking screen right away.", DraftNoteEn],
            Managers("/panel/musteriler", "/ekip/musteriler")) { StaffPermission = Permissions.Customers },
        new("customer-card", "Müşteri kartı", "Customer card",
            ["musteri detay", "musteri karti", "musteri gecmisi", "musterinin gecmisi", "musteri bilgileri", "customer details", "customer history"],
            ["Müşteriler sayfasında müşterinin adına tıklayın.", "Kart beş sekmedir: Genel Bakış, Randevu & Seans, Adisyon & İşlemler, Sağlık & Günlük ve Notlar.", "Adisyon & İşlemler sekmesi yalnız ön muhasebe yetkisi olanlara görünür."],
            ["Click the customer's name on the Customers page.", "The card has five tabs: Overview, Appointments & Sessions, Bills & Transactions, Health & Journal and Notes.", "The Bills & Transactions tab is visible only to users with accounting access."],
            Managers("/panel/musteriler", "/ekip/musteriler")) { StaffPermission = Permissions.Customers },
        new("consultation", "Bilgi (konsültasyon) formu ve uygunluk uyarısı", "Consultation form and suitability warnings",
            ["konsultasyon", "konsultasyon formu", "bilgi formu", "kontrendikasyon", "saglik formu", "anamnez", "alerji", "consultation form", "contraindication", "saglik beyani", "saglik bilgisi", "beyan formu"],
            ["Müşteri kartını açıp Sağlık & Günlük sekmesine geçin.", "Bilgi formunu doldurun ya da güncelleyin.", "Riskli yanıtlarda karttaki uyarı bandı hangi işlemin uygun olmadığını gösterir."],
            ["Open the customer card and go to the Health & Journal tab.", "Fill in or update the consultation form.", "For risky answers, the warning banner shows which treatments are not suitable."],
            Managers("/panel/musteriler", "/ekip/musteriler"))
            { FeatureKeys = [FeatureCatalog.ClinicalConsultation], StaffPermission = Permissions.Customers },
        new("treatment-log", "Tedavi günlüğü ve önce/sonra fotoğrafı", "Treatment journal and before/after photos",
            ["tedavi gunlugu", "islem gunlugu", "once sonra", "oncesi sonrasi", "fotograf ekle", "seans notu", "before after", "treatment journal"],
            ["Müşteri kartını açıp Sağlık & Günlük sekmesine geçin.", "Tedavi günlüğüne seans notu ekleyin.", "Önce ve sonra fotoğraflarını yükleyin; tarih sırasıyla saklanır."],
            ["Open the customer card and go to the Health & Journal tab.", "Add a session note to the treatment journal.", "Upload before and after photos; they are kept in date order."],
            Managers("/panel/musteriler", "/ekip/musteriler"))
            { FeatureKeys = [FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalConsultation], StaffPermission = Permissions.Customers },
        new("customer-segments", "VIP, kara liste ve pasif müşteriler", "VIP, blacklist and inactive customers",
            ["vip", "vip musteri", "kara liste", "kara listeye", "segment", "pasif musteri", "gelmeyen musteriler", "blacklist", "inactive customers", "onemli musteri", "randevu kaciran", "musteriyi isaretle", "etiket"],
            ["Müşteriler sayfasındaki segment sekmelerini kullanın.", "Müşteri kartından VIP ya da kara liste işaretini açın.", "Kara listedeki müşteriler toplu mesajlarda otomatik atlanır."],
            ["Use the segment tabs on the Customers page.", "Turn on the VIP or blacklist mark from the customer card.", "Blacklisted customers are skipped automatically in bulk messages."],
            R((O, "/panel/musteriler"), (B, "/panel/musteriler"))),
        new("customer-import", "Excel ile müşteri aktarma", "Importing customers from Excel",
            ["excel", "excel ile", "ice aktar", "toplu musteri", "musteri aktar", "excelden", "import customers", "import excel"],
            ["Müşteriler sayfasında Excel aktarımını açın.", "Şablonu indirip müşterileri doldurun.", "Dosyayı yükleyin; önizlemeyi kontrol edip aktarın."],
            ["Open Excel transfer on the Customers page.", "Download the template and fill in your customers.", "Upload the file, check the preview and import."],
            R((O, "/panel/musteriler"), (B, "/panel/musteriler"))) { FeatureKeys = [FeatureCatalog.ExcelCustomers] },
        new("kvkk-consent", "KVKK ve dijital onam (imza tableti)", "Privacy consent and digital signature tablet",
            ["kvkk", "onam", "onam formu", "imza", "imzalat", "tablet", "imza tableti", "aydinlatma metni", "consent form", "signature"],
            ["İmza Tableti sayfasını açın.", "Müşteriyi ve imzalanacak formu seçin.", "Tableti müşteriye verin; imza tamamlanınca onay müşteri kartına işlenir."],
            ["Open the Signature Tablet page.", "Choose the customer and the form to sign.", "Hand the tablet to the customer; once signed, the consent is saved to the customer card."],
            R((O, "/imza"), (B, "/imza"), (S, "/imza"))) { StaffPermission = Permissions.Services },

        // ── Hizmet & paket ──────────────────────────────────────────────────
        new("service-define", "Hizmet tanımlama", "Defining a service",
            ["hizmet ekle", "yeni hizmet", "hizmet tanimla", "hizmet fiyati", "fiyat degistir", "hizmet havuzu", "kategori ekle", "add service", "service price", "hizmet suresi", "hizmet sure", "hizmeti duzenle", "hizmet degistir"],
            ["Paket & Hizmet sayfasında Hizmet havuzu'nu açın.", "Yeni hizmet'e basın; süre, fiyat ve kategoriyi girin.", "Kaydedin; hizmet randevu ve satış ekranlarında seçilebilir.", DraftNoteTr],
            ["Open Service pool on the Packages & Services page.", "Press New service; enter duration, price and category.", "Save; the service can now be chosen when booking or selling.", DraftNoteEn],
            Managers("/panel/paketler", "/ekip/paketler")) { StaffPermission = Permissions.Services },
        new("package-create", "Seanslı paket oluşturma", "Creating a session package",
            ["paket olustur", "yeni paket", "seans paketi", "paket fiyati", "paket tanimla", "create package", "session package"],
            ["Paket & Hizmet sayfasında Paketler'i açın.", "Pakete hizmetleri ve seans sayılarını ekleyin.", "Fiyatı ve (varsa) sadakat puanını girip kaydedin."],
            ["Open Packages on the Packages & Services page.", "Add services and their session counts to the package.", "Enter the price and loyalty points (if used), then save."],
            R((O, "/panel/paketler"), (B, "/panel/paketler"))),
        new("package-sell", "Paket satışı ve taksit", "Selling a package and installments",
            ["paket sat", "paket satisi", "satis yap", "taksit", "taksitlendir", "taksitli satis", "sell package", "installment"],
            ["Müşteri kartını açıp Satış'a basın.", "Paketi seçin.", "Peşin ya da taksit planıyla kaydedin; seans hakları müşteriye tanımlanır."],
            ["Open the customer card and press Sale.", "Choose the package.", "Save with full payment or an installment plan; the sessions are assigned to the customer."],
            Managers("/panel/musteriler", "/ekip/musteriler")) { StaffPermission = Permissions.Customers },
        new("sessions-mine", "Seanslarım", "My sessions",
            ["seanslarim", "kalan seans", "kalan seanslar", "paketli musterilerim", "seans takibi", "my sessions", "remaining sessions"],
            ["Seanslarım sayfasını açın.", "Paketli müşterilerinizin kalan seanslarını ve tahsilat durumunu görün.", "Seansı buradan randevuya çevirebilirsiniz."],
            ["Open My Sessions.", "See your package customers' remaining sessions and payment status.", "You can turn a session into an appointment from here."],
            R((S, "/ekip/seanslar"))) { StaffPermission = Permissions.Services },
        new("loyalty", "Sadakat puanı", "Loyalty points",
            ["sadakat", "sadakat puani", "puan kazan", "puanla", "puan kullan", "loyalty", "loyalty points", "puan biriktir", "puan topla", "puan kazansin"],
            ["Paket & Hizmet'te hizmet ya da pakete puan değerini girin.", "Müşteri satın aldıkça puan kazanır.", "Adisyonda puanla ödeme seçilerek puan harcanır."],
            ["Set point values on services or packages in Packages & Services.", "Customers earn points as they buy.", "Points are spent by choosing pay-with-points on the bill."],
            R((O, "/panel/paketler"), (B, "/panel/paketler"))) { FeatureKeys = [FeatureCatalog.LoyaltyPoints] },
        new("campaign", "İndirim kampanyası", "Discount campaign",
            ["kampanya", "kampanya olustur", "indirim kampanyasi", "indirim tanimla", "kampanyali fiyat", "discount campaign", "create campaign", "indirim yap", "indirimli", "yuzde indirim"],
            ["Paket & Hizmet sayfasını açın.", "Kampanya bölümünden yeni kampanya oluşturun.", "İndirim oranını, kapsayan hizmet/paketleri ve tarih aralığını girip kaydedin."],
            ["Open the Packages & Services page.", "Create a new campaign in the Campaigns section.", "Enter the discount, the services/packages it covers and the date range, then save."],
            R((O, "/panel/paketler"), (B, "/panel/paketler"))) { FeatureKeys = [FeatureCatalog.MarketingCampaigns] },
        new("gift-card", "Hediye çeki ve kupon", "Gift cards and coupons",
            ["hediye ceki", "hediye kart", "kupon", "indirim kodu", "kupon olustur", "gift card", "coupon", "hediye et", "kart kodu", "bakiyeli cek", "hediye kodu"],
            ["Hediye Çeki sayfasını açın.", "Kod oluşturun; tutarı ya da yüzdeyi ve geçerlilik tarihini belirleyin.", "Kod adisyonda kullanılır; kalan bakiye otomatik izlenir."],
            ["Open the Gift Cards page.", "Create a code; set the amount or percentage and expiry.", "The code is used on the bill; the remaining balance is tracked automatically."],
            Managers("/panel/hediye-cek", "/ekip/hediye-cek"))
            { FeatureKeys = [FeatureCatalog.MarketingGiftCards], StaffPermission = Permissions.GiftCards },

        // ── Stok ────────────────────────────────────────────────────────────
        new("stock", "Stok ve ürün", "Stock and products",
            ["stok", "urun ekle", "yeni urun", "kritik stok", "sarf malzeme", "stok cikisi", "stok girisi", "stock", "inventory", "depo", "depodan", "azaldiginda", "malzeme dus", "urun dus"],
            ["Stok & Ürün sayfasını açın.", "Ürünü ekleyin; satış ürünü mü sarf malzeme mi olduğunu seçin.", "Giriş ve çıkış hareketlerini girin; kritik seviyenin altına inen ürün uyarı verir."],
            ["Open the Stock & Products page.", "Add the product; choose whether it is for sale or a consumable.", "Enter stock in/out movements; products below the critical level raise a warning."],
            Managers("/panel/stok", "/ekip/stok"))
            { FeatureKeys = [FeatureCatalog.StockProducts, FeatureCatalog.StockMovements], StaffPermission = Permissions.Stock },

        // ── Finans ──────────────────────────────────────────────────────────
        new("cash-collect", "Tahsilat alma", "Taking a payment",
            ["tahsilat", "tahsilat al", "odeme al", "kasa", "nakit", "kartla odeme", "para al", "take payment", "collect payment", "kredi karti", "kartla odedi", "nakit odedi", "odeme girdi", "odemeyi gir"],
            ["Günlük Kasa sayfasını açın.", "Yeni tahsilat'a basın.", "Müşteriyi, tutarı ve ödeme yöntemini seçip kaydedin."],
            ["Open the Daily Cash page.", "Press New collection.", "Choose the customer, amount and payment method, then save."],
            Managers("/panel/kasa", "/ekip/kasa")) { StaffPermission = Permissions.CashRegister },
        new("cash-closing", "Gün sonu kasa kapanışı", "End-of-day cash closing",
            ["kasa kapanisi", "kasa kapat", "gun sonu", "kasa sayimi", "z raporu", "kasa farki", "cash closing", "end of day"],
            ["Kasa Kapanışı sayfasını açın.", "Kasada saydığınız tutarı girin.", "Sistem beklenen nakitle farkı hesaplar ve kapanışı kayda alır."],
            ["Open the Cash Closing page.", "Enter the amount you counted.", "The system calculates the difference from expected cash and records the closing."],
            Managers("/panel/kasa-kapanis", "/ekip/kasa-kapanis"))
            { FeatureKeys = [FeatureCatalog.FinanceCashClosing], StaffPermission = Permissions.CashClosing },
        new("adisyon", "Adisyon", "Bill (adisyon)",
            ["adisyon", "adisyon ac", "hesap kes", "fis", "hesap kapat", "adisyon kapat", "bill", "receipt"],
            ["Ön Muhasebe sayfasında Adisyon'u açın.", "Hizmet ve ürünleri ekleyin; kupon ya da puan uygulayın.", "Ödemeyi alıp adisyonu kapatın; adisyon onay kapısından muaftır."],
            ["Open Bills in the Accounting page.", "Add services and products; apply a coupon or points.", "Take the payment and close the bill; bills skip the approval step."],
            Managers("/panel/on-muhasebe", "/ekip/on-muhasebe"))
            { FeatureKeys = [FeatureCatalog.BillingAdisyon], StaffPermission = Permissions.Accounting },
        new("accounts", "Cari hesap ve taksitler", "Customer accounts and installments",
            ["cari hesap", "cari", "borc", "borclu", "taksitler", "bekleyen taksit", "geciken odeme", "geciken taksit", "account balance", "overdue payment", "odemesini geciktir", "borcu olan", "odeme yapmayan"],
            ["Ön Muhasebe'de Cari hesap, Bekleyen taksitler ya da Geciken ödemeler'i açın.", "Müşterinin ekstresini ve taksit planını görün.", "Geciken taksit için hatırlatma gönderin ya da tahsilat girin."],
            ["Open Accounts, Upcoming installments or Overdue payments in Accounting.", "See the customer's statement and installment plan.", "Send a reminder for an overdue installment or record a payment."],
            R((O, "/panel/on-muhasebe"), (B, "/panel/on-muhasebe"))),
        new("expenses", "Gider ve personel maaşı", "Expenses and staff salaries",
            ["gider ekle", "gider", "masraf", "maas", "personel maasi", "kira", "fatura gideri", "add expense", "salary"],
            ["Ön Muhasebe'de Giderler ya da Personel maaşları'nı açın.", "Yeni kayıt ekleyin; kategori, tutar ve tarihi girin.", "Kaydedin; raporlardaki gelir-gider dengesine yansır."],
            ["Open Expenses or Staff salaries in Accounting.", "Add a new entry with category, amount and date.", "Save; it is reflected in the income/expense reports."],
            R((O, "/panel/on-muhasebe"), (B, "/panel/on-muhasebe"))),
        new("reports", "Raporlar", "Reports",
            ["rapor", "raporlar", "ciro", "analiz", "excel indir", "pdf indir", "doluluk", "personel performansi", "reports", "revenue report", "ne kadar kazandik", "kazandigimiz", "grafik", "performans raporu", "tercih edilen hizmet", "en cok tercih"],
            ["Raporlar sayfasını açın ve dönemi seçin.", "Finans, Müşteri, Personel ve Hizmet doluluk sekmeleri arasında geçin.", "Gerekirse raporu Excel ya da PDF olarak dışa aktarın."],
            ["Open Reports and choose the period.", "Switch between Finance, Customer, Staff and Service occupancy tabs.", "Export the report to Excel or PDF if needed."],
            Managers("/panel/raporlar", "/ekip/raporlar"))
            {
                FeatureKeys = [FeatureCatalog.ReportsFinance, FeatureCatalog.ReportsCustomer, FeatureCatalog.ReportsStaff, FeatureCatalog.ReportsServices, FeatureCatalog.ExcelReports, FeatureCatalog.PdfReports],
                StaffPermission = Permissions.Reports,
            },

        // ── Personel ────────────────────────────────────────────────────────
        new("staff-add", "Personel ekleme ve yetki", "Adding staff and permissions",
            ["personel ekle", "yeni personel", "calisan ekle", "yetki ver", "yetki", "rol", "giris bilgisi", "add staff", "permissions", "estetisyen", "hesap ac", "ise basla", "hangi sayfalari gorsun", "sayfa izni"],
            ["Personel & Roller sayfasında yeni personel ekleyin.", "Hangi sayfaları görüp hangi işlemleri yapabileceğini iki seviyede seçin.", "Kaydedince giriş bilgileri üretilir; personele iletin."],
            ["Add new staff on the Staff & Roles page.", "Choose which pages they can see and which actions they can take (two levels).", "Login details are generated on save; share them with the staff member."],
            R((O, "/panel/personel"), (B, "/panel/personel"))),
        new("staff-schedule", "Personel çizelgesi", "Staff schedule",
            ["cizelge", "personel cizelgesi", "doluluk", "kim calisiyor", "vardiya", "izin gunu", "staff schedule", "shift", "hangi gun calis", "kim calis", "calisma gunleri"],
            ["Personel & Roller altında Çizelge'yi açın.", "Gün, hafta ya da ay görünümünü seçin.", "Kimin hangi saatte hangi müşteriyle çalıştığını ve izin günlerini görün."],
            ["Open Schedule under Staff & Roles.", "Pick a day, week or month view.", "See who works with which customer at what time, and days off."],
            R((O, "/panel/personel/cizelge"), (B, "/panel/personel/cizelge"))) { FeatureKeys = [FeatureCatalog.StaffSchedule] },
        new("staff-rating", "Yıldız puanı (QR ile müşteri değerlendirmesi)", "Star rating (customer review by QR)",
            ["yildiz puani", "yildiz", "musteri puani", "musteri oyu", "qr", "qr kod", "degerlendirme", "puanim", "rating", "review"],
            ["İşlem sonrası müşteriye QR kodu gösterin.", "Müşteri telefonundan personele 1–5 yıldız verir.", "Puanlar yönetici için Personel ekranında, personel için kendi panelinde görünür."],
            ["Show the customer the QR code after the treatment.", "The customer rates the staff member 1–5 stars from their phone.", "Ratings appear on the Staff page for managers and on the staff member's own dashboard."],
            R((O, "/panel/personel"), (B, "/panel/personel"), (S, "/ekip"))),
        new("approvals", "Onay kapısı", "Approval workflow",
            ["onay", "onay bekleyen", "onaya dustu", "taslak", "neden onay", "onay kapisi", "approval", "pending approval", "hemen gorunmuyor", "neden gorunmuyor", "degisiklik gorunmuyor", "yaptigim degisiklik"],
            ["Personelin yaptığı değişiklikler taslak olarak Onay Bekleyenler'e düşer.", "Yönetici taslağı inceleyip onaylar ya da reddeder.", "Onaylanan değişiklik o anda uygulanır; personel sonucu bildirim olarak görür."],
            ["Staff changes go to Pending Approvals as drafts.", "A manager reviews and approves or rejects the draft.", "An approved change applies immediately; the staff member is notified."],
            R((O, "/panel/onaylar"), (B, "/panel/onaylar"), (S, "/ekip"))) { FeatureKeys = [FeatureCatalog.ApprovalWorkflow] },

        // ── Bildirim & pazarlama ────────────────────────────────────────────
        new("notifications", "WhatsApp, SMS ve e-posta hatırlatmaları", "WhatsApp, SMS and email reminders",
            ["whatsapp", "sms", "e posta", "hatirlatma", "otomatik hatirlatma", "bildirim", "sablon", "mesaj kotasi", "reminder", "notification", "otomatik mesaj", "mesaj gitsin", "sms metni", "mesaj metni"],
            ["Bildirimler sayfasını açın.", "Otomatik hatırlatma tetikleyicilerini ve şablonları düzenleyin.", "Aylık mesaj kotanızı ve kalan krediyi aynı ekranda görün."],
            ["Open the Notifications page.", "Edit automatic reminder triggers and templates.", "See your monthly message quota and remaining credits on the same screen."],
            Managers("/panel/bildirimler", "/ekip/bildirimler"))
            {
                FeatureKeys = [FeatureCatalog.NotificationsSms, FeatureCatalog.NotificationsWhatsApp, FeatureCatalog.NotificationsEmail, FeatureCatalog.NotificationsBulk, FeatureCatalog.NotificationsTemplates],
                StaffPermission = Permissions.Notifications,
            },
        new("bulk-message", "Toplu mesaj gönderme", "Sending bulk messages",
            ["toplu mesaj", "toplu sms", "toplu whatsapp", "duyuru gonder", "herkese mesaj", "musterilere mesaj", "bulk message", "broadcast"],
            ["Bildirimler sayfasını açın.", "Hedef müşterileri (tümü, segment ya da elle seçim) ve kanalı seçin.", "Mesajı yazın; gönderim öncesi kaç kişiye gideceğini ve tahmini krediyi görüp onaylayın."],
            ["Open the Notifications page.", "Choose target customers (all, a segment or a manual pick) and the channel.", "Write the message; check the recipient count and estimated credits before confirming."],
            R((O, "/panel/bildirimler"), (B, "/panel/bildirimler"))) { FeatureKeys = [FeatureCatalog.NotificationsBulk] },
        new("storefront", "Salon vitrini ve online randevu", "Salon storefront and online booking",
            ["vitrin", "salon vitrini", "online randevu", "salon sayfasi", "salon linki", "salon profili", "storefront", "online booking", "internetten randevu", "kendi randevusunu", "randevu sayfasi"],
            ["Salon Vitrini sayfasını açın.", "Profil bilgilerini, hizmetleri ve görselleri düzenleyin.", "Vitrin bağlantısını paylaşın; müşteriler oradan online randevu alır."],
            ["Open the Salon Storefront page.", "Edit the profile, services and photos.", "Share the storefront link; customers book online from there."],
            R((O, "/panel/salon-profili"), (B, "/panel/salon-profili"))) { FeatureKeys = [FeatureCatalog.AppointmentsOnlineBooking] },

        // ── Yönetim ─────────────────────────────────────────────────────────
        new("logs", "Log kayıtları", "Activity logs",
            ["log", "loglar", "kayit gecmisi", "kim yapti", "kim sildi", "denetim", "islem gecmisi", "activity log", "audit log", "kim silmis", "kimin yaptigi", "kim degistirdi"],
            ["Log Kayıtları sayfasını açın.", "Kişi, tarih ya da işlem türüne göre filtreleyin.", "Kimin, ne zaman, hangi cihazdan ne yaptığını görün."],
            ["Open the Activity Logs page.", "Filter by person, date or action type.", "See who did what, when and from which device."],
            Managers("/panel/loglar", "/ekip/loglar")) { FeatureKeys = [FeatureCatalog.AuditLogs], StaffPermission = Permissions.Logs },
        new("settings", "Ayarlar ve şubeler", "Settings and branches",
            ["ayarlar", "sube ekle", "yeni sube", "kurum bilgisi", "calisma saatleri", "guvenlik ayari", "whatsapp baglantisi", "settings", "add branch"],
            ["Ayarlar sayfasını açın.", "Kurum ve şube bilgilerini, çalışma saatlerini, finans tercihlerini ve kapasiteyi düzenleyin.", "WhatsApp bağlantısı ve güvenlik ayarları da bu sayfadadır."],
            ["Open the Settings page.", "Edit institution and branch details, working hours, finance preferences and capacity.", "WhatsApp connection and security settings are on this page too."],
            R((O, "/panel/ayarlar"), (B, "/panel/ayarlar"))),
        new("subscription", "Paketim (abonelik)", "My plan (subscription)",
            ["abonelik", "paketim", "paket yenile", "kota", "kotam", "faturalarim", "subscription", "my plan"],
            ["Paketim sayfasını açın.", "Mevcut planınızı, dönemi ve kotalarınızı görün.", "Faturalarınız da bu sayfada listelenir."],
            ["Open My Plan.", "See your current plan, period and quotas.", "Your invoices are listed on this page too."],
            R((O, "/panel/paket"))) { PurchaseSurface = true },
        new("staff-profile", "Profil ve parola", "Profile and password",
            ["sifre degistir", "sifremi degistir", "parola", "parola degistir", "profilim", "profil", "change password", "my profile", "sifre yenile", "sifremi yenile", "giris sifre"],
            ["Profil sayfasını açın (yönetici için Ayarlar).", "Ad ve iletişim bilgilerinizi güncelleyin.", "Parola değiştir bölümünde mevcut ve yeni parolanızı girip kaydedin."],
            ["Open your Profile page (Settings for managers).", "Update your name and contact details.", "Enter your current and new password in Change password, then save."],
            R((S, "/ekip/profil"), (O, "/panel/ayarlar"), (B, "/panel/ayarlar"))),

        // ── Müşteri portalı ─────────────────────────────────────────────────
        new("customer-book", "Online randevu alma", "Booking online",
            ["randevu al", "online randevu", "randevu almak", "bos saat", "musait saat", "randevu olustur", "book online", "available time", "kendime gun", "gun ayarla", "bos saatler", "hangi saatler bos"],
            ["Online Randevu ekranını açın.", "Şubeyi, hizmeti ve uygun saati seçin.", "Onaylayın; randevunuz salonun onayına düşer ve size bildirim gelir."],
            ["Open Online Booking.", "Choose the branch, service and an available time.", "Confirm; the salon reviews your request and you get a notification."],
            R((C, "/randevu"))) { FeatureKeys = [FeatureCatalog.AppointmentsOnlineBooking] },
        new("customer-my-appointments", "Randevularımı görme, erteleme, iptal", "Viewing, rescheduling or cancelling my appointments",
            ["randevularim", "randevum", "ertele", "randevu ertele", "iptal et", "randevu iptal", "randevu degistir", "my appointments", "reschedule", "randevumu", "ileri al", "baska gune", "haftaya al"],
            ["Randevularım ekranını açın.", "Değiştirmek istediğiniz randevuyu seçin.", "Ertele ya da İptal Et'e basın; salon bilgilendirilir."],
            ["Open My Appointments.", "Choose the appointment you want to change.", "Press Reschedule or Cancel; the salon is notified."],
            R((C, "/randevu"))) { FeatureKeys = [FeatureCatalog.AppointmentsOnlineBooking] },
    ];

    /// <summary>
    /// Kişinin görebileceği makaleler: portalında rotası olan, paketinde özelliği açık olan, personel ise
    /// sayfa izni olan ve (mağaza sürümünde) satın alma yüzeyi olmayan makaleler.
    /// </summary>
    /// <param name="activeFeatures">Kurumun paketindeki özellikler; null = paket yok, hepsi serbest (bkz. IFeatureService.IsFeatureAllowedAsync).</param>
    public static IReadOnlyList<AssistantHelpArticle> VisibleTo(
        string portal, UserRole? role, IReadOnlyCollection<string> staffPermissions, IReadOnlyCollection<string>? activeFeatures, bool storeBuild)
        => Articles.Where(article => IsVisible(article, portal, role, staffPermissions, activeFeatures, storeBuild)).ToList();

    public static bool IsVisible(
        AssistantHelpArticle article, string portal, UserRole? role, IReadOnlyCollection<string> staffPermissions, IReadOnlyCollection<string>? activeFeatures, bool storeBuild)
    {
        if (!article.Routes.ContainsKey(portal)) return false;
        if (storeBuild && article.PurchaseSurface) return false;
        if (activeFeatures is not null && article.FeatureKeys.Count > 0
            && !article.FeatureKeys.Any(key => activeFeatures.Contains(key, StringComparer.OrdinalIgnoreCase)))
            return false;
        if (portal == AssistantPortals.Staff && article.StaffPermission is { Length: > 0 } permission
            && !Permissions.IsGrantedTo(role, isPlatformAdmin: false, staffPermissions, permission))
            return false;
        return true;
    }

    /// <summary>
    /// Soruya en uygun makale. Önce kişinin görebildiği makaleler; eşleşme yoksa başka portala ait bir
    /// makale (OtherPortal=true) döner ki Maydi "bu işlem X panelinden yapılıyor" diyebilsin. Paketi ya da
    /// izni kapalı makale "başka portal" olarak da önerilmez (kişi o ekranı hiçbir yoldan açamaz).
    /// Eşleşme kelime bazlıdır ve Türkçe ekleri tolere eder: bir anahtar ifadenin her kelimesi metindeki bir
    /// kelimenin başına uymalı (randevu/randevuyu, iptal/iptali). Puan: eşleşen ifadelerin kelime sayısı toplamı.
    /// </summary>
    public static (AssistantHelpArticle? Article, bool OtherPortal) Match(string foldedText, string portal, IReadOnlyList<AssistantHelpArticle> visible)
    {
        var tokens = foldedText.Split([' ', ',', '.', '?', '!', '\'', '’', ':', ';', '(', ')', '/', '-'], StringSplitOptions.RemoveEmptyEntries);

        static bool WordMatches(string word, string token)
        {
            if (token.StartsWith(word, StringComparison.Ordinal)) return true;
            if (word.Length < 4 || token.Length < 4) return false;
            var common = 0;
            while (common < word.Length && common < token.Length && word[common] == token[common]) common++;
            // Ünsüz yumuşaması (kitap → kitabı, çizelge → çizelgeyi): son harf değişebilir.
            return common >= Math.Max(4, word.Length - 1);
        }

        int Score(AssistantHelpArticle article) => article.Keywords
            .Select(keyword => keyword.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .Where(words => words.All(word => tokens.Any(token => WordMatches(word, token))))
            .Sum(words => words.Length);

        var ranked = Articles
            .Select(article => (Article: article, Score: Score(article)))
            .Where(item => item.Score > 0)
            .OrderByDescending(item => item.Score)
            .ToList();
        var visibleIds = visible.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        var own = ranked.FirstOrDefault(item => visibleIds.Contains(item.Article.Id));
        if (own.Article is not null) return (own.Article, false);
        // En iyi eşleşme kişinin portalında var ama paketi/izni kapalıysa: başka portal önerilmez.
        // Müşteriye işletme panelini, işletmeye müşteri portalını önermek de anlamsızdır.
        if (ranked.Count == 0 || ranked[0].Article.Routes.ContainsKey(portal)) return (null, false);
        var best = ranked[0].Article;
        var crossesAudience = portal == AssistantPortals.Customer
            ? best.Routes.Keys.All(key => key != AssistantPortals.Customer)
            : best.Routes.Keys.All(key => key == AssistantPortals.Customer);
        return crossesAudience ? (null, false) : (best, true);
    }
}

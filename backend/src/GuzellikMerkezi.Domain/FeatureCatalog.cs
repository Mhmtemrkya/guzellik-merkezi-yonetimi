namespace GuzellikMerkezi.Domain;

/// <summary>
/// Projenin tüm "premium" özelliklerinin merkezi kaynağı. Her özellik bir paket'e
/// (SubscriptionPlan.Features CSV) eklenerek tenant'lara açılır. Kategoriler UI
/// gruplaması içindir; logic backend tarafından feature key üzerinden işler.
///
/// Yeni özellik eklerken:
/// 1) Aşağıda const + FeatureItem ekle
/// 2) Plan seed'lerine (DatabaseBootstrap.SeedSubscriptionPlansAsync) hangi paketlere dahil olacağını yaz
/// 3) Frontend useFeature('key') ile UI gating yap
/// </summary>
public static class FeatureCatalog
{
    // ---------- Excel Import/Export (6) ----------
    public const string ExcelCustomers      = "excel.customers";
    public const string ExcelAppointments   = "excel.appointments";
    public const string ExcelServices       = "excel.services";
    public const string ExcelStaff          = "excel.staff";
    public const string ExcelBranches       = "excel.branches";
    public const string ExcelReports        = "excel.reports";

    // ---------- PDF (2) ----------
    public const string PdfReports          = "pdf.reports";
    public const string PdfCredentials      = "pdf.credentials";

    // ---------- Raporlar (4) ----------
    public const string ReportsFinance      = "reports.finance";
    public const string ReportsCustomer     = "reports.customer";
    public const string ReportsStaff        = "reports.staff";
    public const string ReportsServices     = "reports.services";

    // ---------- Bildirimler (5) ----------
    public const string NotificationsSms        = "notifications.sms";
    public const string NotificationsWhatsApp   = "notifications.whatsapp";
    public const string NotificationsEmail      = "notifications.email";
    public const string NotificationsBulk       = "notifications.bulk";
    public const string NotificationsTemplates  = "notifications.templates";
    public const string NotificationsAutomation = "notifications.automation";

    // ---------- Ön Muhasebe (3) ----------
    public const string AccountingInstallments  = "accounting.installments";
    public const string AccountingPayments      = "accounting.payments";
    public const string BillingAdisyon          = "billing.adisyon";

    // ---------- Operasyon (5) ----------
    public const string StockProducts           = "stock.products";
    public const string StockMovements          = "stock.movements";
    public const string CategoriesExpenseCustom = "categories.expense.custom";
    public const string CategoriesServiceCustom = "categories.service.custom";
    public const string AuditLogs               = "audit.logs";

    // ---------- Klinik (3) ----------
    public const string ClinicalConsultation = "clinical.consultation";
    public const string ClinicalBeforeAfter  = "clinical.beforeafter";
    public const string ClinicalCustomFields = "clinical.customfields";

    // ---------- Müşteri / CRM (2) ----------
    public const string CustomersBlacklist   = "customers.blacklist";
    public const string CustomersPassive     = "customers.passive";

    // ---------- Personel (2) ----------
    public const string StaffCommission     = "staff.commission";
    public const string StaffSchedule       = "staff.schedule";

    // ---------- Pazarlama (2) ----------
    public const string MarketingCampaigns  = "marketing.campaigns";
    public const string LoyaltyPoints       = "loyalty.points";

    // ---------- Faz 1 ek özellikler (3) ----------
    public const string MarketingGiftCards  = "marketing.giftcards";
    public const string FinanceCashClosing  = "finance.cashclosing";
    public const string AppointmentsWaitlist = "appointments.waitlist";

    // ---------- Kurum & Sistem (5) ----------
    public const string StaffPermissions    = "staff.permissions";
    public const string ApprovalWorkflow    = "approval.workflow";
    public const string MultiBranch         = "multiBranch";
    public const string ApiAccess           = "api.access";
    public const string AiInsights          = "ai.insights";

    public static readonly FeatureItem[] All =
    {
        // Excel
        new(ExcelCustomers,    "Müşteri Excel",         "Müşteri listesini Excel'e aktar / Excel'den içe al", FeatureCategory.Excel),
        new(ExcelAppointments, "Randevu Excel",         "Randevuları Excel'e aktar / Excel'den içe al",       FeatureCategory.Excel),
        new(ExcelServices,     "Hizmet Excel",          "Hizmet kataloğunu Excel'e aktar / içe al",           FeatureCategory.Excel),
        new(ExcelStaff,        "Personel Excel",        "Personel listesini Excel'e aktar / içe al",          FeatureCategory.Excel),
        new(ExcelBranches,     "Şube Excel",            "Şube listesini Excel'e aktar / içe al",              FeatureCategory.Excel),
        new(ExcelReports,      "Rapor Excel",           "Raporlar sayfasından Excel çıktısı",                 FeatureCategory.Excel),

        // PDF
        new(PdfReports,        "Rapor PDF",             "Raporlar sayfasından Türkçe PDF çıktısı",            FeatureCategory.Pdf),
        new(PdfCredentials,    "Personel Kart PDF",     "Yeni personel oluşturulunca giriş bilgileri PDF'i",  FeatureCategory.Pdf),

        // Raporlar
        new(ReportsFinance,    "Finans raporu",         "Gelir / gider / net akış raporu",                    FeatureCategory.Reports),
        new(ReportsCustomer,   "Müşteri analitiği",     "Müşteri segmentasyonu, yaşam değeri",                FeatureCategory.Reports),
        new(ReportsStaff,      "Personel performansı",  "Personel bazlı seans, ciro, komisyon",               FeatureCategory.Reports),
        new(ReportsServices,   "Hizmet doluluk",        "Hizmet bazlı doluluk, popülerlik raporu",            FeatureCategory.Reports),

        // Bildirimler
        new(NotificationsSms,       "SMS bildirim",        "SMS şablonu ile tek/toplu gönderim",              FeatureCategory.Notifications),
        new(NotificationsWhatsApp,  "WhatsApp bildirim",   "WhatsApp Business şablonu ile gönderim",          FeatureCategory.Notifications),
        new(NotificationsEmail,     "E-posta bildirim",    "E-posta şablonu ile gönderim",                    FeatureCategory.Notifications),
        new(NotificationsBulk,      "Toplu gönderim",      "Kitle seçip toplu mesaj gönderme",                FeatureCategory.Notifications),
        new(NotificationsTemplates, "Şablon yönetimi",     "Mesaj şablonları oluşturma / düzenleme",          FeatureCategory.Notifications),
        new(NotificationsAutomation,"Otomatik gönderim",   "Randevu hatırlatma, doğum günü, ödeme hatırlatma otomatik gönderir", FeatureCategory.Notifications),

        // Ön Muhasebe
        new(AccountingInstallments, "Taksitli cari hesap", "Cari hesap aç, taksit planı oluştur",             FeatureCategory.Accounting),
        new(AccountingPayments,     "Tahsilat kaydı",      "Cari hesaba tahsilat al, FIFO ile taksit kapama", FeatureCategory.Accounting),
        new(BillingAdisyon,         "Adisyon onay akışı",  "İşlemler önce adisyona düşer; onaylanınca cariye+kasaya aktarılır", FeatureCategory.Accounting),

        // Operasyon
        new(StockProducts,           "Ürün yönetimi",      "Stok ürünleri tanımla, kategori ata",             FeatureCategory.Operations),
        new(StockMovements,          "Stok hareketi",      "Giriş / çıkış / sayım hareketleri",               FeatureCategory.Operations),
        new(CategoriesExpenseCustom, "Özel gider kategorisi","Kuruma özel gider kategorisi oluştur",          FeatureCategory.Operations),
        new(CategoriesServiceCustom, "Özel hizmet kategorisi","Kuruma özel hizmet kategorisi oluştur",        FeatureCategory.Operations),
        new(AuditLogs,               "Log kayıtları",      "Sistem aktivite günlüğü görüntüleme",             FeatureCategory.Operations),

        // Klinik
        new(ClinicalConsultation,    "Müşteri bilgi ve onay formu", "Müşteri beyanları + işlem uygunluğu uyarıları", FeatureCategory.Operations),
        new(ClinicalBeforeAfter,     "Önce/Sonra galerisi","İşlem günlüğü + önce/sonra karşılaştırma kaydırıcısı", FeatureCategory.Operations),
        new(ClinicalCustomFields,    "Konsültasyon özel alanları","Bilgi formuna kuruma/şubeye özel checkbox/seçenek ekleme", FeatureCategory.Operations),

        // Müşteri / CRM
        new(CustomersBlacklist,      "Kara liste",          "Müşteriyi kara listeye al — randevu engelle",   FeatureCategory.Operations),
        new(CustomersPassive,        "Pasif müşteri listesi","Uzun süredir işlemsiz müşteriler + eşik ayarı", FeatureCategory.Operations),

        // Personel
        new(StaffCommission,  "Personel primi",           "Adisyon onayında otomatik komisyon/prim tahakkuku", FeatureCategory.Organization),
        new(StaffSchedule,    "Personel çizelgesi",       "Haftalık/aylık personel programı, fotoğraf, izin günleri", FeatureCategory.Organization),
        new(MarketingCampaigns, "Kampanya yönetimi",      "Hizmet/paket indirim kampanyaları tanımlama",       FeatureCategory.Organization),
        new(LoyaltyPoints,      "Sadakat puanı",          "Müşteri puan kazanımı ve kullanımı",                FeatureCategory.Organization),
        new(MarketingGiftCards, "Hediye çeki & kupon",    "Yüzde/tutar kuponu ve yüklü bakiyeli hediye çeki tanımlama", FeatureCategory.Organization),

        // Faz 1 ek özellikler
        new(FinanceCashClosing,    "Gün sonu kasa kapanışı", "Z raporu: sayım, sistem nakdi ve fark mutabakatı", FeatureCategory.Accounting),
        new(AppointmentsWaitlist,  "Bekleme listesi",        "Dolu güne talep toplama, sıradakine teklif",       FeatureCategory.Operations),

        // Kurum & Sistem
        new(StaffPermissions, "Personel yetkilendirme",   "Personel için 12 sayfa bazlı izin atama",          FeatureCategory.Organization),
        new(ApprovalWorkflow, "Onay akışı",               "Personel işlemleri kurum yöneticisi onayına düşer",FeatureCategory.Organization),
        new(MultiBranch,      "Çoklu şube",               "Birden fazla şube yönetimi",                       FeatureCategory.Organization),
        new(ApiAccess,        "API erişimi",              "Public REST API anahtarı + dokümantasyon",         FeatureCategory.Organization),
        new(AiInsights,       "AI öneriler",              "AI tabanlı müşteri segmentasyonu, randevu öneri",  FeatureCategory.Organization),
    };

    public static bool Exists(string key) =>
        Array.Exists(All, f => string.Equals(f.Key, key, StringComparison.OrdinalIgnoreCase));
}

public sealed record FeatureItem(string Key, string Name, string Description, FeatureCategory Category);

public enum FeatureCategory
{
    Excel = 0,
    Pdf = 1,
    Reports = 2,
    Notifications = 3,
    Accounting = 4,
    Operations = 5,
    Organization = 6,
}

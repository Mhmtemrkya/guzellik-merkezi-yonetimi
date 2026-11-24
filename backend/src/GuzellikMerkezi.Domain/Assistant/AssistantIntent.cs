namespace GuzellikMerkezi.Domain.Assistant;

/// <summary>
/// Maydi'nin anladığı niyetler. Veri niyetleri kural motoruyla (anlaşılamazsa yapay zekâ sınıflandırmasıyla)
/// çözülür ve veritabanından SAYIYLA cevaplanır; yapay zekâ veri UYDURMAZ ve rakam görmez (veri cevapları buluta
/// hiç gitmez). Aynı niyet portala göre kapsam değiştirir: "bugünkü randevular" personelde kendi randevuları,
/// yöneticide şubenin/kurumun randevularıdır. Dönem (bugün, geçen ay, ocak…) <see cref="AssistantDateParser"/> ile
/// sorudan çıkarılır; yoksa niyetin varsayılan dönemi kullanılır.
/// </summary>
public enum AssistantIntent
{
    Unknown = 0,
    Greeting = 1,
    Thanks = 2,
    SmallTalk = 3,
    /// <summary>"Neler yapabilirsin" — yetenek listesi + öneriler.</summary>
    Help = 4,
    /// <summary>"Nasıl yapılır / nerede" — yardım kataloğu.</summary>
    HowTo = 5,
    /// <summary>Güzellik/sağlık tavsiyesi ("hangi işlem bana uygun") — verilmez, uzmana yönlendirilir.</summary>
    BeautyAdvice = 6,

    /// <summary>Randevular (adı tarihî: yalnız bugün değil, sorulan her gün/dönem).</summary>
    AppointmentsToday = 20,
    NextAppointment = 21,
    WeekSchedule = 22,
    RemainingSessions = 23,
    MyRating = 24,
    PendingApprovals = 25,
    FreeSlots = 26,
    /// <summary>Gelir/ciro/tahsilat (adı tarihî): tahsilat, satış, gider ve net — sorulan dönem için.</summary>
    Revenue = 27,
    OverdueInstallments = 28,
    CriticalStock = 29,
    Waitlist = 30,
    /// <summary>Personel performansı: tamamlanan randevu, ciro, prim, puan.</summary>
    TopStaff = 31,
    NoShows = 32,
    AppointmentHistory = 33,
    Expenses = 34,
    Profit = 35,
    Sales = 36,
    Receivables = 37,
    TopServices = 38,
    Branches = 39,
    NewCustomers = 40,
    CustomerCount = 41,
    TopCustomers = 42,
    PassiveCustomers = 43,
    Birthdays = 44,
    Cancellations = 45,
    BusiestTimes = 46,
    Inventory = 47,
    PaymentMethods = 48,

    // ── Adıyla sorulan kayıtlar (ad yapay zekâya gitmez; bulma veritabanında) ──
    /// <summary>"Ayşe Yılmaz'ın borcu / kalan seansı / son ve sonraki randevusu".</summary>
    CustomerLookup = 50,
    /// <summary>"Lazer kaç TL", "fiyat listesi" — hizmet ve paket fiyatları (müşteri dahil herkese).</summary>
    ServicePrice = 51,
    /// <summary>"Zeynep yarın çalışıyor mu", "Zeynep'in yarınki randevuları".</summary>
    StaffSchedule = 52,
    /// <summary>"X kremden kaç tane var".</summary>
    ProductStock = 53,

    // ── Rolün kendi durum soruları ──
    Subscription = 54,
    MessagingCredits = 55,
    CashClosingStatus = 56,
    /// <summary>Bugün kim çalışıyor, kim izinli.</summary>
    StaffToday = 57,
    Campaigns = 58,
    KvkkPending = 59,
    GiftCards = 60,
    /// <summary>Personelin kendi yaptığı işler (para yok: personel ekranı ciro/prim göstermez).</summary>
    MyWork = 61,
    /// <summary>Müşterinin kendi borcu / taksitleri.</summary>
    MyDebt = 62,
    /// <summary>Müşterinin sadakat puanı.</summary>
    Loyalty = 63,
    /// <summary>Salonun adresi, telefonu, çalışma saatleri.</summary>
    SalonInfo = 64,
}

/// <summary>Bir veri niyetinin kimlere ve hangi koşulda açık olduğu.</summary>
/// <param name="Portals">Niyetin cevaplandığı portallar; başka portalda "bu bilgi panelinizde yok" denir.</param>
/// <param name="FeatureKeys">Paket kapısı (en az biri); boş = her pakette.</param>
/// <param name="StaffPermission">Personelin sayfa izni (web menüsündeki permissionKey ile aynı).</param>
/// <param name="Route">Cevap kartındaki "Sayfayı aç" bağlantısı (portal → rota).</param>
/// <param name="Description">Yapay zekâ sınıflandırmasında niyetin tarifi (Türkçe, kısa).</param>
public sealed record AssistantIntentRule(
    AssistantIntent Intent,
    IReadOnlyList<string> Portals,
    IReadOnlyList<string> FeatureKeys,
    string? StaffPermission,
    IReadOnlyDictionary<string, string> Route,
    string Description = "");

public static class AssistantIntentCatalog
{
    private const string O = AssistantPortals.Owner, B = AssistantPortals.Branch, S = AssistantPortals.Staff, C = AssistantPortals.Customer;
    private const string Reports = "/panel/raporlar";

    private static AssistantIntentRule Rule(AssistantIntent intent, string description, string[] portals, string[]? features = null, string? permission = null, params (string Portal, string Route)[] routes) =>
        new(intent, portals, features ?? [], permission, routes.ToDictionary(item => item.Portal, item => item.Route), description);

    private static (string, string)[] Manager(string route) => [(O, route), (B, route)];

    public static readonly IReadOnlyList<AssistantIntentRule> DataRules =
    [
        Rule(AssistantIntent.AppointmentsToday, "Belirli bir gün ya da dönemdeki randevular (bugün, yarın, dün, bu hafta, ocakta kaç randevu; kim gelecek)",
            [O, B, S, C], permission: Permissions.Appointments,
            routes: [(O, "/panel/randevular"), (B, "/panel/randevular"), (S, "/ekip/randevular"), (C, "/randevu")]),
        Rule(AssistantIntent.NextAppointment, "Sıradaki / yaklaşan randevu, sıradaki müşteri", [S, C], permission: Permissions.Appointments,
            routes: [(S, "/ekip/randevular"), (C, "/randevu")]),
        Rule(AssistantIntent.WeekSchedule, "Bu haftanın gün gün randevu programı", [O, B, S], permission: Permissions.Appointments,
            routes: [(O, "/panel/randevular"), (B, "/panel/randevular"), (S, "/ekip/randevular")]),
        Rule(AssistantIntent.RemainingSessions, "Paketlerde kalan seans sayısı", [S, C], permission: Permissions.Services,
            routes: [(S, "/ekip/seanslar"), (C, "/randevu")]),
        Rule(AssistantIntent.MyRating, "Personelin kendi yıldız puanı", [S], routes: [(S, "/ekip")]),
        Rule(AssistantIntent.MyWork, "Personelin kendi yaptığı işler: kaç randevu/işlem yaptım, kaç müşteriye baktım", [S], permission: Permissions.Appointments,
            routes: [(S, "/ekip/randevular")]),
        Rule(AssistantIntent.PendingApprovals, "Onay bekleyen işlemler / taslaklar", [O, B, S], [FeatureCatalog.ApprovalWorkflow],
            routes: [(O, "/panel/onaylar"), (B, "/panel/onaylar"), (S, "/ekip")]),
        Rule(AssistantIntent.FreeSlots, "Bugün ya da bir gün için personelin boş saatleri", [O, B], routes: Manager("/panel/randevular")),
        // Finans: yönetici rolleri ve EKRANI GÖREBİLEN personel (aynı izin anahtarı; personel paneli o sayfayı izinle açar).
        Rule(AssistantIntent.Revenue, "Gelir, ciro, kazanç, tahsilat, kasaya giren para (herhangi bir dönem: bugün, dün, ocak ayı, geçen yıl)",
            [O, B, S], permission: Permissions.CashRegister, routes: Staffed("/panel/kasa", "/ekip/kasa")),
        Rule(AssistantIntent.PaymentMethods, "Ödeme yöntemlerine göre tahsilat (nakit, kart, havale)", [O, B, S], permission: Permissions.CashRegister,
            routes: Staffed("/panel/kasa", "/ekip/kasa")),
        Rule(AssistantIntent.CashClosingStatus, "Gün sonu kasa kapanışı yapıldı mı", [O, B, S], [FeatureCatalog.FinanceCashClosing], Permissions.CashClosing,
            routes: Staffed("/panel/kasa-kapanis", "/ekip/kasa-kapanis")),
        Rule(AssistantIntent.Expenses, "Giderler, masraflar, harcamalar ve kategorileri", [O, B, S], permission: Permissions.Accounting,
            routes: Staffed("/panel/on-muhasebe", "/ekip/on-muhasebe")),
        Rule(AssistantIntent.OverdueInstallments, "Vadesi geçmiş / geciken taksitler", [O, B, S], permission: Permissions.Accounting,
            routes: Staffed("/panel/on-muhasebe", "/ekip/on-muhasebe")),
        Rule(AssistantIntent.Receivables, "Alacaklar, müşterilerin kalan borcu, borçlu müşteriler", [O, B, S], permission: Permissions.Accounting,
            routes: Staffed("/panel/on-muhasebe", "/ekip/on-muhasebe")),
        Rule(AssistantIntent.Profit, "Kâr, zarar, net kazanç, kârlılık", [O, B, S], permission: Permissions.Reports, routes: Staffed(Reports, "/ekip/raporlar")),
        Rule(AssistantIntent.Sales, "Satış tutarı ve adedi (paket, hizmet, ürün satışları; cironun kaynağı)", [O, B, S], permission: Permissions.Reports,
            routes: Staffed(Reports, "/ekip/raporlar")),
        Rule(AssistantIntent.TopStaff, "Personel performansı: en çok çalışan, en çok ciro yapan personel, prim/komisyon, puanlar", [O, B, S],
            permission: Permissions.Reports, routes: Staffed(Reports, "/ekip/raporlar")),
        Rule(AssistantIntent.TopServices, "En çok satan / en çok yapılan hizmetler ve paketler", [O, B, S], permission: Permissions.Reports,
            routes: Staffed(Reports, "/ekip/raporlar")),
        Rule(AssistantIntent.TopCustomers, "En çok harcayan / en sadık / en çok gelen müşteriler", [O, B, S], permission: Permissions.Reports,
            routes: Staffed("/panel/musteriler", "/ekip/raporlar")),
        Rule(AssistantIntent.BusiestTimes, "En yoğun günler ve saatler", [O, B, S], permission: Permissions.Reports, routes: Staffed(Reports, "/ekip/raporlar")),
        Rule(AssistantIntent.Branches, "Şubelerin karşılaştırması (gelir, randevu, müşteri)", [O], [FeatureCatalog.MultiBranch], routes: [(O, Reports)]),
        Rule(AssistantIntent.CriticalStock, "Kritik seviyedeki / azalan / biten ürünler", [O, B, S], [FeatureCatalog.StockProducts, FeatureCatalog.StockMovements],
            Permissions.Stock, routes: Staffed("/panel/stok", "/ekip/stok")),
        Rule(AssistantIntent.Inventory, "Stok durumu, ürün sayısı, stok değeri, ürün satışları", [O, B, S], [FeatureCatalog.StockProducts, FeatureCatalog.StockMovements],
            Permissions.Stock, routes: Staffed("/panel/stok", "/ekip/stok")),
        Rule(AssistantIntent.ProductStock, "Belirli bir ürünün stok adedi ve fiyatı (X kremden kaç tane var)", [O, B, S],
            [FeatureCatalog.StockProducts, FeatureCatalog.StockMovements], Permissions.Stock, routes: Staffed("/panel/stok", "/ekip/stok")),
        Rule(AssistantIntent.Waitlist, "Bekleme listesindeki kişiler", [O, B, S], [FeatureCatalog.AppointmentsWaitlist], Permissions.Waitlist,
            routes: Staffed("/panel/bekleme-listesi", "/ekip/bekleme-listesi")),
        Rule(AssistantIntent.NewCustomers, "Yeni kazanılan / kayıt olan müşteri sayısı", [O, B], routes: Manager("/panel/musteriler")),
        Rule(AssistantIntent.CustomerCount, "Toplam müşteri sayısı, aktif, VIP, kara liste", [O, B], routes: Manager("/panel/musteriler")),
        Rule(AssistantIntent.PassiveCustomers, "Uzun süredir gelmeyen (pasif, kayıp) müşteriler", [O, B], [FeatureCatalog.CustomersPassive],
            routes: Manager("/panel/musteriler")),
        Rule(AssistantIntent.KvkkPending, "KVKK onayı vermemiş müşteriler", [O, B, S], permission: Permissions.Customers,
            routes: Staffed("/panel/musteriler?scope=kvkk-pending", "/ekip/musteriler")),
        Rule(AssistantIntent.Birthdays, "Doğum günü olan müşteriler", [O, B], routes: Manager("/panel/musteriler")),
        Rule(AssistantIntent.NoShows, "Randevusuna gelmeyen müşteriler", [O, B], routes: Manager("/panel/musteriler")),
        Rule(AssistantIntent.Cancellations, "İptal edilen randevular", [O, B], routes: Manager("/panel/randevular")),
        Rule(AssistantIntent.CustomerLookup, "Adı verilen bir müşterinin bilgileri: borcu, kalan seansı, son/sonraki randevusu, puanı", [O, B, S],
            permission: Permissions.Customers, routes: Staffed("/panel/musteriler", "/ekip/musteriler")),
        Rule(AssistantIntent.ServicePrice, "Hizmet ve paket fiyatları, süreleri; fiyat listesi; hangi hizmetler var", [O, B, S, C],
            routes: [(O, "/panel/paketler"), (B, "/panel/paketler"), (S, "/ekip/paketler"), (C, "/randevu")]),
        Rule(AssistantIntent.StaffSchedule, "Adı verilen personelin bir gündeki çalışma saati, izni ve randevuları", [O, B, S],
            routes: [(O, "/panel/personel/cizelge"), (B, "/panel/personel/cizelge"), (S, "/ekip/randevular")]),
        Rule(AssistantIntent.StaffToday, "Bugün (ya da bir gün) kim çalışıyor, kim izinli", [O, B], routes: Manager("/panel/personel/cizelge")),
        Rule(AssistantIntent.Subscription, "BeautyAsist aboneliğinin durumu ve bitiş tarihi", [O], routes: [(O, "/panel/paket")]),
        Rule(AssistantIntent.MessagingCredits, "WhatsApp ve SMS kredi bakiyesi", [O, B], routes: Manager("/panel/bildirimler")),
        Rule(AssistantIntent.Campaigns, "Aktif indirim kampanyaları", [O, B], [FeatureCatalog.MarketingCampaigns], routes: Manager("/panel/paketler")),
        Rule(AssistantIntent.GiftCards, "Hediye çekleri ve kuponlar (müşteride: kendi hediye çekleri)", [O, B, S, C], [FeatureCatalog.MarketingGiftCards],
            Permissions.GiftCards, routes: [(O, "/panel/hediye-cek"), (B, "/panel/hediye-cek"), (S, "/ekip/hediye-cek"), (C, "/randevu")]),
        Rule(AssistantIntent.Loyalty, "Sadakat puanı bakiyesi", [C], [FeatureCatalog.LoyaltyPoints], routes: [(C, "/randevu")]),
        Rule(AssistantIntent.MyDebt, "Müşterinin kendi borcu, taksitleri ve ödemeleri", [C], routes: [(C, "/randevu")]),
        Rule(AssistantIntent.SalonInfo, "Salonun adresi, telefonu, çalışma saatleri", [O, B, S, C],
            routes: [(O, "/panel/salon-profili"), (B, "/panel/salon-profili"), (S, "/ekip"), (C, "/randevu")]),
        Rule(AssistantIntent.AppointmentHistory, "Müşterinin geçmiş randevuları", [C], routes: [(C, "/randevu")]),
    ];

    private static (string, string)[] Staffed(string panelRoute, string staffRoute) => [(O, panelRoute), (B, panelRoute), (S, staffRoute)];

    public static AssistantIntentRule? RuleFor(AssistantIntent intent) => DataRules.FirstOrDefault(rule => rule.Intent == intent);

    public static bool IsData(AssistantIntent intent) => (int)intent >= 20;

    /// <summary>Yılı yazılmamış bir ayın bu yıla mı (ileriye bakan) yoksa son geçmiş aya mı ait olduğu.</summary>
    public static bool LooksAhead(AssistantIntent intent) => intent is AssistantIntent.AppointmentsToday or AssistantIntent.NextAppointment
        or AssistantIntent.WeekSchedule or AssistantIntent.Birthdays or AssistantIntent.FreeSlots or AssistantIntent.StaffSchedule
        or AssistantIntent.StaffToday;

    /// <summary>Portala göre örnek sorular (öneri düğmeleri). Yalnız portalın gerçekten cevaplayabildikleri.</summary>
    public static IReadOnlyList<(string Tr, string En, AssistantIntent Intent)> Suggestions(string portal) => portal switch
    {
        S =>
        [
            ("Bugünkü randevularım", "My appointments today", AssistantIntent.AppointmentsToday),
            ("Sıradaki müşterim kim?", "Who is my next customer?", AssistantIntent.NextAppointment),
            ("Yarınki randevularım", "My appointments tomorrow", AssistantIntent.AppointmentsToday),
            ("Bu haftaki programım", "My schedule this week", AssistantIntent.WeekSchedule),
            ("Paketli müşterilerimin kalan seansı", "Remaining sessions of my package customers", AssistantIntent.RemainingSessions),
            ("Yıldız puanım kaç?", "What is my star rating?", AssistantIntent.MyRating),
            ("Bu ay kaç işlem yaptım?", "How many treatments did I do this month?", AssistantIntent.MyWork),
            ("Onay bekleyen taslaklarım", "My drafts awaiting approval", AssistantIntent.PendingApprovals),
            ("Randevu nasıl oluşturulur?", "How do I create an appointment?", AssistantIntent.HowTo),
        ],
        C =>
        [
            ("Yaklaşan randevum ne zaman?", "When is my upcoming appointment?", AssistantIntent.NextAppointment),
            ("Kalan seansım kaç?", "How many sessions do I have left?", AssistantIntent.RemainingSessions),
            ("Randevu geçmişim", "My appointment history", AssistantIntent.AppointmentHistory),
            ("Borcum ne kadar?", "How much do I owe?", AssistantIntent.MyDebt),
            ("Fiyat listesi", "Price list", AssistantIntent.ServicePrice),
            ("Salonun adresi ve çalışma saatleri", "Salon address and opening hours", AssistantIntent.SalonInfo),
            ("Randevumu nasıl ertelerim?", "How do I reschedule?", AssistantIntent.HowTo),
        ],
        O or B =>
        [
            ("Bugün kaç randevu var?", "How many appointments today?", AssistantIntent.AppointmentsToday),
            ("Bugünün geliri ne kadar?", "What is today's revenue?", AssistantIntent.Revenue),
            ("Bu ayın kârı ne kadar?", "What is this month's profit?", AssistantIntent.Profit),
            ("Geçen ayın giderleri", "Last month's expenses", AssistantIntent.Expenses),
            ("En çok satan hizmetler", "Best-selling services", AssistantIntent.TopServices),
            ("Bu ay en çok çalışan personel", "Busiest staff this month", AssistantIntent.TopStaff),
            ("Yarınki randevular", "Tomorrow's appointments", AssistantIntent.AppointmentsToday),
            ("Bugün boş saatler", "Free slots today", AssistantIntent.FreeSlots),
            ("Bugün kim izinli?", "Who is off today?", AssistantIntent.StaffToday),
            ("WhatsApp kredim ne kadar?", "How many WhatsApp credits do I have?", AssistantIntent.MessagingCredits),
            ("Onay bekleyenler", "Pending approvals", AssistantIntent.PendingApprovals),
            ("Müşterilerin toplam borcu", "Total customer debt", AssistantIntent.Receivables),
            ("Geciken taksitler", "Overdue installments", AssistantIntent.OverdueInstallments),
            ("Bu ay kaç yeni müşteri geldi?", "How many new customers this month?", AssistantIntent.NewCustomers),
            ("Uzun süredir gelmeyen müşteriler", "Customers who haven't come in a while", AssistantIntent.PassiveCustomers),
            ("Bu hafta doğum günü olanlar", "Birthdays this week", AssistantIntent.Birthdays),
            ("En yoğun saatler", "Busiest hours", AssistantIntent.BusiestTimes),
            ("Kritik stoktaki ürünler", "Products at critical stock", AssistantIntent.CriticalStock),
            ("Bekleme listesi", "Waitlist", AssistantIntent.Waitlist),
            ("Gün sonu kasa kapanışı nasıl yapılır?", "How do I close the till?", AssistantIntent.HowTo),
        ],
        _ => [],
    };
}

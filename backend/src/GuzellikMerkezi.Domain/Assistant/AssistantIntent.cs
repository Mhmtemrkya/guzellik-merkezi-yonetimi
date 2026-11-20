namespace GuzellikMerkezi.Domain.Assistant;

/// <summary>
/// Maydi'nin anladığı niyetler. Veri niyetleri kural motoruyla çözülür ve veritabanından SAYIYLA cevaplanır;
/// yapay zekâ veri UYDURMAZ (veri cevapları buluta hiç gitmez). Aynı niyet portala göre kapsam değiştirir:
/// "bugünkü randevular" personelde kendi randevuları, yöneticide şubenin/kurumun randevularıdır.
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

    AppointmentsToday = 20,
    NextAppointment = 21,
    WeekSchedule = 22,
    RemainingSessions = 23,
    MyRating = 24,
    PendingApprovals = 25,
    FreeSlots = 26,
    Revenue = 27,
    OverdueInstallments = 28,
    CriticalStock = 29,
    Waitlist = 30,
    TopStaff = 31,
    NoShows = 32,
    AppointmentHistory = 33,
}

/// <summary>Bir veri niyetinin kimlere ve hangi koşulda açık olduğu.</summary>
/// <param name="Portals">Niyetin cevaplandığı portallar; başka portalda "bu bilgi panelinizde yok" denir.</param>
/// <param name="FeatureKeys">Paket kapısı (en az biri); boş = her pakette.</param>
/// <param name="StaffPermission">Personelin sayfa izni (web menüsündeki permissionKey ile aynı).</param>
/// <param name="Route">Cevap kartındaki "Sayfayı aç" bağlantısı (portal → rota).</param>
public sealed record AssistantIntentRule(
    AssistantIntent Intent,
    IReadOnlyList<string> Portals,
    IReadOnlyList<string> FeatureKeys,
    string? StaffPermission,
    IReadOnlyDictionary<string, string> Route);

public static class AssistantIntentCatalog
{
    private const string O = AssistantPortals.Owner, B = AssistantPortals.Branch, S = AssistantPortals.Staff, C = AssistantPortals.Customer;

    private static AssistantIntentRule Rule(AssistantIntent intent, string[] portals, string[]? features = null, string? permission = null, params (string Portal, string Route)[] routes) =>
        new(intent, portals, features ?? [], permission, routes.ToDictionary(item => item.Portal, item => item.Route));

    public static readonly IReadOnlyList<AssistantIntentRule> DataRules =
    [
        Rule(AssistantIntent.AppointmentsToday, [O, B, S], permission: Permissions.Appointments,
            routes: [(O, "/panel/randevular"), (B, "/panel/randevular"), (S, "/ekip/randevular")]),
        Rule(AssistantIntent.NextAppointment, [S, C], permission: Permissions.Appointments,
            routes: [(S, "/ekip/randevular"), (C, "/randevu")]),
        Rule(AssistantIntent.WeekSchedule, [O, B, S], permission: Permissions.Appointments,
            routes: [(O, "/panel/randevular"), (B, "/panel/randevular"), (S, "/ekip/randevular")]),
        Rule(AssistantIntent.RemainingSessions, [S, C], permission: Permissions.Services,
            routes: [(S, "/ekip/seanslar"), (C, "/randevu")]),
        Rule(AssistantIntent.MyRating, [S], routes: [(S, "/ekip")]),
        Rule(AssistantIntent.PendingApprovals, [O, B, S], [FeatureCatalog.ApprovalWorkflow],
            routes: [(O, "/panel/onaylar"), (B, "/panel/onaylar"), (S, "/ekip")]),
        Rule(AssistantIntent.FreeSlots, [O, B], routes: [(O, "/panel/randevular"), (B, "/panel/randevular")]),
        // Ciro yalnız finans yetkisi olanlara: bu üründe yalnız yönetici rolleri (personelde ciro sorusu yok).
        Rule(AssistantIntent.Revenue, [O, B], routes: [(O, "/panel/kasa"), (B, "/panel/kasa")]),
        Rule(AssistantIntent.OverdueInstallments, [O, B], routes: [(O, "/panel/on-muhasebe"), (B, "/panel/on-muhasebe")]),
        Rule(AssistantIntent.CriticalStock, [O, B], [FeatureCatalog.StockProducts, FeatureCatalog.StockMovements],
            routes: [(O, "/panel/stok"), (B, "/panel/stok")]),
        Rule(AssistantIntent.Waitlist, [O, B], [FeatureCatalog.AppointmentsWaitlist],
            routes: [(O, "/panel/bekleme-listesi"), (B, "/panel/bekleme-listesi")]),
        Rule(AssistantIntent.TopStaff, [O, B], routes: [(O, "/panel/personel"), (B, "/panel/personel")]),
        Rule(AssistantIntent.NoShows, [O, B], routes: [(O, "/panel/musteriler"), (B, "/panel/musteriler")]),
        Rule(AssistantIntent.AppointmentHistory, [C], routes: [(C, "/randevu")]),
    ];

    public static AssistantIntentRule? RuleFor(AssistantIntent intent) => DataRules.FirstOrDefault(rule => rule.Intent == intent);

    public static bool IsData(AssistantIntent intent) => (int)intent >= 20;

    /// <summary>Portala göre örnek sorular (öneri düğmeleri). Yalnız portalın gerçekten cevaplayabildikleri.</summary>
    public static IReadOnlyList<(string Tr, string En, AssistantIntent Intent)> Suggestions(string portal) => portal switch
    {
        S =>
        [
            ("Bugünkü randevularım", "My appointments today", AssistantIntent.AppointmentsToday),
            ("Sıradaki müşterim kim?", "Who is my next customer?", AssistantIntent.NextAppointment),
            ("Bu haftaki programım", "My schedule this week", AssistantIntent.WeekSchedule),
            ("Paketli müşterilerimin kalan seansı", "Remaining sessions of my package customers", AssistantIntent.RemainingSessions),
            ("Yıldız puanım kaç?", "What is my star rating?", AssistantIntent.MyRating),
            ("Onay bekleyen taslaklarım", "My drafts awaiting approval", AssistantIntent.PendingApprovals),
            ("Randevu nasıl oluşturulur?", "How do I create an appointment?", AssistantIntent.HowTo),
        ],
        C =>
        [
            ("Yaklaşan randevum ne zaman?", "When is my upcoming appointment?", AssistantIntent.NextAppointment),
            ("Kalan seansım kaç?", "How many sessions do I have left?", AssistantIntent.RemainingSessions),
            ("Randevu geçmişim", "My appointment history", AssistantIntent.AppointmentHistory),
            ("Randevumu nasıl ertelerim?", "How do I reschedule?", AssistantIntent.HowTo),
        ],
        O or B =>
        [
            ("Bugün kaç randevu var?", "How many appointments today?", AssistantIntent.AppointmentsToday),
            ("Bugün boş saatler", "Free slots today", AssistantIntent.FreeSlots),
            ("Onay bekleyenler", "Pending approvals", AssistantIntent.PendingApprovals),
            ("Bugünkü ciro", "Today's revenue", AssistantIntent.Revenue),
            ("Geciken taksitler", "Overdue installments", AssistantIntent.OverdueInstallments),
            ("Kritik stoktaki ürünler", "Products at critical stock", AssistantIntent.CriticalStock),
            ("Bekleme listesi", "Waitlist", AssistantIntent.Waitlist),
            ("Bu ay en çok çalışan personel", "Busiest staff this month", AssistantIntent.TopStaff),
            ("Gelmeyen müşteriler", "No-show customers", AssistantIntent.NoShows),
            ("Gün sonu kasa kapanışı nasıl yapılır?", "How do I close the till?", AssistantIntent.HowTo),
        ],
        _ => [],
    };
}

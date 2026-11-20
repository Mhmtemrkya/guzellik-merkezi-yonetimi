using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Domain.Assistant;

/// <param name="Range">Soruda geçen dönem; yoksa null (niyetin varsayılanı kullanılır).</param>
/// <param name="CorrectedText">Yazım düzeltmesiyle anlaşıldıysa düzeltilmiş (katlanmış) metin; değilse null.</param>
/// <param name="CorrectedTokens">Düzeltilen orijinal kelimeler — servis bunlardan kişi adı olanları geri alır.</param>
public sealed record AssistantParse(
    AssistantIntent Intent,
    string Folded,
    AssistantDateRange? Range,
    string? CorrectedText = null,
    IReadOnlyList<string>? CorrectedTokens = null);

/// <summary>
/// Maydi'nin kural motoru. Sıra önemlidir: önce güzellik/sağlık tavsiyesi (hiç cevaplanmaz), sonra
/// "nasıl yapılır" (yardım kataloğu), sonra veri soruları, en son sohbet. Hiçbir kural tutmazsa — ve yalnız
/// o zaman — yazım düzeltmesi denenir (bkz. <see cref="AssistantSpelling"/>); kişi adları korunur.
/// <para>
/// Türkçe ekler: kalıplar KELİME BAŞINDAN eşleşir (" gelir" → "geliri", "gelirlerini", "gelirimiz"); fiil
/// kullanımları ("yarın gelirim", "kaçta gelir", "gelir misiniz") ayrıca elenir. Kural motoru yalnız
/// katlanmış metinle çalışır ve hiçbir veri dışarı gitmez.
/// </para>
/// </summary>
public static partial class AssistantIntentResolver
{
    private static readonly TimeSpan TurkeyOffset = TimeSpan.FromHours(3);

    public static AssistantParse Resolve(string message, IReadOnlySet<string>? keepWords = null, DateTime? nowLocal = null)
    {
        var now = nowLocal ?? DateTime.UtcNow + TurkeyOffset;
        var folded = AssistantText.Fold(AssistantText.WithoutName(message ?? string.Empty));
        var text = Pad(folded);
        var intent = ResolveIntent(text, now);
        if (intent != AssistantIntent.Unknown) return new AssistantParse(intent, folded, RangeOf(folded, intent, now));

        var corrected = AssistantSpelling.Correct(folded, keepWords);
        if (!corrected.Changed) return new AssistantParse(AssistantIntent.Unknown, folded, RangeOf(folded, intent, now));
        var fixedText = Pad(corrected.Text);
        var fixedIntent = ResolveIntent(fixedText, now);
        return fixedIntent == AssistantIntent.Unknown
            ? new AssistantParse(AssistantIntent.Unknown, folded, RangeOf(folded, intent, now), corrected.Text, corrected.ChangedTokens)
            : new AssistantParse(fixedIntent, folded, RangeOf(corrected.Text, fixedIntent, now), corrected.Text, corrected.ChangedTokens);
    }

    /// <summary>Yapay zekâ bir niyet seçtiğinde dönem yine YEREL olarak sorudan çıkarılır (yapay zekâ tarih uydurmaz).</summary>
    public static AssistantDateRange? RangeOf(string folded, AssistantIntent intent, DateTime nowLocal) =>
        AssistantDateParser.Parse(folded, nowLocal, AssistantIntentCatalog.LooksAhead(intent));

    /// <summary>Kelime sınırlarıyla karşılaştırmak için metin baştan/sondan boşlukla doldurulur, noktalama boşluğa çevrilir.</summary>
    private static string Pad(string folded) => $" {NonWord().Replace(folded, " ").Trim()} ";

    private static AssistantIntent ResolveIntent(string t, DateTime now)
    {
        if (t.Trim().Length == 0) return AssistantIntent.Unknown;

        // ── Tavsiye EN ÖNDE: "lazer bana uygun mu" bir veri ya da kullanım sorusu değildir. ──
        if (IsBeautyAdvice(t)) return AssistantIntent.BeautyAdvice;

        // ── Yetenek / yardım ──
        if (Any(t, " neler yapabilir", " ne yapabilirsin", " ne ise yarar", " komutlar", " neler sorabilirim", " ne sorabilirim", " yardim eder misin", " what can you do"))
            return AssistantIntent.Help;

        // ── Nasıl yapılır / nerede (veri kalıplarından önce: "taksit nasıl girilir" bir yardım sorusudur) ──
        if (IsHowTo(t)) return AssistantIntent.HowTo;

        var data = DataIntent(t, now);
        if (data != AssistantIntent.Unknown) return data;

        // ── Sohbet (en son: "Merhaba, bugünkü randevularım" bir veri sorusudur) ──
        if (Any(t, " tesekkur", " sagol", " eyvallah", " thank", " eline saglik", " cok yardimci"))
            return AssistantIntent.Thanks;
        if (Any(t, " merhaba", " selam", " gunaydin", " iyi aksamlar", " iyi gunler", " hello ", " hi ", " hey "))
            return AssistantIntent.Greeting;
        if (Any(t, " nasilsin", " naber", " sen kimsin", " kimsin", " adin ne", " ismin ne", " bot musun", " robot musun", " who are you", " how are you"))
            return AssistantIntent.SmallTalk;

        return AssistantIntent.Unknown;
    }

    private static AssistantIntent DataIntent(string t, DateTime now)
    {
        // Bir şey YAPMA isteği ("gider girmek istiyorum", "randevu almak istiyorum", "onaylamam lazım") veri sorusu
        // değildir: yardım makalesine gider. Soru kalıbı da varsa ("ne kadar kazandığımızı görmek istiyorum") veri sayılır.
        if (IsActionRequest(t) && !IsQuery(t)) return AssistantIntent.Unknown;

        var appointmentWord = Any(t, " randevu", " appointment", " seans yapil", " islem yapil");
        var customerWord = Any(t, " musteri", " danisan", " customer", " client");
        var hasPeriod = AssistantDateParser.Parse(t.Trim(), now) is not null;

        // ── Müşteri niyetleri (kalıp olarak "gelmeyen müşteri" de içerirler; gelmeyenlerden ÖNCE) ──
        if (Any(t, " uzun suredir gelmeyen", " uzun zamandir gelmeyen", " pasif musteri", " kayip musteri", " gelmeyi birak", " kaybettigimiz musteri",
                " aylardir gelmeyen", " bir suredir gelmeyen", " inactive customer", " pasife dusen", " pasif olan"))
            return AssistantIntent.PassiveCustomers;
        if (Any(t, " dogum gun", " dogumgun", " birthday"))
            return AssistantIntent.Birthdays;
        if (Any(t, " en cok harcayan", " en iyi musteri", " en degerli musteri", " en sadik", " en cok gelen musteri", " en cok para birak",
                " en cok alisveris", " en fazla harcayan", " top customer", " en iyi musterilerimiz", " en cok ziyaret"))
            return AssistantIntent.TopCustomers;
        if (Any(t, " yeni musteri", " yeni gelen musteri", " yeni kayit", " kayit olan musteri", " musteri kazandik", " new customer", " kac yeni"))
            return AssistantIntent.NewCustomers;

        // ── Personel / şube ──
        if (Any(t, " en cok calisan", " en yogun personel", " en cok randevu alan personel", " en iyi personel", " personel siralama", " busiest staff",
                " top staff", " personel performans", " personellerin performans", " calisan performans", " en cok ciro yapan", " en cok kazandiran",
                " prim", " komisyon", " hakedis", " personel raporu", " personellerin", " hangi personel", " en verimli"))
            return AssistantIntent.TopStaff;
        if (Any(t, " subeler", " sube karsilas", " hangi sube", " sube bazli", " subelerin", " subelerimiz", " sube performans", " branches", " her sube"))
            return AssistantIntent.Branches;

        // ── Finans ──
        if (Any(t, " geciken taksit", " geciken odeme", " vadesi gecen", " vadesi gecmis", " odenmemis taksit", " gecikmis taksit", " overdue", " gecikmede"))
            return AssistantIntent.OverdueInstallments;
        if (Any(t, " alacak", " borclu", " borcu olan", " borcu var", " borclar", " borclari", " tahsil edilmemis", " tahsil edilmeyen", " acik hesap",
                " veresiye", " kalan borc", " toplam borc", " musteri borc", " receivable", " debt", " odenmemis"))
            return AssistantIntent.Receivables;
        if (IsProfit(t)) return AssistantIntent.Profit;
        if (Any(t, " gider", " masraf", " harcama", " harcadik", " harcadim", " ne kadar harca", " expense", " fatura ode", " odedigimiz")
            && !Any(t, " gider mi", " gidiyor", " giderse", " giderim"))
            return AssistantIntent.Expenses;
        if (Any(t, " odeme yontem", " odeme tip", " odeme turu", " odeme sekl", " nakit", " kredi kart", " kartla", " kart ile", " havale", " eft ",
                " pos ", " payment method") && (hasPeriod || Any(t, " ne kadar", " kac ", " toplam", " dagilim", " gore")))
            return AssistantIntent.PaymentMethods;

        // ── Satış / hizmet sıralaması ──
        if (Any(t, " en cok satan", " en cok satilan", " en populer", " en cok yapilan", " en cok tercih", " en cok istenen", " en cok alinan",
                " en az satan", " en az satilan", " best seller", " best selling", " top service", " hizmet bazli", " paket bazli", " hangi hizmet", " hangi paket"))
            return Any(t, " urun") ? AssistantIntent.Inventory : AssistantIntent.TopServices;
        if (Any(t, " satis", " sattik", " sattim", " satilan", " satildi", " sales", " kac paket sat", " paket sat"))
            return AssistantIntent.Sales;
        if (IsRevenue(t)) return AssistantIntent.Revenue;

        // ── Stok ──
        if (Any(t, " kritik stok", " stokta azalan", " stogu azalan", " stogu biten", " stokta biten", " azalan urun", " biten urun", " low stock",
                " stogu kalmayan", " stokta kalmayan", " tukenen", " bitmek uzere"))
            return AssistantIntent.CriticalStock;
        if (Any(t, " stok degeri", " stok durumu", " stoklar", " stokta ne", " kac urun", " urun sayisi", " urun satis", " stoktaki urun",
                " depoda", " envanter", " inventory", " stock value", " urunlerimiz", " stok raporu"))
            return AssistantIntent.Inventory;

        // ── Randevu türevleri ──
        if (Any(t, " bekleme listesi", " bekleme listesinde", " sirada bekleyen", " waitlist"))
            return AssistantIntent.Waitlist;
        if (Any(t, " onay bekleyen", " onayda bekleyen", " onaylanmayi bekleyen", " taslaklarim", " taslak ", " taslaklar", " onaya dusen", " pending approval"))
            return AssistantIntent.PendingApprovals;
        if (Any(t, " yildiz puan", " puanim", " yildizim", " degerlendirmem", " musteri puanim", " my rating"))
            return AssistantIntent.MyRating;
        if (Any(t, " iptal edilen", " iptal olan", " iptaller", " kac iptal", " iptal sayi", " iptal edildi", " iptal edilmis", " iptal randevu",
                " randevu iptal", " cancelled", " cancellation", " iptal eden"))
            return AssistantIntent.Cancellations;
        if (Any(t, " gelmeyen musteri", " gelmeyenler", " randevuya gelmeyen", " no show", " gelmedi olarak", " randevusuna gelmeyen", " gelmeyen kim"))
            return AssistantIntent.NoShows;
        if (Any(t, " en yogun gun", " en yogun saat", " en yogun zaman", " yogun saat", " yogun gun", " hangi gun yogun", " hangi saat yogun",
                " en kalabalik", " busiest time", " busy hour", " yogunluk", " en sakin", " daha yogun", " yogun olan"))
            return AssistantIntent.BusiestTimes;
        if (Any(t, " bos saat", " musait saat", " bos yer", " bosluk var", " bos randevu", " free slot", " available slot", " musait personel", " bos personel"))
            return AssistantIntent.FreeSlots;
        if (Any(t, " kalan seans", " seansim kald", " seans kald", " kac seans", " seans hakk", " remaining session", " sessions left", " seanslarim"))
            return AssistantIntent.RemainingSessions;
        if (Any(t, " randevu gecmis", " gecmis randevu", " eski randevu", " onceki randevu", " appointment history", " gectigim randevu"))
            return AssistantIntent.AppointmentHistory;
        if (Any(t, " siradaki musteri", " sonraki musteri", " siradaki randevu", " sonraki randevu", " yaklasan randevu", " bir sonraki", " next customer",
                " next appointment", " upcoming", " siradaki kim"))
            return AssistantIntent.NextAppointment;
        if (Any(t, " bu hafta", " haftalik program", " haftaki program", " haftalik randevu", " this week") && (appointmentWord || Any(t, " program"))
            && !Any(t, " gecen hafta", " gelecek hafta"))
            return AssistantIntent.WeekSchedule;
        if (Any(t, " toplam musteri", " musteri sayi", " musterimiz var", " kac musterimiz", " musteri adedi", " how many customers", " vip musteri",
                " kara liste", " kac kayitli musteri", " musterilerimiz kac"))
            return AssistantIntent.CustomerCount;
        if (Any(t, " kac musteri") && !Any(t, " gel", " randevu"))
            return AssistantIntent.CustomerCount;
        if (appointmentWord || Any(t, " randevularim ", " kim gel", " kac kisi", " kimler gel", " kac musteri gel", " musteri geldi", " musteri gelecek",
                " programim", " program ", " ajanda", " takvim"))
        {
            if (hasPeriod || Any(t, " randevularim ", " kac randevu", " randevular ", " randevulari ", " randevu var", " kim gel", " kimler gel",
                    " kac kisi", " programim", " ajanda", " takvim"))
                return AssistantIntent.AppointmentsToday;
        }
        if (customerWord && hasPeriod && Any(t, " gel", " kac "))
            return AssistantIntent.AppointmentsToday;
        return AssistantIntent.Unknown;
    }

    private static bool IsActionRequest(string t) =>
        Any(t, " istiyorum", " istiyoruz", " istedim", " lazim", " gerekiyor", " alabilir", " yapabilir", " edebilir", " ekleyebilir", " girebilir",
            " gitsin", " olsun ", " eklemek", " eklemem", " girmek", " girmem", " onaylamak", " onaylamam", " olusturmak", " olusturmam", " ertelemek",
            " ertelemem", " iptal etmek", " iptal etmem", " dusmek", " dusmem", " kaydetmek", " kaydetmem", " ayirmak", " silmek", " silmem",
            " degistirmek", " degistirmem", " duzenlemek", " tanimlamak", " ayarlamak", " gondermek", " gondermem", " yazmak", " yazmam",
            " almak ", " vermek", " acmak", " kapatmak", " kapatmam", " yapmak ", " yapmam ", " islemek", " islemem", " atamak", " tasimak");

    private static bool IsQuery(string t) =>
        Any(t, " kac", " ne kadar", " toplam", " goster", " listele", " var mi", " kim", " hangi", " gormek", " ogrenmek", " bilmek", " nedir",
            " ne oldu", " durum", " rapor", " sayisi", " sayimiz", " how many", " how much", " show ");

    /// <summary>
    /// Gelir/ciro/kazanç/tahsilat. "gelir" aynı zamanda "gelmek" fiilidir: "yarın gelirim", "kaçta gelir",
    /// "gelir misiniz" GELİR SORUSU DEĞİLDİR.
    /// </summary>
    private static bool IsRevenue(string t)
    {
        if (Any(t, " ciro", " hasilat", " kazanc", " kazandik", " kazandim", " ne kadar kazan", " tahsilat", " revenue", " income", " kac para",
                " ne kadar para", " para girdi", " para gird", " kasaya gir", " kasada ne kadar", " kasada kac", " kasa ne kadar", " kasa durumu",
                " gunluk kasa", " gun sonu kasa", " kasamiz", " para kazan", " para yaptik", " para toplad", " tahsil ettik", " tahsil edilen", " earn"))
            return true;
        if (!Any(t, " gelir")) return false;
        if (Word(t, "gelirim", "gelirsin", "gelirse", "gelirken", "gelirmisin", "gelirmisiniz", "gelirdi", "gelirdin", "gelirlerse", "gelirsek", "gelirsiniz", "geliriz")
            || Any(t, " gelir mi", " gelir misin", " gelir misiniz", " gelirler mi", " gelir gelmez", " kacta gelir", " ne zaman gelir", " saat kacta",
                " gelir gibi", " gelir ise"))
            return false;
        return true;
    }

    private static bool IsProfit(string t) =>
        Word(t, "kar", "kari", "karimiz", "karimizi", "karim", "karin", "karda", "kardayiz", "karli", "kariniz", "kara", "kardan")
            && !Any(t, " kar yag", " kara liste", " kara para")
        || Any(t, " karlilik", " karliyiz", " zarar", " net kazanc", " net gelir", " net kar", " profit", " kar zarar", " kar ve zarar", " kar mi", " net ne kadar",
            " kac lira kar", " ne kadar kar", " kar ettik", " kar etti", " kazancimiz ne", " net durum");

    private static readonly string[] AdviceCues =
    [
        " oner", " tavsiye", " uygun mu", " uygun olur", " iyi gelir", " ne yapmaliyim", " ne kullanmaliyim", " hangi krem",
        " hangi islem", " hangisi daha iyi", " yaptirmali", " yaptirsam", " zararli mi", " guvenli mi", " recommend", " should i",
    ];

    private static readonly string[] BodyCues =
    [
        " cilt", " cildim", " cildime", " sac", " sacim", " sacima", " sivilce", " akne", " leke", " kirisik", " tedavi", " krem",
        " ilac", " alerji", " hamile", " lazer", " botoks", " dolgu", " epilasyon", " peeling", " bana", " skin", " hair", " acne",
    ];

    private static readonly string[] AppCues =
    [
        " nasil olustur", " nasil ekle", " nasil kaydet", " nasil gir", " nereden", " nerede", " ekran", " sayfa", " menu",
        " randevu ver", " randevu olustur", " randevusu", " hizmet ekle", " paket olustur", " tanimla",
    ];

    private static bool IsBeautyAdvice(string t) => Any(t, AdviceCues) && Any(t, BodyCues) && !Any(t, AppCues);

    private static bool IsHowTo(string t) =>
        Any(t, " nasil ", " nasil?", " nerede", " nereden", " nereye", " hangi sayfa", " hangi ekran", " how do", " how to", " how can", " where ")
        && !Any(t, " nasilsin", " nasilsiniz", " nasil gidiyor", " nasil gecti", " nasil gecmis", " durum nasil", " nasil bir ay", " nasil bir gun",
            " nasildi", " ciro nasil", " satislar nasil", " gelir nasil", " isler nasil");

    private static bool Any(string text, params string[] terms) => terms.Any(term => text.Contains(term, StringComparison.Ordinal));

    private static bool Word(string text, params string[] words) => words.Any(word => text.Contains($" {word} ", StringComparison.Ordinal));

    [GeneratedRegex(@"[^\p{L}\p{N}]+")]
    private static partial Regex NonWord();
}

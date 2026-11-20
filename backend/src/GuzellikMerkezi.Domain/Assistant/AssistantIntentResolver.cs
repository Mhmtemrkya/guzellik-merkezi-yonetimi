using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Domain.Assistant;

public enum AssistantPeriod { Today, Week, Month }

/// <param name="CorrectedText">Yazım düzeltmesiyle anlaşıldıysa düzeltilmiş (katlanmış) metin; değilse null.</param>
/// <param name="CorrectedTokens">Düzeltilen orijinal kelimeler — servis bunlardan kişi adı olanları geri alır.</param>
public sealed record AssistantParse(
    AssistantIntent Intent,
    string Folded,
    AssistantPeriod Period,
    string? CorrectedText = null,
    IReadOnlyList<string>? CorrectedTokens = null);

/// <summary>
/// Maydi'nin kural motoru. Sıra önemlidir: önce güzellik/sağlık tavsiyesi (hiç cevaplanmaz), sonra
/// "nasıl yapılır" (yardım kataloğu), sonra veri soruları, en son sohbet. Hiçbir kural tutmazsa — ve yalnız
/// o zaman — yazım düzeltmesi denenir (bkz. <see cref="AssistantSpelling"/>); kişi adları korunur.
/// Kural motoru yalnız katlanmış metinle çalışır ve hiçbir veri dışarı gitmez.
/// </summary>
public static partial class AssistantIntentResolver
{
    public static AssistantParse Resolve(string message, IReadOnlySet<string>? keepWords = null)
    {
        var folded = AssistantText.Fold(AssistantText.WithoutName(message ?? string.Empty));
        var text = Pad(folded);
        var intent = ResolveIntent(text);
        if (intent != AssistantIntent.Unknown) return new AssistantParse(intent, folded, PeriodOf(text));

        var corrected = AssistantSpelling.Correct(folded, keepWords);
        if (!corrected.Changed) return new AssistantParse(AssistantIntent.Unknown, folded, PeriodOf(text));
        var fixedText = Pad(corrected.Text);
        var fixedIntent = ResolveIntent(fixedText);
        return fixedIntent == AssistantIntent.Unknown
            ? new AssistantParse(AssistantIntent.Unknown, folded, PeriodOf(text), corrected.Text, corrected.ChangedTokens)
            : new AssistantParse(fixedIntent, folded, PeriodOf(fixedText), corrected.Text, corrected.ChangedTokens);
    }

    /// <summary>Kelime sınırlarıyla karşılaştırmak için metin baştan/sondan boşlukla doldurulur, noktalama boşluğa çevrilir.</summary>
    private static string Pad(string folded) => $" {NonWord().Replace(folded, " ").Trim()} ";

    private static AssistantIntent ResolveIntent(string t)
    {
        if (t.Trim().Length == 0) return AssistantIntent.Unknown;

        // ── Tavsiye EN ÖNDE: "lazer bana uygun mu" bir veri ya da kullanım sorusu değildir. ──
        // Kullanım sorusu ("lazer randevusu nasıl oluşturulur") tavsiye sayılmaz.
        if (IsBeautyAdvice(t)) return AssistantIntent.BeautyAdvice;

        // ── Yetenek / yardım ──
        if (Any(t, " neler yapabilir", " ne yapabilirsin", " ne ise yarar", " komutlar", " neler sorabilirim", " ne sorabilirim", " yardim eder misin", " what can you do"))
            return AssistantIntent.Help;

        // ── Nasıl yapılır / nerede (veri sorusu kalıplarından önce: "taksit nasıl girilir" bir yardım sorusudur) ──
        if (IsHowTo(t)) return AssistantIntent.HowTo;

        // ── Veri soruları ──
        var appointmentWord = Any(t, " randevu", " musteri", " appointment");
        if (Any(t, " ciro", " kazanc", " hasilat", " gelir ", " gelirimiz", " revenue", " kac para", " ne kadar kazan", " tahsilat toplam", " toplam tahsilat"))
            return AssistantIntent.Revenue;
        if (Any(t, " geciken taksit", " geciken odeme", " vadesi gecen", " odenmemis taksit", " gecikmis taksit", " overdue"))
            return AssistantIntent.OverdueInstallments;
        if (Any(t, " kritik stok", " stokta azalan", " stogu azalan", " stogu biten", " stokta biten", " azalan urun", " biten urun", " low stock"))
            return AssistantIntent.CriticalStock;
        if (Any(t, " bekleme listesi", " bekleme listesinde", " sirada bekleyen", " waitlist"))
            return AssistantIntent.Waitlist;
        if (Any(t, " onay bekleyen", " onayda bekleyen", " onaylanmayi bekleyen", " taslaklarim", " taslak ", " taslaklar", " onaya dusen", " pending approval"))
            return AssistantIntent.PendingApprovals;
        if (Any(t, " yildiz puan", " puanim", " yildizim", " degerlendirmem", " musteri puanim", " my rating"))
            return AssistantIntent.MyRating;
        if (Any(t, " en cok calisan", " en yogun personel", " en cok randevu alan personel", " en iyi personel", " personel siralama", " busiest staff", " top staff"))
            return AssistantIntent.TopStaff;
        if (Any(t, " gelmeyen musteri", " gelmeyenler", " randevuya gelmeyen", " no show", " gelmedi olarak"))
            return AssistantIntent.NoShows;
        if (Any(t, " bos saat", " musait saat", " bos yer", " bosluk var", " bos randevu", " free slot", " available slot"))
            return AssistantIntent.FreeSlots;
        if (Any(t, " kalan seans", " seansim kald", " seans kald", " kac seans", " seans hakk", " remaining session", " sessions left"))
            return AssistantIntent.RemainingSessions;
        if (Any(t, " randevu gecmis", " gecmis randevu", " eski randevu", " onceki randevu", " appointment history"))
            return AssistantIntent.AppointmentHistory;
        if (Any(t, " siradaki musteri", " sonraki musteri", " siradaki randevu", " sonraki randevu", " yaklasan randevu", " bir sonraki", " next customer", " next appointment", " upcoming"))
            return AssistantIntent.NextAppointment;
        if (Any(t, " bu hafta", " haftalik program", " haftaki program", " haftalik randevu", " this week") && (appointmentWord || Any(t, " program")))
            return AssistantIntent.WeekSchedule;
        if ((Any(t, " bugun", " bugunku", " today") && (appointmentWord || Any(t, " program", " kim gel", " kac kisi")))
            || Any(t, " randevularim ", " randevularim?", " kac randevu"))
            return AssistantIntent.AppointmentsToday;

        // ── Sohbet (en son: "Merhaba, bugünkü randevularım" bir veri sorusudur) ──
        if (Any(t, " tesekkur", " sagol", " eyvallah", " thank", " eline saglik", " cok yardimci"))
            return AssistantIntent.Thanks;
        if (Any(t, " merhaba", " selam", " gunaydin", " iyi aksamlar", " iyi gunler", " hello ", " hi ", " hey "))
            return AssistantIntent.Greeting;
        if (Any(t, " nasilsin", " naber", " sen kimsin", " kimsin", " adin ne", " ismin ne", " bot musun", " robot musun", " who are you", " how are you"))
            return AssistantIntent.SmallTalk;

        return AssistantIntent.Unknown;
    }

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
        && !Any(t, " nasilsin", " nasilsiniz", " nasil gidiyor");

    private static AssistantPeriod PeriodOf(string t) =>
        Any(t, " bu ay", " aylik", " this month") ? AssistantPeriod.Month
        : Any(t, " bu hafta", " haftalik", " this week") ? AssistantPeriod.Week
        : AssistantPeriod.Today;

    private static bool Any(string text, params string[] terms) => terms.Any(term => text.Contains(term, StringComparison.Ordinal));

    [GeneratedRegex(@"[^\p{L}\p{N}]+")]
    private static partial Regex NonWord();
}

using System.Text;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Müşterinin WhatsApp yanıtından NİYET çıkarır: onay, iptal, erteleme ya da anlaşılamadı.
///
/// <para>
/// <b>Neden kelime listesi yetmiyordu:</b> müşteriler şablondaki EVET/HAYIR/ERTELE yerine doğal cümle yazar
/// ("Hayır, geleceğim", "Evet ama gelemeyeceğim", "başka gün olur mu", "tmm 👍"). Eski motor ilk tutan kelimeye
/// bakıyordu; "Hayır, geleceğim" İPTAL sayılıp randevu iptal ediliyordu.
/// </para>
///
/// <para>
/// <b>Kural sırası (güçlüden zayıfa):</b>
/// <list type="number">
/// <item>Menü yanıtları: 1/e = onay, 2/h = iptal, 3 = erteleme.</item>
/// <item>Erteleme ifadesi (ertele…, başka gün/saat, değiştir…, ileri/sonraya al…) — erteleme isteyen müşteri
/// "gelemem" de diyebilir; randevu iptal edilmez, yöneticiye erteleme bildirimi gider.</item>
/// <item>GÜÇLÜ işaretler — FİİL BİÇİMİ: olumsuz (gelemeyeceğim, gelmiyorum, katılamam, iptal, vazgeçtim) /
/// olumlu (geleceğim, geliyorum, gelirim, katılacağım, onaylıyorum). Fiil, evet/hayır kelimesinden üstündür:
/// "Hayır, geleceğim" = onay; "Evet, gelemeyeceğim" = iptal.</item>
/// <item>ZAYIF işaretler: evet/tamam/olur/👍 — hayır/olmaz/❌.</item>
/// </list>
/// Aynı katmanda iki yön birden varsa yanıt <see cref="WhatsAppReplyIntent.Unknown"/> döner: tahmin edip randevu
/// iptal etmek yerine yöneticiye "kontrol bekliyor" bildirimi gider.
/// </para>
/// </summary>
public static class WhatsAppReplyInterpreter
{
    // Olumsuz fiil biçimleri (gel-, katıl-, yetiş-, onayla-): ön ek eşleşmesi.
    private static readonly string[] StrongCancelPrefixes =
    [
        // "gelmiyo" = gelmiyorum + gündelik "gelmiyom"; "gelemiy" = gelemiyorum + "gelemiyom".
        "gelemey", "gelemiy", "gelemic", "gelemez", "gelmeyece", "gelmeyec", "gelmiyo", "gelmiyc", "gelmic",
        "katilamay", "katilamiy", "katilamic", "katilmayaca", "katilmiyor",
        "yetisemey", "yetisemiy", "yetisemic", "onaylamay", "onaylamiy", "onaylamic",
        "vazgec", "istemiyor",
    ];

    private static readonly HashSet<string> StrongCancelWords =
        ["gelemem", "gelmem", "gelemeyiz", "gelmeyiz", "katilamam", "katilmam", "yetisemem"];

    // Olumlu fiil biçimleri. "onaylam…" (olumsuz) ayrıca dışlanır.
    // Gündelik yazımlar dahil: "gelcem/gelcez", "gelicez", "geliyom/geliom", "gelebilirim".
    private static readonly string[] StrongConfirmPrefixes =
        ["gelece", "gelicem", "gelicez", "gelcem", "gelcez", "gelirim", "geliriz", "geliyo", "gelio", "gelebil",
         "katilaca", "katiliyor", "katilirim", "onay", "teyit"];

    private static readonly HashSet<string> StrongConfirmWords = ["geldim", "geldik", "oradayim", "oradayiz"];

    // Erteleme: zaman kelimesi + değiştirme fiili birlikteyse ("saatini değiştirelim", "günü kaydıralım", "başka
    // saate alalım"). Tek başına "saat kaçtaydı?" erteleme değildir (fiil yok).
    private static readonly string[] TimeNounPrefixes = ["saat", "gun", "tarih", "zaman", "hafta"];
    private static readonly string[] ProposalCuePrefixes =
        ["gelsem", "gelsek", "gelebil", "gelelim", "olur", "olsun", "uygun", "musait", "alabil", "alal", "yapabil", "yapal", "nasil"];
    private static readonly string[] ChangeVerbPrefixes = ["al", "degis", "kayd", "tasi", "cek"];

    private static readonly HashSet<string> WeakCancelWords = ["hayir", "hayr", "hyr", "olmaz", "maalesef"];

    private static readonly HashSet<string> WeakConfirmWords =
        ["evet", "evt", "eet", "evvet", "tamam", "tamamdir", "tmm", "tm", "ok", "okey", "okay", "olur", "uygun",
         "tabi", "tabii", "elbette", "kesinlikle", "peki", "aynen"];

    // "iptal etmeyin" = iptal ETME; "iptal etmek istiyorum" = iptal et.
    private static readonly HashSet<string> NegatorsAfterIptal = ["etme", "etmeyin", "etmeyiniz", "olmasin", "edilmesin"];

    private static readonly string[] ConfirmSymbols = ["👍", "✅", "👌", "✔", "☑"];
    private static readonly string[] CancelSymbols = ["👎", "❌", "🚫", "✖"];

    public static WhatsAppReplyIntent Interpret(string? text)
    {
        var raw = text ?? string.Empty;
        var normalized = Normalize(raw);
        var tokens = Regex.Split(normalized, "[^a-z0-9]+").Where(t => t.Length > 0).ToArray();
        var hasConfirmSymbol = ConfirmSymbols.Any(s => raw.Contains(s, StringComparison.Ordinal));
        var hasCancelSymbol = CancelSymbols.Any(s => raw.Contains(s, StringComparison.Ordinal));
        if (tokens.Length == 0 && !hasConfirmSymbol && !hasCancelSymbol) return WhatsAppReplyIntent.Unknown;

        // 1) Menü yanıtları (tek başına).
        var whole = string.Join(' ', tokens);
        if (whole is "1" or "e") return WhatsAppReplyIntent.Confirm;
        if (whole is "2" or "h") return WhatsAppReplyIntent.Cancel;
        if (whole is "3") return WhatsAppReplyIntent.Reschedule;

        // 2) Erteleme.
        if (IsReschedule(tokens)) return WhatsAppReplyIntent.Reschedule;

        // 2b) ZAMAN ÖNERİSİ: "Cuma 15:00te gelsem olur mu", "yarın saat 3 uygun mu" — tarih/saat + öneri işareti.
        //     "Yarın 14:00te geleceğim" öneri değil onaydır (işaret yok).
        if (tokens.Any(t => ProposalCuePrefixes.Any(p => t.StartsWith(p, StringComparison.Ordinal))) && WhatsAppTimeProposalParser.HasProposal(raw))
            return WhatsAppReplyIntent.Reschedule;

        // 3) Güçlü işaretler: fiil biçimi + açık iptal.
        var strongCancel = tokens.Any(t => StrongCancelWords.Contains(t) || StrongCancelPrefixes.Any(p => t.StartsWith(p, StringComparison.Ordinal)))
                           || HasPositiveIptal(tokens)
                           // "müsait değilim" / "müsait olamayacağım" = gelemeyeceğim
                           || ContainsPhrase(tokens, "musait", "degil") || ContainsPhrase(tokens, "musait", "olamay")
                           || ContainsPhrase(tokens, "musait", "olmayaca");
        var strongConfirm = tokens.Any(t => StrongConfirmWords.Contains(t)
                                            || (StrongConfirmPrefixes.Any(p => t.StartsWith(p, StringComparison.Ordinal))
                                                && !t.StartsWith("onaylam", StringComparison.Ordinal)))
                            || ContainsPhrase(tokens, "orada", "olaca");
        if (strongCancel != strongConfirm) return strongCancel ? WhatsAppReplyIntent.Cancel : WhatsAppReplyIntent.Confirm;
        if (strongCancel) return WhatsAppReplyIntent.Unknown; // ikisi birden: tahmin etme

        // 4) Zayıf işaretler.
        var sorunYok = ContainsPhrase(tokens, "sorun", "yok") || ContainsPhrase(tokens, "problem", "yok");
        var weakCancel = hasCancelSymbol
                         || tokens.Any(WeakCancelWords.Contains)
                         || (!sorunYok && whole is "yok" or "yok ya" or "yok maalesef" or "maalesef yok");
        var weakConfirm = hasConfirmSymbol
                          || sorunYok
                          || tokens.Where((t, i) => WeakConfirmWords.Contains(t) && !(t == "olur" && IsQuestionParticle(tokens, i + 1))).Any();
        if (weakCancel != weakConfirm) return weakCancel ? WhatsAppReplyIntent.Cancel : WhatsAppReplyIntent.Confirm;
        return WhatsAppReplyIntent.Unknown;
    }

    /// <summary>Türkçe harfleri sadeleştirir, küçültür, 3+ tekrar eden harfi teke indirir ("evettt" → "evet").</summary>
    public static string Normalize(string? text)
    {
        var s = (text ?? string.Empty).Trim().Replace('İ', 'i').Replace('I', 'i').Replace('ı', 'i').ToLowerInvariant();
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            switch (ch)
            {
                case 'ı': sb.Append('i'); break;
                case 'ş': sb.Append('s'); break;
                case 'ğ': sb.Append('g'); break;
                case 'ü': sb.Append('u'); break;
                case 'ö': sb.Append('o'); break;
                case 'ç': sb.Append('c'); break;
                case 'â': sb.Append('a'); break;
                case 'î': sb.Append('i'); break;
                case 'û': sb.Append('u'); break;
                case '̇': break; // birleşik nokta (İ'nin küçültülmüş artığı)
                default: sb.Append(ch); break;
            }
        }
        return Regex.Replace(sb.ToString(), "(.)\\1{2,}", "$1");
    }

    private static bool IsReschedule(string[] tokens)
    {
        // Zaman kelimesi + değiştirme fiili ("saatini değiştirebilir miyiz", "günü kaydıralım", "başka saate alalım").
        var hasTimeNoun = tokens.Any(t => TimeNounPrefixes.Any(p => t.StartsWith(p, StringComparison.Ordinal)));
        var hasChangeVerb = tokens.Any(t => ChangeVerbPrefixes.Any(p => t.StartsWith(p, StringComparison.Ordinal)));
        if (hasTimeNoun && hasChangeVerb) return true;

        for (var i = 0; i < tokens.Length; i++)
        {
            var t = tokens[i];
            if (t.StartsWith("ertele", StringComparison.Ordinal) || t.StartsWith("degistir", StringComparison.Ordinal)
                || t.StartsWith("degisik", StringComparison.Ordinal) || t.StartsWith("kaydir", StringComparison.Ordinal))
                return true;

            var next = i + 1 < tokens.Length ? tokens[i + 1] : string.Empty;
            // "başka gün / saat / zaman / tarih / bir gün"
            if (t == "baska" && (next.StartsWith("gun", StringComparison.Ordinal) || next.StartsWith("saat", StringComparison.Ordinal)
                                 || next.StartsWith("zaman", StringComparison.Ordinal) || next.StartsWith("tarih", StringComparison.Ordinal)
                                 || next == "bir"))
                return true;
            // "ileri / ileriye / sonraya / haftaya / yarına / öne / erkene al…"
            if (t is "ileri" or "ileriye" or "sonraya" or "haftaya" or "yarina" or "one" or "erkene"
                && next.StartsWith("al", StringComparison.Ordinal))
                return true;
            // "gelecek hafta / ay / sefer" = önümüzdeki hafta (gelmek fiili DEĞİL; onay sanılmasın)
            if (t == "gelecek" && (next.StartsWith("hafta", StringComparison.Ordinal) || next is "ay" or "aya"
                                   || next.StartsWith("sefer", StringComparison.Ordinal)))
                return true;
            // "ileri bir tarihe", "sonraki bir güne / haftaya"
            if (t is "ileri" or "ileriki" or "sonraki" or "baska"
                && (next == "bir" || next.StartsWith("tarih", StringComparison.Ordinal) || next.StartsWith("gun", StringComparison.Ordinal)
                    || next.StartsWith("hafta", StringComparison.Ordinal) || next.StartsWith("sefer", StringComparison.Ordinal)))
                return true;
        }
        return false;
    }

    /// <summary>"iptal" geçiyor ve hemen ardından olumsuzlayan bir fiil ("iptal etmeyin") gelmiyor.</summary>
    private static bool HasPositiveIptal(string[] tokens)
    {
        for (var i = 0; i < tokens.Length; i++)
        {
            if (!tokens[i].StartsWith("iptal", StringComparison.Ordinal)) continue;
            var next = i + 1 < tokens.Length ? tokens[i + 1] : string.Empty;
            if (!NegatorsAfterIptal.Contains(next)) return true;
        }
        return false;
    }

    private static bool ContainsPhrase(string[] tokens, string first, string secondPrefix)
    {
        for (var i = 0; i + 1 < tokens.Length; i++)
            if (tokens[i] == first && tokens[i + 1].StartsWith(secondPrefix, StringComparison.Ordinal)) return true;
        return false;
    }

    private static bool IsQuestionParticle(string[] tokens, int index) =>
        index < tokens.Length && tokens[index] is "mu" or "mi" or "mi?" or "mu?";
}

using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>Müşterinin yanıtında geçen tarih ve/veya saat (ikisi de opsiyonel; en az biri doluysa öneri vardır).</summary>
public readonly record struct TimeProposal(DateOnly? Date, TimeOnly? Time)
{
    public bool IsEmpty => Date is null && Time is null;
}

/// <summary>
/// Müşterinin "Cuma 15:00'te gelsem olur mu?", "yarın saat 3 uygun mu", "21 Kasım 14.30", "haftaya salı öğleden
/// sonra 2" gibi yanıtlarından ÖNERİLEN zamanı çıkarır (Türkiye yerel saati).
///
/// <para>
/// Kurallar: iki nokta üst üste her zaman saattir (15:00); noktalı ifade "saat" ile ya da -de/-da/-te/-ta ekiyle
/// geliyorsa ya da ikinci kısım 12'den büyükse saattir (14.30), aksi hâlde gün.ay tarihidir (21.11). "Saat 3",
/// "3'te" gibi 1–7 arası saatler salon saatinde öğleden sonra sayılır (15:00); "sabah" bunu engeller,
/// "öğleden sonra / akşam" zorlar. Tarih bugünden önceyse bir sonraki yıla, gün adı bir sonraki o güne gider.
/// </para>
/// </summary>
public static class WhatsAppTimeProposalParser
{
    private static readonly string[] Months =
        ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];

    // Sıra önemli: "cumartesi" "cuma"dan, "pazartesi" "pazar"dan önce denenir.
    private static readonly (string Name, DayOfWeek Day)[] Weekdays =
    [
        ("pazartesi", DayOfWeek.Monday), ("cumartesi", DayOfWeek.Saturday), ("sali", DayOfWeek.Tuesday),
        ("carsamba", DayOfWeek.Wednesday), ("persembe", DayOfWeek.Thursday), ("cuma", DayOfWeek.Friday),
        ("pazar", DayOfWeek.Sunday),
    ];

    /// <summary>Metinde tarih ya da saat önerisi var mı (niyet motoru için; "şimdi"ye bağlı değil).</summary>
    public static bool HasProposal(string? text) => !Parse(text, new DateTime(2026, 1, 5, 12, 0, 0)).IsEmpty;

    /// <param name="nowLocal">Türkiye yerel "şimdi" (göreli ifadeler — yarın, cuma — buna göre çözülür).</param>
    public static TimeProposal Parse(string? text, DateTime nowLocal)
    {
        var s = WhatsAppReplyInterpreter.Normalize(text).Replace('’', '\'');
        if (s.Length == 0) return default;
        var today = DateOnly.FromDateTime(nowLocal);

        DateOnly? date = null;
        TimeOnly? time = null;
        string? dottedTimeText = null;

        // ---- SAAT ----
        var colon = Regex.Match(s, @"\b([01]?\d|2[0-3]):([0-5]\d)\b");
        if (colon.Success) time = new TimeOnly(int.Parse(colon.Groups[1].Value), int.Parse(colon.Groups[2].Value));

        // "saat 3", "saat 15.30", "saat 3 bucuk"
        if (time is null)
        {
            var saat = Regex.Match(s, @"\bsaat\s+([01]?\d|2[0-3])(?:[.:]([0-5]\d))?(\s+bucuk)?");
            if (saat.Success)
                time = new TimeOnly(int.Parse(saat.Groups[1].Value),
                    saat.Groups[2].Success ? int.Parse(saat.Groups[2].Value) : saat.Groups[3].Success ? 30 : 0);
        }

        // "14.30'da", "14.30" (dakika > 12 ise kesin saat), "3'te", "15te", "3 bucukta"
        if (time is null)
        {
            var dotted = Regex.Match(s, @"\b([01]?\d|2[0-3])\.([0-5]\d)\s*'?\s*(?:de|da|te|ta)\b");
            if (!dotted.Success)
            {
                var plain = Regex.Match(s, @"\b([01]?\d|2[0-3])\.([0-5]\d)\b");
                if (plain.Success && int.Parse(plain.Groups[2].Value) > 12) dotted = plain;
            }
            if (dotted.Success)
            {
                time = new TimeOnly(int.Parse(dotted.Groups[1].Value), int.Parse(dotted.Groups[2].Value));
                dottedTimeText = dotted.Groups[1].Value + "." + dotted.Groups[2].Value;
            }
        }
        if (time is null)
        {
            // "öğleden sonra 2", "akşam 6", "sabah 10.30"
            var part = Regex.Match(s, @"\b(?:sabah|ogleden sonra|aksam|aksamustu|ogle|oglen)\s+(?:saat\s+)?([01]?\d|2[0-3])(?:[.:]([0-5]\d))?\b");
            if (part.Success)
                time = new TimeOnly(int.Parse(part.Groups[1].Value), part.Groups[2].Success ? int.Parse(part.Groups[2].Value) : 0);
        }
        if (time is null)
        {
            var suffix = Regex.Match(s, @"\b([01]?\d|2[0-3])(\s+bucuk)?\s*'?\s*(?:te|ta|de|da)\b");
            if (suffix.Success) time = new TimeOnly(int.Parse(suffix.Groups[1].Value), suffix.Groups[2].Success ? 30 : 0);
        }

        var afternoon = Regex.IsMatch(s, @"\b(ogleden sonra|ogleden|aksam|aksamustu|ikindi)\b");
        var morning = Regex.IsMatch(s, @"\bsabah");
        if (time is null && Regex.IsMatch(s, @"\b(ogle|oglen|ogleyin|ogle vakti)\b") && !afternoon)
            time = new TimeOnly(12, 0);
        if (time is { } t)
        {
            // Salon saati: 1–7 arası saat öğleden sonradır ("saat 3" = 15:00), "sabah" yazmadıkça.
            if (t.Hour < 12 && (afternoon || (!morning && t.Hour is >= 1 and <= 7)))
                time = new TimeOnly(t.Hour + 12, t.Minute);
        }

        // ---- TARİH ----
        if (Regex.IsMatch(s, @"\b(obur gun|obur gune|ertesi gun|yarindan sonra)\b")) date = today.AddDays(2);
        else if (Regex.IsMatch(s, @"\byarin")) date = today.AddDays(1);
        else if (Regex.IsMatch(s, @"\bbugun")) date = today;

        if (date is null)
        {
            // "21 kasim", "21 kasimda"
            var named = Regex.Match(s, @"\b([0-2]?\d|3[01])\s+(" + string.Join('|', Months) + ")");
            if (named.Success)
                date = SafeDate(today, int.Parse(named.Groups[1].Value), Array.IndexOf(Months, named.Groups[2].Value) + 1, null);
        }
        if (date is null)
        {
            // "21.11", "21/11", "21.11.2026" — saat olarak okunmuş kısımla çakışmasın
            foreach (Match m in Regex.Matches(s, @"\b([0-2]?\d|3[01])[./]([01]?\d)(?:[./](\d{2,4}))?\b"))
            {
                var month = int.Parse(m.Groups[2].Value);
                if (month is < 1 or > 12) continue;
                if (m.Value == dottedTimeText) continue; // saat olarak okundu
                int? year = m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : null;
                if (year is < 100) year += 2000;
                date = SafeDate(today, int.Parse(m.Groups[1].Value), month, year);
                if (date is not null) break;
            }
        }
        if (date is null)
        {
            // "ayin 21i"
            var ayin = Regex.Match(s, @"\bayin\s+([0-2]?\d|3[01])");
            if (ayin.Success) date = SafeDate(today, int.Parse(ayin.Groups[1].Value), today.Month, null);
        }
        if (date is null)
        {
            foreach (var (name, day) in Weekdays)
            {
                if (!Regex.IsMatch(s, @"\b" + name)) continue;
                var diff = ((int)day - (int)today.DayOfWeek + 7) % 7;
                if (diff == 0) diff = 7; // bugünün adını söylüyorsa gelecek haftaki o gün
                var d = today.AddDays(diff);
                // "haftaya salı": bu haftanın içine düşüyorsa bir hafta sonrası
                if (Regex.IsMatch(s, @"\b(haftaya|gelecek hafta|onumuzdeki hafta)") && DaysUntilSunday(today) >= diff) d = d.AddDays(7);
                date = d;
                break;
            }
        }

        return new TimeProposal(date, time);
    }

    private static int DaysUntilSunday(DateOnly today) => ((int)DayOfWeek.Sunday - (int)today.DayOfWeek + 7) % 7;

    private static DateOnly? SafeDate(DateOnly today, int day, int month, int? year)
    {
        var y = year ?? today.Year;
        if (day < 1 || day > DateTime.DaysInMonth(y, month)) return null;
        var d = new DateOnly(y, month, day);
        if (year is null && d < today) d = d.AddYears(1);
        return d;
    }
}

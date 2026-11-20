using System.Globalization;
using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Domain.Assistant;

/// <summary>
/// Soruda geçen dönem (Türkiye yerel saati). <see cref="From"/> dahil, <see cref="To"/> hariç: [From, To).
/// <see cref="Name"/> "Bugün", "Geçen ay" gibi göreli ad; <see cref="Span"/> açık tarih aralığı ("1–31 Ekim 2026").
/// Cevaplarda ikisi birlikte yazılır ki yanlış anlaşılan bir dönem kullanıcıya hemen görünsün.
/// </summary>
public sealed record AssistantDateRange(DateTime From, DateTime To, string Name, string NameEn, string Span, string SpanEn)
{
    public bool SingleDay => (To - From).TotalDays <= 1;

    /// <summary>"Geçen ay (1–31 Ekim 2026)"; ad zaten tarihse ("Ocak 2026") ya da bugün/dün/yarınsa yalnız ad.</summary>
    public string Title => Name == Span || Name is "Bugün" or "Dün" or "Yarın" or "Bugüne kadar" ? Name : $"{Name} ({Span})";
    public string TitleEn => NameEn == SpanEn || NameEn is "Today" or "Yesterday" or "Tomorrow" or "All time" ? NameEn : $"{NameEn} ({SpanEn})";

    /// <summary>Aynı uzunlukta bir önceki dönem (karşılaştırma için). Ay ve yıl takvimle kayar.</summary>
    public (DateTime From, DateTime To) Previous()
    {
        if (From.Day == 1 && To.Day == 1 && From.Month == 1 && To.Month == 1 && To.Year - From.Year >= 1)
            return (From.AddYears(-(To.Year - From.Year)), From);
        if (From.Day == 1 && To.Day == 1)
        {
            var months = (To.Year - From.Year) * 12 + To.Month - From.Month;
            if (months >= 1) return (From.AddMonths(-months), From);
        }
        return (From - (To - From), From);
    }
}

/// <summary>
/// Türkçe (ve basit İngilizce) dönem ifadelerini tarih aralığına çevirir. Katlanmış metinle çalışır
/// (<see cref="AssistantText.Fold"/>): "bugün", "dün", "yarın", "bu/geçen/gelecek hafta", "bu/geçen/gelecek ay",
/// ay adları ("ocak", "ocak 2026", "ocaktan marta"), "15 ocak", "15.01.2026", yıl ("2025", "bu yıl", "geçen sene",
/// "yılbaşından beri") ve "son 7 gün / son 3 ay". Hiçbiri yoksa null — varsayılanı niyet seçer.
/// </summary>
public static partial class AssistantDateParser
{
    private static readonly CultureInfo Tr = new("tr-TR");
    private static readonly CultureInfo En = CultureInfo.InvariantCulture;

    private static readonly string[] Months =
        ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
    private static readonly string[] MonthsEn =
        ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

    private static readonly Dictionary<string, int> Numbers = new(StringComparer.Ordinal)
    {
        ["bir"] = 1, ["iki"] = 2, ["uc"] = 3, ["dort"] = 4, ["bes"] = 5, ["alti"] = 6, ["yedi"] = 7, ["sekiz"] = 8,
        ["dokuz"] = 9, ["on"] = 10, ["onbes"] = 15, ["yirmi"] = 20, ["otuz"] = 30, ["kirk"] = 40, ["altmis"] = 60, ["doksan"] = 90,
    };

    /// <param name="folded">Katlanmış soru.</param>
    /// <param name="nowLocal">Türkiye yerel "şimdi".</param>
    /// <param name="preferFuture">
    /// Yılı yazılmamış bir ay/gün için hangi yıl: false (ciro, gider gibi geçmişe bakan sorular) → içinde
    /// bulunulan aydan SONRAKİ bir ay geçen yıla aittir ("ocak" Kasım'da Ocak bu yıl, "aralık" geçen Aralık);
    /// true (randevu gibi ileriye de bakan sorular) → hep bu yıl.
    /// </param>
    public static AssistantDateRange? Parse(string folded, DateTime nowLocal, bool preferFuture = false)
    {
        if (string.IsNullOrWhiteSpace(folded)) return null;
        var today = nowLocal.Date;
        var tokens = Tokens().Matches(folded).Select(m => m.Value).ToArray();
        var text = " " + string.Join(' ', tokens) + " ";

        if (Has(text, " bugune kadar", " simdiye kadar", " tum zaman", " basindan beri", " all time", " ever "))
            return Make(new DateTime(2000, 1, 1), today.AddDays(1), "Bugüne kadar", "All time");

        return Last(tokens, today)
            ?? NumericDate(folded, today, preferFuture)
            ?? MonthExpression(tokens, today, preferFuture)
            ?? Relative(text, today)
            ?? Weekday(tokens, today, preferFuture)
            ?? Year(tokens, text, today);
    }

    // ── Gün adları: "cuma", "geçen salı", "gelecek pazartesi", "cumartesi günü" ──

    private static readonly (string Name, DayOfWeek Day, string Tr)[] Weekdays =
    [
        ("pazartesi", DayOfWeek.Monday, "Pazartesi"), ("cumartesi", DayOfWeek.Saturday, "Cumartesi"),
        ("sali", DayOfWeek.Tuesday, "Salı"), ("carsamba", DayOfWeek.Wednesday, "Çarşamba"), ("persembe", DayOfWeek.Thursday, "Perşembe"),
        ("cuma", DayOfWeek.Friday, "Cuma"), ("pazar", DayOfWeek.Sunday, "Pazar"),
    ];

    private static AssistantDateRange? Weekday(string[] tokens, DateTime today, bool preferFuture)
    {
        for (var i = 0; i < tokens.Length; i++)
        {
            foreach (var (name, day, tr) in Weekdays)
            {
                var token = tokens[i];
                if (!token.StartsWith(name, StringComparison.Ordinal) || !WeekdaySuffix(token[name.Length..])) continue;
                var before = i > 0 ? tokens[i - 1] : string.Empty;
                var back = (((int)today.DayOfWeek - (int)day) % 7 + 7) % 7;      // en yakın geçmiş (bugün dahil)
                var ahead = (((int)day - (int)today.DayOfWeek) % 7 + 7) % 7;     // en yakın gelecek (bugün dahil)
                DateTime date;
                if (before is "gecen" or "onceki" or "gectigimiz") date = today.AddDays(back == 0 ? -7 : -back);
                else if (before is "gelecek" or "onumuzdeki" or "haftaya") date = today.AddDays(ahead == 0 ? 7 : ahead);
                else if (before == "bu") date = today.AddDays(-(((int)today.DayOfWeek + 6) % 7) + (((int)day + 6) % 7));
                else date = preferFuture ? today.AddDays(ahead) : today.AddDays(-back);
                var range = Day(date, today);
                return range.Name == range.Span ? Make(date, date.AddDays(1), tr, day.ToString()) : range;
            }
        }
        return null;
    }

    private static bool WeekdaySuffix(string suffix) => suffix is
        "" or "gunu" or "gunku" or "gunun" or "ya" or "ye" or "yi" or "nin" or "ki" or "da" or "de" or "dan" or "den"
        or "a" or "e" or "i" or "u" or "daki" or "deki" or "ya kadar" or "si" or "sini" or "sinin";

    // ── "son 7 gün", "son bir hafta", "son 3 ay", "son 2 yıl" ───────────────

    private static AssistantDateRange? Last(string[] tokens, DateTime today)
    {
        for (var i = 0; i + 1 < tokens.Length; i++)
        {
            if (tokens[i] is not ("son" or "last" or "gecen" or "gectigimiz")) continue;
            var count = 1;
            var unitIndex = i + 1;
            if (int.TryParse(tokens[i + 1], out var n)) { count = n; unitIndex = i + 2; }
            else if (Numbers.TryGetValue(tokens[i + 1], out var w)) { count = w; unitIndex = i + 2; }
            else if (tokens[i] != "son" && tokens[i] != "last") continue; // "geçen ay" göreli ifadedir, burada değil
            if (unitIndex >= tokens.Length || count is < 1 or > 3660) continue;
            var unit = tokens[unitIndex];
            var end = today.AddDays(1);
            DateTime start;
            string name, nameEn;
            if (unit.StartsWith("gun", StringComparison.Ordinal) || unit.StartsWith("day", StringComparison.Ordinal))
            { start = end.AddDays(-count); name = $"Son {count} gün"; nameEn = $"Last {count} days"; }
            else if (unit.StartsWith("hafta", StringComparison.Ordinal) || unit.StartsWith("week", StringComparison.Ordinal))
            { start = end.AddDays(-7 * count); name = count == 1 ? "Son 1 hafta" : $"Son {count} hafta"; nameEn = $"Last {count} week(s)"; }
            else if (unit is "ay" or "aylik" or "aydir" or "ayin" or "ayda" || unit.StartsWith("month", StringComparison.Ordinal))
            { start = today.AddMonths(-count).AddDays(1); name = $"Son {count} ay"; nameEn = $"Last {count} month(s)"; }
            else if (unit.StartsWith("yil", StringComparison.Ordinal) || unit.StartsWith("sene", StringComparison.Ordinal) || unit.StartsWith("year", StringComparison.Ordinal))
            { start = today.AddYears(-count).AddDays(1); name = $"Son {count} yıl"; nameEn = $"Last {count} year(s)"; }
            else continue;
            return Make(start, end, name, nameEn);
        }
        return null;
    }

    // ── "15.01.2026", "15/01", "2026-01-15" ─────────────────────────────────

    private static AssistantDateRange? NumericDate(string folded, DateTime today, bool preferFuture)
    {
        var iso = IsoDate().Match(folded);
        if (iso.Success && TryDate(int.Parse(iso.Groups[1].Value), int.Parse(iso.Groups[2].Value), int.Parse(iso.Groups[3].Value), out var isoDay))
            return Day(isoDay, today);
        var m = DottedDate().Match(folded);
        if (!m.Success) return null;
        var day = int.Parse(m.Groups[1].Value);
        var month = int.Parse(m.Groups[2].Value);
        int year;
        if (m.Groups[3].Success)
        {
            year = int.Parse(m.Groups[3].Value);
            if (year < 100) year += 2000;
        }
        else
        {
            year = today.Year;
            if (!preferFuture && TryDate(year, month, day, out var guess) && guess > today) year--;
        }
        return TryDate(year, month, day, out var date) ? Day(date, today) : null;
    }

    // ── Ay adları: "ocak", "ocak 2026", "15 ocak", "ocaktan marta", "ocak-mart" ──

    private static AssistantDateRange? MonthExpression(string[] tokens, DateTime today, bool preferFuture)
    {
        var found = new List<(int Index, int Month)>();
        for (var i = 0; i < tokens.Length; i++)
            if (MonthOf(tokens[i]) is int month) found.Add((i, month));
        if (found.Count == 0) return null;

        int? explicitYear = tokens.Select(t => int.TryParse(t, out var y) && y is >= 2000 and <= 2100 ? y : (int?)null).FirstOrDefault(y => y is not null);
        var previousYear = tokens.Any(t => t is "gecen" or "gectigimiz" or "onceki" or "gecenki") && !tokens.Any(t => t is "son");

        int YearFor(int month)
        {
            if (explicitYear is int y) return y;
            if (previousYear) return month >= today.Month ? today.Year - 1 : today.Year;
            if (preferFuture) return today.Year;
            return month > today.Month ? today.Year - 1 : today.Year;
        }

        var first = found[0];
        // "15 ocak" / "15 ocakta": ayın önündeki sayı gündür (yıl değilse).
        if (first.Index > 0 && int.TryParse(tokens[first.Index - 1], out var dayNumber) && dayNumber is >= 1 and <= 31)
        {
            var year = YearFor(first.Month);
            if (explicitYear is null && !preferFuture && !previousYear && TryDate(year, first.Month, dayNumber, out var probe) && probe > today) year--;
            // "1-15 ocak": aralık.
            var startToken = first.Index > 2 && tokens[first.Index - 2] is "ile" or "ila" or "ve" or "den" or "dan" or "ten" or "tan"
                ? tokens[first.Index - 3]
                : first.Index > 1 ? tokens[first.Index - 2] : string.Empty;   // "1-15 ocak": tire belirteçte düşer
            if (int.TryParse(startToken, out var startDay) && startDay >= 1 && startDay < dayNumber
                && TryDate(year, first.Month, startDay, out var rangeStart) && TryDate(year, first.Month, dayNumber, out var rangeEnd))
                return Make(rangeStart, rangeEnd.AddDays(1), null, null);
            return TryDate(year, first.Month, dayNumber, out var date) ? Day(date, today) : null;
        }

        if (found.Count >= 2 && found[1].Month != first.Month)
        {
            var startYear = YearFor(first.Month);
            var endYear = found[1].Month < first.Month ? startYear + 1 : startYear;
            var start = new DateTime(startYear, first.Month, 1);
            var end = new DateTime(endYear, found[1].Month, 1).AddMonths(1);
            return Make(start, end, null, null);
        }

        var monthStart = new DateTime(YearFor(first.Month), first.Month, 1);
        return Make(monthStart, monthStart.AddMonths(1), null, null);
    }

    private static int? MonthOf(string token)
    {
        for (var i = 0; i < Months.Length; i++)
        {
            var stem = Months[i];
            // Ek almış biçimler: "ocakta", "subattaki", "martin", "mayista", "eylulde", "kasimdan"…
            if (token == stem || (token.StartsWith(stem, StringComparison.Ordinal) && token.Length - stem.Length <= 6 && MonthSuffix(token[stem.Length..])))
                return i + 1;
            if (token == MonthsEn[i]) return i + 1;
        }
        return null;
    }

    private static bool MonthSuffix(string suffix) => suffix is
        "ta" or "te" or "da" or "de" or "tan" or "ten" or "dan" or "den" or "in" or "un" or "nin" or "a" or "e" or "ya" or "ye"
        or "taki" or "teki" or "daki" or "deki" or "ki" or "i" or "u" or "ina" or "una" or "ini" or "unu" or "dakı" or "inda"
        or "unda" or "indaki" or "undaki" or "inin" or "unun" or "a kadar" or "ayi" or "ayinda" or "ayindaki" or "ayinin";

    // ── Göreli: bugün, dün, yarın, bu/geçen/gelecek hafta-ay ────────────────

    private static AssistantDateRange? Relative(string t, DateTime today)
    {
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var monthStart = new DateTime(today.Year, today.Month, 1);

        if (Has(t, " evvelsi gun", " onceki gun", " dunden onceki", " day before yesterday"))
            return Make(today.AddDays(-2), today.AddDays(-1), "Önceki gün", "Day before yesterday");
        if (Has(t, " obur gun", " yarindan sonra", " day after tomorrow"))
            return Make(today.AddDays(2), today.AddDays(3), "Öbür gün", "Day after tomorrow");
        if (Has(t, " bugun", " today", " su an", " simdiye kadar bugun"))
            return Make(today, today.AddDays(1), "Bugün", "Today");
        if (Word(t, "dun", "dunku", "dunun", "dunden", "dune", "yesterday"))
            return Make(today.AddDays(-1), today, "Dün", "Yesterday");
        if (Word(t, "yarin", "yarinki", "yarinin", "yarina", "yarindan", "tomorrow"))
            return Make(today.AddDays(1), today.AddDays(2), "Yarın", "Tomorrow");

        if (Has(t, " gecen hafta", " onceki hafta", " gectigimiz hafta", " last week"))
            return Make(monday.AddDays(-7), monday, "Geçen hafta", "Last week");
        if (Has(t, " gelecek hafta", " haftaya", " onumuzdeki hafta", " next week"))
            return Make(monday.AddDays(7), monday.AddDays(14), "Gelecek hafta", "Next week");
        if (Has(t, " hafta sonu", " haftasonu", " weekend"))
            return Make(monday.AddDays(5), monday.AddDays(7), "Hafta sonu", "Weekend");
        if (Has(t, " bu hafta", " haftalik", " bu haftaki", " this week"))
            return Make(monday, monday.AddDays(7), "Bu hafta", "This week");

        if (Has(t, " gecen ay ", " gecen ayki", " gecen ayin", " gecen aydaki", " gecen ayda", " onceki ay ", " gectigimiz ay ", " last month"))
            return Make(monthStart.AddMonths(-1), monthStart, "Geçen ay", "Last month");
        if (Has(t, " gelecek ay ", " gelecek ayki", " onumuzdeki ay ", " next month"))
            return Make(monthStart.AddMonths(1), monthStart.AddMonths(2), "Gelecek ay", "Next month");
        if (Has(t, " bu ay ", " bu ayki", " bu ayin", " bu aydaki", " bu ayda", " aylik", " this month", " ay basindan"))
            return Make(monthStart, monthStart.AddMonths(1), "Bu ay", "This month");
        return null;
    }

    // ── Yıl: "2025", "bu yıl", "geçen sene", "yılbaşından beri" ─────────────

    private static AssistantDateRange? Year(string[] tokens, string t, DateTime today)
    {
        if (Has(t, " yilbasindan", " yil basindan", " sene basindan", " year to date"))
            return Make(new DateTime(today.Year, 1, 1), today.AddDays(1), "Yılbaşından bugüne", "Year to date");
        if (Has(t, " gecen yil", " gecen sene", " onceki yil", " gectigimiz yil", " last year"))
            return Make(new DateTime(today.Year - 1, 1, 1), new DateTime(today.Year, 1, 1), $"Geçen yıl", "Last year");
        if (Has(t, " bu yil", " bu sene", " yillik", " this year"))
            return Make(new DateTime(today.Year, 1, 1), new DateTime(today.Year + 1, 1, 1), "Bu yıl", "This year");
        foreach (var token in tokens)
            if (int.TryParse(token, out var year) && year is >= 2000 and <= 2100)
                return Make(new DateTime(year, 1, 1), new DateTime(year + 1, 1, 1), null, null);
        return null;
    }

    // ── Yardımcılar ─────────────────────────────────────────────────────────

    private static AssistantDateRange Day(DateTime date, DateTime today)
    {
        if (date == today) return Make(date, date.AddDays(1), "Bugün", "Today");
        if (date == today.AddDays(-1)) return Make(date, date.AddDays(1), "Dün", "Yesterday");
        if (date == today.AddDays(1)) return Make(date, date.AddDays(1), "Yarın", "Tomorrow");
        return Make(date, date.AddDays(1), null, null);
    }

    /// <summary>Ad verilmezse (ay, yıl, açık tarih) ad = tarih aralığının kendisi.</summary>
    public static AssistantDateRange Make(DateTime from, DateTime to, string? name, string? nameEn)
    {
        var span = SpanOf(from, to, Tr);
        var spanEn = SpanOf(from, to, En);
        return new AssistantDateRange(from, to, name ?? span, nameEn ?? spanEn, span, spanEn);
    }

    /// <summary>"20 Kasım 2026", "16–22 Kasım 2026", "Ekim 2026", "2025", "28 Ekim – 3 Kasım 2026".</summary>
    private static string SpanOf(DateTime from, DateTime to, CultureInfo culture)
    {
        var last = to.AddDays(-1);
        string Month(DateTime d) => culture.DateTimeFormat.GetMonthName(d.Month);
        if (from.Month == 1 && from.Day == 1 && to == from.AddYears(1)) return from.Year.ToString(CultureInfo.InvariantCulture);
        if (from.Day == 1 && to == from.AddMonths(1)) return $"{Month(from)} {from.Year}";
        if (from.Day == 1 && to.Day == 1 && from.Year == last.Year) return $"{Month(from)} – {Month(last)} {from.Year}";
        if (last <= from) return $"{from.Day} {Month(from)} {from.Year}";
        if (from.Year == last.Year && from.Month == last.Month) return $"{from.Day}–{last.Day} {Month(from)} {from.Year}";
        if (from.Year == last.Year) return $"{from.Day} {Month(from)} – {last.Day} {Month(last)} {from.Year}";
        return $"{from.Day} {Month(from)} {from.Year} – {last.Day} {Month(last)} {last.Year}";
    }

    private static bool TryDate(int year, int month, int day, out DateTime date)
    {
        date = default;
        if (year is < 2000 or > 2100 || month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month)) return false;
        date = new DateTime(year, month, day);
        return true;
    }

    private static bool Has(string text, params string[] terms) => terms.Any(term => text.Contains(term, StringComparison.Ordinal));

    private static bool Word(string text, params string[] words) => words.Any(word => text.Contains($" {word} ", StringComparison.Ordinal));

    [GeneratedRegex(@"[\p{L}]+|\d+")]
    private static partial Regex Tokens();

    [GeneratedRegex(@"(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?!\d)")]
    private static partial Regex DottedDate();

    [GeneratedRegex(@"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")]
    private static partial Regex IsoDate();
}

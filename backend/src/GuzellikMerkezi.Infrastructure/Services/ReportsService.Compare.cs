using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Çoklu dönem karşılaştırması — "bu yıl ↔ 5 yıl önce" gibi serbest seçilmiş 2–6 dönem.
///
/// • Her dönem AYNI çekirdek hesaplayıcıdan (<c>ComputeCoreAsync</c>) geçer; Genel Bakış'la
///   rakam farkı olmaz.
/// • Kova genişliği TEK bir değerdir (temel dönemden türetilir) — yoksa 2021 aylık, 2026 günlük
///   kovalanır ve eğriler üst üste binmezdi.
/// • Metriklerin "önceki" değeri temel dönemin (listedeki ilk) değeridir; arayüz farkı ona göre çizer.
/// </summary>
public sealed partial class ReportsService
{
    /// <summary>Aynı anda kıyaslanabilecek en fazla dönem — grafik ve yanıt boyutu freni.</summary>
    private const int MaxComparePeriods = 6;

    public async Task<Result<CompareReportDto>> GetCompareAsync(
        Guid tenantId,
        IReadOnlyList<ComparePeriodRequest> periods,
        string? granularity,
        CancellationToken cancellationToken = default)
    {
        if (periods.Count == 0)
        {
            return Result<CompareReportDto>.Failure(Error.Validation("Karşılaştırma için en az bir dönem gerekli."));
        }

        var normalized = periods
            .Take(MaxComparePeriods)
            .Select((p, i) =>
            {
                var from = ToUtc(p.FromUtc);
                var to = ToUtc(p.ToUtc);
                if (to <= from) to = from.AddDays(1);
                var label = string.IsNullOrWhiteSpace(p.Label) ? $"Dönem {i + 1}" : p.Label.Trim();
                return (Key: $"p{i}", Label: label, From: from, To: to);
            })
            .ToList();

        // Kova genişliği: istenmişse o, yoksa TEMEL dönemin uzunluğundan.
        var baselineRange = normalized[0];
        var bucket = ResolveGranularity(baselineRange.From, baselineRange.To, granularity);

        var accounts = await LoadAccountsAsync(tenantId, cancellationToken);
        var accountsById = accounts.ToDictionary(a => a.Id);
        var serviceMeta = await LoadServiceMetaAsync(tenantId, cancellationToken);
        var sellers = await LoadSellerLookupAsync(tenantId, cancellationToken);

        var cores = new List<CorePeriod>(normalized.Count);
        var extras = new List<(List<ReportSliceDto> Services, List<ReportSliceDto> Staff)>(normalized.Count);
        foreach (var p in normalized)
        {
            cores.Add(await ComputeCoreAsync(tenantId, accounts, accountsById, p.From, p.To, bucket, cancellationToken));
            extras.Add(await TopPerformersAsync(tenantId, p.From, p.To, serviceMeta, sellers, cancellationToken));
        }

        var baseline = cores[0];

        // Ortak eksen: temel dönemin etiketleri; daha uzun bir dönem varsa kuyruğu ondan tamamlanır.
        // Aylık kovada YIL atılır ("Ocak 2026" → "Ocak"): eksen tüm dönemler için ortaktır, tek bir
        // yılın etiketini taşımak (2026'yı 2021'le kıyaslarken) yanıltıcı olurdu.
        var longest = cores.OrderByDescending(c => c.Series.Count).First();
        var axis = new List<string>(longest.Series.Count);
        for (var i = 0; i < longest.Series.Count; i++)
        {
            var label = i < baseline.Series.Count ? baseline.Series[i].Label : longest.Series[i].Label;
            axis.Add(bucket == "month" ? StripYear(label) : label);
        }

        var result = new List<ComparePeriodDto>(normalized.Count);
        for (var i = 0; i < normalized.Count; i++)
        {
            var p = normalized[i];
            var core = cores[i];
            result.Add(new ComparePeriodDto(
                p.Key,
                p.Label,
                p.From,
                p.To,
                Math.Max(1, (int)Math.Round((p.To - p.From).TotalDays)),
                i == 0,
                BuildCompareMetrics(core, i == 0 ? null : baseline),
                core.Series,
                core.PaymentMethods,
                core.ExpenseCategories,
                extras[i].Services,
                extras[i].Staff));
        }

        return Result<CompareReportDto>.Success(new CompareReportDto(bucket, axis, result));
    }

    /// <summary>"Ocak 2026" → "Ocak" (sondaki 4 haneli yıl atılır).</summary>
    private static string StripYear(string label)
    {
        var space = label.LastIndexOf(' ');
        if (space <= 0) return label;
        var tail = label[(space + 1)..];
        return tail.Length == 4 && tail.All(char.IsDigit) ? label[..space] : label;
    }

    /// <summary>Genel Bakış'takiyle aynı metrik seti; "önceki" alanı temel dönemden gelir.</summary>
    private static List<ReportMetricDto> BuildCompareMetrics(CorePeriod cur, CorePeriod? baseline)
    {
        decimal Prev(Func<CorePeriod, decimal> pick) => baseline is null ? 0m : pick(baseline);
        decimal Ratio(CorePeriod p, Func<CorePeriod, decimal> num, Func<CorePeriod, decimal> den) =>
            den(p) > 0 ? Round(num(p) / den(p) * 100m) : 0m;
        decimal Per(CorePeriod p, Func<CorePeriod, decimal> num, Func<CorePeriod, decimal> den) =>
            den(p) > 0 ? Round(num(p) / den(p)) : 0m;

        return
        [
            new("income", "Toplam Gelir", Round(cur.Income), Round(Prev(p => p.Income)), "currency", $"{cur.PaymentCount} tahsilat"),
            new("expense", "Toplam Gider", Round(cur.Expense), Round(Prev(p => p.Expense)), "currency", $"{cur.ExpenseCount} gider"),
            new("net", "Net Kâr", Round(cur.Income - cur.Expense), Round(Prev(p => p.Income - p.Expense)), "currency",
                cur.Income - cur.Expense >= 0 ? "kârda" : "zararda"),
            new("margin", "Kâr Marjı",
                Ratio(cur, p => p.Income - p.Expense, p => p.Income),
                baseline is null ? 0m : Ratio(baseline, p => p.Income - p.Expense, p => p.Income),
                "percent", "gelire oranla net"),
            new("sales", "Satış Tutarı", Round(cur.Sales), Round(Prev(p => p.Sales)), "currency", $"{cur.SalesCount} satış"),
            new("appointments", "Randevu", cur.AppointmentCount, Prev(p => p.AppointmentCount), "count", $"{cur.CompletedCount} tamamlandı"),
            new("completed", "Tamamlanan İşlem", cur.CompletedCount, Prev(p => p.CompletedCount), "count", "uygulanan seans"),
            new("occupancy", "Tamamlanma Oranı",
                Ratio(cur, p => p.CompletedCount, p => p.AppointmentCount),
                baseline is null ? 0m : Ratio(baseline, p => p.CompletedCount, p => p.AppointmentCount),
                "percent", "randevuya oranla"),
            new("activeCustomers", "Aktif Müşteri", cur.ActiveCustomers, Prev(p => p.ActiveCustomers), "count", "dönemde işlem gören"),
            new("newCustomers", "Yeni Müşteri", cur.NewCustomers, Prev(p => p.NewCustomers), "count", "ilk kez kayıt olan"),
            new("avgTicket", "Ortalama Sepet",
                Per(cur, p => p.Income, p => p.PaymentCount),
                baseline is null ? 0m : Per(baseline, p => p.Income, p => p.PaymentCount),
                "currency", "tahsilat başına"),
            new("revenuePerCustomer", "Müşteri Başına Ciro",
                Per(cur, p => p.Income, p => p.ActiveCustomers),
                baseline is null ? 0m : Per(baseline, p => p.Income, p => p.ActiveCustomers),
                "currency", "aktif müşteri başına"),
        ];
    }

    /// <summary>Dönemde en çok uygulanan hizmet ve en çok iş bitiren personel (ilk 8'er).</summary>
    private async Task<(List<ReportSliceDto> Services, List<ReportSliceDto> Staff)> TopPerformersAsync(
        Guid tenantId,
        DateTime from,
        DateTime to,
        Dictionary<Guid, CatalogMeta> serviceMeta,
        SellerLookup sellers,
        CancellationToken ct)
    {
        var completed = (await LoadAppointmentsAsync(tenantId, from, to, ct))
            .Where(a => a.Status == AppointmentStatus.Completed)
            .ToList();

        var services = completed
            .GroupBy(a => a.ServiceDefinitionId)
            .Select(g => new ReportSliceDto(
                g.Key.ToString(),
                serviceMeta.TryGetValue(g.Key, out var m) ? m.Name : "Hizmet",
                Round(g.Sum(x => x.Price)),
                g.Count()))
            .OrderByDescending(s => s.Amount)
            .Take(8)
            .ToList();

        var staff = completed
            .GroupBy(a => a.StaffMemberId)
            .Select(g => new ReportSliceDto(
                g.Key.ToString(),
                sellers.NameFor(g.Key),
                Round(g.Sum(x => x.Price)),
                g.Count()))
            .OrderByDescending(s => s.Amount)
            .Take(8)
            .ToList();

        return (services, staff);
    }
}

using System.Globalization;
using System.Text.Json;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Billing;

/// <summary>
/// Hacim kademesi: sayaç <see cref="Above"/> DEĞERİNİ AŞINCA (strictly "üzeri") aylık ek ücret uygulanır.
/// Kademeler birikmez — aşılan EN YÜKSEK kademenin ücreti geçerlidir (10.001 müşteri → 250,
/// 15.001 → 500, 20.001 → 1.000). Tam eşik (10.000) bir alt kademede kalır.
/// </summary>
public sealed record PricingTier(int Above, decimal MonthlyFee)
{
    public const int MaxTiers = 10;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Sıralı, doğrulanmış kademe listesi. Boş/null = kademe yok.</summary>
    public static IReadOnlyList<PricingTier> Normalize(IEnumerable<PricingTier>? tiers)
    {
        var list = (tiers ?? []).ToList();
        if (list.Count > MaxTiers) throw new DomainException($"En fazla {MaxTiers} kademe tanımlanabilir.");
        foreach (var t in list)
        {
            if (t.Above < 0) throw new DomainException("Kademe eşiği negatif olamaz.");
            if (t.MonthlyFee < 0) throw new DomainException("Kademe ücreti negatif olamaz.");
        }
        if (list.Select(t => t.Above).Distinct().Count() != list.Count)
            throw new DomainException("Aynı eşik iki kademede kullanılamaz.");
        return list
            .OrderBy(t => t.Above)
            .Select(t => t with { MonthlyFee = decimal.Round(t.MonthlyFee, 2, MidpointRounding.AwayFromZero) })
            .ToList();
    }

    public static string? Serialize(IReadOnlyList<PricingTier> tiers) =>
        tiers.Count == 0 ? null : JsonSerializer.Serialize(tiers, Json);

    /// <summary>Kayıttaki JSON'u okur; bozuk/boş değer = kademe yok (fiyatlamayı patlatmaz).</summary>
    public static IReadOnlyList<PricingTier> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            var parsed = JsonSerializer.Deserialize<List<PricingTier>>(json, Json) ?? [];
            return parsed.OrderBy(t => t.Above).ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>Sayacın aştığı en yüksek kademe; hiçbirini aşmıyorsa null.</summary>
    public static PricingTier? Applicable(IReadOnlyList<PricingTier> tiers, int count) =>
        tiers.Where(t => count > t.Above).OrderByDescending(t => t.Above).FirstOrDefault();
}

/// <summary>
/// Teklif kalemi — KDV HARİÇ. <see cref="Net"/> kalemin kuruşa yuvarlı tutarıdır (toplama giren budur);
/// orantılı şube kaleminde <see cref="UnitNet"/> günlük ücretin GÖSTERİMİDİR (tutar yuvarlanmamış orandan hesaplanır).
/// </summary>
public sealed record QuoteLine(string Code, string Label, decimal Quantity, decimal UnitNet, decimal Net);

/// <summary>
/// ABONELİK TEKLİFİ — tahsilatın, faturanın ve tüm ekranların TEK fiyat kaynağı.
/// Kalemler KDV hariçtir; <see cref="Subtotal"/> = kalemlerin toplamı, <see cref="Total"/> = <see cref="Subtotal"/> + <see cref="Vat"/>.
/// </summary>
public sealed record SubscriptionQuote(
    string PlanName,
    BillingPeriod Period,
    IReadOnlyList<QuoteLine> Lines,
    decimal Subtotal,
    decimal VatRate,
    decimal Vat,
    decimal Total,
    int Branches,
    int Customers,
    int ConsentDocuments)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Ödeme/fatura satırına yazılan ANLIK GÖRÜNTÜ — geçmiş fatura sonradan yeniden hesaplanmaz.</summary>
    public string ToJson() => JsonSerializer.Serialize(this, Json);

    public static SubscriptionQuote? FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<SubscriptionQuote>(json, Json); }
        catch (JsonException) { return null; }
    }
}

/// <summary>Kurumun aylık değeri: net (KDV hariç), brüt (KDV dahil) ve dönemin yenileme tutarı (brüt).</summary>
public sealed record MonthlyValue(decimal Net, decimal Gross, decimal PeriodGross);

/// <summary>Teklifin dayandığı sayaçlar (kurum genelinde). İmzalı onam: imzalanmış HER evrak (silinmiş olsa da).</summary>
public sealed record BillingCounts(int Branches, int Customers, int SignedConsentForms);

/// <summary>Ücretli hacim boyutu — her birinin kendi kademe listesi ve faturadaki "ödenmiş kademe" alanı var.</summary>
public enum TierDimension
{
    /// <summary>Kayıtlı müşteri (silinmemiş) — stok sayaç.</summary>
    Customers,
    /// <summary>İmzalanmış dijital onam evrakı (silinmiş dahil) — akış sayaç.</summary>
    ConsentDocuments,
}

/// <summary>
/// HACİM HAKKI (müşteri / dijital onam) — "sınırı geçen ödemeden kullanamaz" kuralının saf hesabı.
///
/// <para>
/// Kademeler "eşik ÜZERİ" çalışır (<see cref="PricingTier.Applicable"/>): 10.000 eşikli kademe 10.001.
/// kayıttan itibaren gerekir. Kurumun <b>ödenmiş kademesi</b> (<c>paidAbove</c>) bugünü kapsayan ÖDENMİŞ
/// faturalardaki en yüksek kademe eşiğidir; null = hiçbir kademe ödenmedi (yalnız ücretsiz bölüm).
/// Kapasite = ilk KARŞILANMAMIŞ ücretli kademenin eşiği: o sayıya kadar serbest, sonrası kilitli.
/// Ücreti 0 olan kademe karşılanmış sayılır; kademe tanımı yoksa sınır yoktur.
/// </para>
/// </summary>
public static class ConsentAllowance
{
    public static PricingTier? FirstUncoveredTier(IReadOnlyList<PricingTier> tiers, int? paidAbove) => TierAllowance.FirstUncoveredTier(tiers, paidAbove);
    public static int? Capacity(IReadOnlyList<PricingTier> tiers, int? paidAbove) => TierAllowance.Capacity(tiers, paidAbove);
    public static bool CanSignAnother(IReadOnlyList<PricingTier> tiers, int? paidAbove, int signed) => TierAllowance.CanAdd(tiers, paidAbove, signed);
    public static decimal PaidMonthlyFee(IReadOnlyList<PricingTier> tiers, int? paidAbove) => TierAllowance.PaidMonthlyFee(tiers, paidAbove);
}

/// <inheritdoc cref="ConsentAllowance"/>
public static class TierAllowance
{
    /// <summary>Satın alınması gereken ilk kademe (kapasitenin eşiği); null = sınırsız.</summary>
    public static PricingTier? FirstUncoveredTier(IReadOnlyList<PricingTier> tiers, int? paidAbove) =>
        tiers.OrderBy(t => t.Above).FirstOrDefault(t => t.MonthlyFee > 0 && (paidAbove is null || t.Above > paidAbove));

    /// <summary>İmzalanabilecek en çok evrak; null = sınırsız.</summary>
    public static int? Capacity(IReadOnlyList<PricingTier> tiers, int? paidAbove) => FirstUncoveredTier(tiers, paidAbove)?.Above;

    /// <summary><paramref name="count"/> kayıt varken <paramref name="adding"/> kayıt daha eklenebilir mi?</summary>
    public static bool CanAdd(IReadOnlyList<PricingTier> tiers, int? paidAbove, int count, int adding = 1) =>
        Capacity(tiers, paidAbove) is not int capacity || count + adding <= capacity;

    /// <summary>Ödenmiş kademenin aylık ücreti (eşiği <paramref name="paidAbove"/>'ı aşmayan en yüksek kademe); yoksa 0.</summary>
    public static decimal PaidMonthlyFee(IReadOnlyList<PricingTier> tiers, int? paidAbove) =>
        paidAbove is null ? 0m
            : tiers.Where(t => t.Above <= paidAbove).OrderByDescending(t => t.Above).FirstOrDefault()?.MonthlyFee ?? 0m;
}

/// <summary>
/// ABONELİK FİYATLAMA MOTORU — saf fonksiyonlar (veritabanı/ağ yok).
///
/// <para>
/// Paket fiyatları KDV HARİÇTİR. Tutar = şube ücreti (paket şube başınaysa şube sayısı × birim)
/// + müşteri kademesi + dijital onam kademesi; KDV en sonda bir kez eklenir. Yıllık dönemde
/// birim fiyat paketin yıllık fiyatıdır; kademe ücretleri aylık ücret × <see cref="SubscriptionPlan.YearlyTierMultiplier"/>.
/// </para>
/// </summary>
public static class SubscriptionPricing
{
    /// <summary>Türkiye KDV oranı (%20). Fatura satırına oran ayrıca yazılır.</summary>
    public const decimal DefaultVatRate = 0.20m;

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    public static decimal UnitPrice(SubscriptionPlan plan, BillingPeriod period) =>
        period == BillingPeriod.Yearly ? plan.YearlyPriceTRY : plan.MonthlyPriceTRY;

    /// <summary>
    /// Aylık tekrarlayan gelir katkısı (KDV HARİÇ): dönem teklifinin ara toplamı; yıllıkta ÷ 12.
    /// Yıllık fiyatı tanımsız (0) pakette aylık fiyattan hesaplanır.
    /// </summary>
    public static decimal MonthlyEquivalentNet(SubscriptionPlan plan, BillingPeriod? period, BillingCounts counts) =>
        MonthlyEquivalent(plan, period, counts).Net;

    /// <summary>
    /// Aylık değer — net (KDV hariç) ve brüt (KDV dahil), ayrıca dönemin yenileme tutarı (brüt). Maydanoz
    /// (ödemenin alındığı yer) gelir ekranlarını bununla kurar; vergiyi ve kademeyi kendisi HESAPLAMAZ.
    /// Yıllıkta aylık değer = dönem tutarı ÷ 12. Yıllık fiyatı tanımsız (0) pakette aylık fiyattan hesaplanır.
    /// </summary>
    public static MonthlyValue MonthlyEquivalent(SubscriptionPlan plan, BillingPeriod? period, BillingCounts counts)
    {
        var p = period == BillingPeriod.Yearly && plan.YearlyPriceTRY > 0 ? BillingPeriod.Yearly : BillingPeriod.Monthly;
        var quote = Quote(plan, p, counts);
        return p == BillingPeriod.Yearly
            ? new MonthlyValue(Round(quote.Subtotal / 12m), Round(quote.Total / 12m), quote.Total)
            : new MonthlyValue(quote.Subtotal, quote.Total, quote.Total);
    }

    public static SubscriptionQuote Quote(SubscriptionPlan plan, BillingPeriod period, BillingCounts counts, decimal vatRate = DefaultVatRate)
    {
        var lines = new List<QuoteLine>();
        var unit = UnitPrice(plan, period);
        var periodLabel = period == BillingPeriod.Yearly ? "yıllık" : "aylık";

        if (plan.ChargePerBranch)
        {
            // Şubesi olmayan kurum (kayıt anı) en az bir şube ücreti öder: ana şube her zaman vardır.
            var branches = Math.Max(1, counts.Branches);
            lines.Add(new QuoteLine("branches", $"{plan.Name} · {branches} şube ({periodLabel})",
                branches, unit, Round(branches * unit)));
        }
        else
        {
            lines.Add(new QuoteLine("plan", $"{plan.Name} ({periodLabel})", 1, unit, Round(unit)));
        }

        var multiplier = period == BillingPeriod.Yearly ? plan.YearlyTierMultiplier : 1m;

        var customerTier = PricingTier.Applicable(plan.CustomerTiers, counts.Customers);
        if (customerTier is { MonthlyFee: > 0 })
        {
            var fee = Round(customerTier.MonthlyFee * multiplier);
            lines.Add(new QuoteLine("customers",
                $"Müşteri kademesi · {customerTier.Above.ToString("N0", Tr)} üzeri ({counts.Customers.ToString("N0", Tr)} müşteri)",
                1, fee, fee));
        }

        var consentTier = PricingTier.Applicable(plan.ConsentTiers, counts.SignedConsentForms);
        if (consentTier is { MonthlyFee: > 0 })
        {
            var fee = Round(consentTier.MonthlyFee * multiplier);
            lines.Add(new QuoteLine("consent",
                $"Dijital onam · {consentTier.Above.ToString("N0", Tr)} üzeri evrak ({counts.SignedConsentForms.ToString("N0", Tr)} evrak)",
                1, fee, fee));
        }

        return Build(plan.Name, period, lines, vatRate, counts);
    }

    /// <summary>
    /// ELLE FATURALANAN (dönemsiz) kurumun içinde bulunulan "dönem"inin sonu: bir sonraki takvim ayının 1'i (UTC).
    /// Platformun aylık taslakları (<c>GenerateCurrentPeriodInvoicesAsync</c>) TAKVİM AYI keser; dönem ortası ek
    /// ücret (şube / kademe) ay sonuna kadar orantılanır ki sonraki ayın taslağıyla ÇAKIŞIP iki kez faturalanmasın.
    /// </summary>
    public static DateTime ManualBillingPeriodEnd(DateTime nowUtc) =>
        new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);

    /// <summary>
    /// DÖNEM ORTASINDA EKLENEN ŞUBE — şimdiden aboneliğin bitişine kadar gün bazında orantılı ücret.
    ///
    /// <para>
    /// Oran 1 ile SINIRLANMAZ: yenileme vadeden birkaç gün önce çekildiği için bitiş tarihi bir sonraki
    /// dönemin sonuna kaymış olabilir; o arada açılan şube ödenmiş sonraki dönemi de kapsamalı,
    /// yoksa bir dönem boyunca ücretsiz kalırdı. Gün = başlamış her gün (yukarı yuvarlanır, en az 1).
    /// </para>
    /// </summary>
    public static SubscriptionQuote ProrateBranch(SubscriptionPlan plan, BillingPeriod period, DateTime nowUtc, DateTime subscriptionEndsAtUtc,
        BillingCounts counts, decimal vatRate = DefaultVatRate)
    {
        if (subscriptionEndsAtUtc <= nowUtc) throw new DomainException("Abonelik dönemi bitmiş; orantılı ücret hesaplanamaz.");

        var unit = UnitPrice(plan, period);
        var periodStart = period == BillingPeriod.Yearly ? subscriptionEndsAtUtc.AddYears(-1) : subscriptionEndsAtUtc.AddMonths(-1);
        var periodDays = (int)Math.Round((subscriptionEndsAtUtc - periodStart).TotalDays);
        var remainingDays = Math.Max(1, (int)Math.Ceiling((subscriptionEndsAtUtc - nowUtc).TotalDays));

        var dailyRate = unit / periodDays;
        var net = Round(dailyRate * remainingDays);
        var lines = new List<QuoteLine>
        {
            new("branch-prorated",
                $"Ek şube · {remainingDays} gün (dönem sonu {subscriptionEndsAtUtc.AddHours(3):dd.MM.yyyy}, {(period == BillingPeriod.Yearly ? "yıllık" : "aylık")} {unit.ToString("N2", Tr)} ₺ / {periodDays} gün)",
                remainingDays, Round(dailyRate), net),
        };
        return Build(plan.Name, period, lines, vatRate, counts);
    }

    /// <summary>
    /// ONAM KADEMESİ YÜKSELTME — hedef kademe ile ödenmiş kademe arasındaki aylık fark.
    /// <para>
    /// Ücretli dönemde (<paramref name="subscriptionEndsAtUtc"/> verilmiş): dönem sonuna kadar gün bazında
    /// orantılı (yıllıkta fark × <see cref="SubscriptionPlan.YearlyTierMultiplier"/> yıllık tutar üzerinden;
    /// şube orantısıyla aynı gün kuralı). Dönemi olmayan kurumda (platformun elle açtığı): BİR AYLIK fark.
    /// </para>
    /// </summary>
    public static SubscriptionQuote ConsentUpgrade(SubscriptionPlan plan, BillingPeriod? period, DateTime nowUtc,
        DateTime? subscriptionEndsAtUtc, PricingTier target, decimal paidMonthlyFee, BillingCounts counts, decimal vatRate = DefaultVatRate) =>
        TierUpgrade(plan, TierDimension.ConsentDocuments, period, nowUtc, subscriptionEndsAtUtc, target, paidMonthlyFee, counts, vatRate);

    /// <summary>Kademe yükseltme teklifi (müşteri / dijital onam) — bkz. <see cref="ConsentUpgrade"/>.</summary>
    public static SubscriptionQuote TierUpgrade(SubscriptionPlan plan, TierDimension dimension, BillingPeriod? period, DateTime nowUtc,
        DateTime? subscriptionEndsAtUtc, PricingTier target, decimal paidMonthlyFee, BillingCounts counts, decimal vatRate = DefaultVatRate)
    {
        var monthlyDiff = Math.Max(0m, target.MonthlyFee - paidMonthlyFee);
        var tierText = dimension == TierDimension.Customers
            ? $"Müşteri kademesi · {target.Above.ToString("N0", Tr)} üzeri müşteri"
            : $"Dijital onam kademesi · {target.Above.ToString("N0", Tr)} üzeri evrak";
        var code = dimension == TierDimension.Customers ? "customer-upgrade" : "consent-upgrade";
        var lines = new List<QuoteLine>();

        if (period is { } p && subscriptionEndsAtUtc is { } endsAt && endsAt > nowUtc)
        {
            var periodDiff = p == BillingPeriod.Yearly ? monthlyDiff * plan.YearlyTierMultiplier : monthlyDiff;
            var periodStart = p == BillingPeriod.Yearly ? endsAt.AddYears(-1) : endsAt.AddMonths(-1);
            var periodDays = (int)Math.Round((endsAt - periodStart).TotalDays);
            var remainingDays = Math.Max(1, (int)Math.Ceiling((endsAt - nowUtc).TotalDays));
            var dailyRate = periodDiff / periodDays;
            lines.Add(new QuoteLine(code,
                $"{tierText} · {remainingDays} gün (dönem sonu {endsAt.AddHours(3):dd.MM.yyyy})",
                remainingDays, Round(dailyRate), Round(dailyRate * remainingDays)));
            return Build(plan.Name, p, lines, vatRate, counts);
        }

        lines.Add(new QuoteLine(code, $"{tierText} · 1 ay", 1, monthlyDiff, Round(monthlyDiff)));
        return Build(plan.Name, BillingPeriod.Monthly, lines, vatRate, counts);
    }

    private static SubscriptionQuote Build(string planName, BillingPeriod period, List<QuoteLine> lines, decimal vatRate, BillingCounts counts)
    {
        var subtotal = lines.Sum(l => l.Net);
        var vat = Round(subtotal * vatRate);
        return new SubscriptionQuote(planName, period, lines, subtotal, vatRate, vat, subtotal + vat,
            counts.Branches, counts.Customers, counts.SignedConsentForms);
    }

    private static decimal Round(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero);
}

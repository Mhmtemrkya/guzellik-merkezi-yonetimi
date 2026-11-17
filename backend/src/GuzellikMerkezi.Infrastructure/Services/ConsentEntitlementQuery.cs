using System.Globalization;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>Kurumun hacim hakkı (müşteri / dijital onam) — tek kaynak: <see cref="TierEntitlementQuery"/>.</summary>
/// <param name="Allowed">Bir kayıt daha eklenebilir / imzalanabilir mi?</param>
/// <param name="Signed">Sayaç: onamda kotaya giren imzalı evrak (silinmişler dahil), müşteride kayıtlı (silinmemiş) müşteri.</param>
/// <param name="Capacity">Ödenmiş kademelerle izin verilen en çok kayıt; null = sınırsız.</param>
/// <param name="PaidTierAbove">Bugünü kapsayan ÖDENMİŞ faturalardaki en yüksek kademe eşiği; null = yalnız ücretsiz bölüm.</param>
/// <param name="NextTier">Kapasiteyi açacak (satın alınması gereken) ilk kademe; null = sınırsız.</param>
public sealed record ConsentEntitlement(
    bool Allowed,
    int Signed,
    int? Capacity,
    int? PaidTierAbove,
    PricingTier? NextTier,
    IReadOnlyList<PricingTier> Tiers,
    SubscriptionPlan? Plan)
{
    /// <summary>Sayaç (müşteri boyutunda "kayıtlı müşteri").</summary>
    public int Count => Signed;
}

/// <summary>
/// HACİM HAKKI — "sınırı geçen, ÖDEMEDEN kullanamaz" (müşteri ve dijital onam için AYNI kural).
///
/// <para>
/// Ödenmiş kademe YALNIZ "Paid" durumundaki ve bugünü kapsayan (<c>PeriodStart ≤ şimdi &lt; PeriodEnd</c>)
/// faturalardan okunur: kartla yenileme / checkout faturası, platformun ödendi işaretlediği dönem
/// faturası ya da kademe yükseltme faturası. Açık (Draft/Sent/Overdue) fatura kilidi AÇMAZ; iptal edilen
/// fatura hakkı geri alır. Ayrı bir "hak" alanı tutulmaz — tek doğruluk kaynağı ödenmiş faturadır.
/// </para>
/// <para>
/// Sayaçlar faturalamayla AYNI fonksiyondan gelir (<see cref="BillingCountsQuery"/>): onamda imzalanmış her
/// evrak (silinmiş dahil — akış), müşteride silinmemiş kayıt (stok; KVKK silmesi sayacı düşürebilmeli).
/// </para>
/// </summary>
public static class TierEntitlementQuery
{
    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    /// <param name="adding">Eklenecek kayıt sayısı (tekil işlemde 1; toplu içe aktarmada satır sayısı).</param>
    public static async Task<ConsentEntitlement> EvaluateAsync(GuzellikDbContext db, Guid tenantId, TierDimension dimension,
        DateTime nowUtc, CancellationToken ct, int adding = 1)
    {
        var row = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => new { t.Slug, t.SubscriptionPlan })
            .FirstOrDefaultAsync(ct);
        var plan = row?.SubscriptionPlan;
        // SİSTEM KURUMU (pazaryeri "bireysel müşteriler") abone değildir: tüm online müşterilerin evi olduğu
        // için kademeye girseydi platform genelinde online kayıt kilitlenirdi.
        var exempt = row?.Slug == Domain.SystemTenant.IndividualSlug;
        var tiers = plan is null || exempt ? [] : dimension == TierDimension.Customers ? plan.CustomerTiers : plan.ConsentTiers;
        var count = dimension == TierDimension.Customers
            ? await BillingCountsQuery.CountCustomersAsync(db, tenantId, ct)
            : await BillingCountsQuery.CountSignedConsentsAsync(db, tenantId, ct);
        if (tiers.Count == 0) return new ConsentEntitlement(true, count, null, null, null, tiers, plan);

        var paidAbove = await PaidTierAboveAsync(db, tenantId, dimension, nowUtc, ct);
        var next = TierAllowance.FirstUncoveredTier(tiers, paidAbove);
        var allowed = TierAllowance.CanAdd(tiers, paidAbove, count, Math.Max(1, adding));
        return new ConsentEntitlement(allowed, count, next?.Above, paidAbove, next, tiers, plan);
    }

    /// <summary>Bugünü kapsayan ÖDENMİŞ faturalardaki en yüksek kademe eşiği (boyuta göre).</summary>
    public static async Task<int?> PaidTierAboveAsync(GuzellikDbContext db, Guid tenantId, TierDimension dimension, DateTime nowUtc, CancellationToken ct)
    {
        // Durum ve tarih süzgeci SQL'de; en yüksek değer bellekte (birkaç satır).
        var paid = db.TenantInvoices.IgnoreQueryFilters().AsNoTracking()
            .Where(i => i.TenantId == tenantId && !i.IsDeleted && i.Status == "Paid"
                        && i.PeriodStartUtc <= nowUtc && i.PeriodEndUtc > nowUtc);
        var granted = dimension == TierDimension.Customers
            ? await paid.Where(i => i.CustomerTierAbove != null).Select(i => i.CustomerTierAbove).ToListAsync(ct)
            : await paid.Where(i => i.ConsentTierAbove != null).Select(i => i.ConsentTierAbove).ToListAsync(ct);
        return granted.Count == 0 ? null : granted.Max();
    }

    /// <summary>
    /// Kurum içi kilit mesajı — NÖTR (satın alma çağrısı yok; iOS'ta App Store 3.1.1). İstemci makine kodunu
    /// görüp yükseltme yolunu kendisi gösterir.
    /// </summary>
    public static string LimitMessage(TierDimension dimension, ConsentEntitlement e) => dimension == TierDimension.Customers
        ? $"Kayıtlı müşteri sınırına ulaşıldı ({(e.Capacity ?? e.Count).ToString("N0", Tr)} müşteri). " +
          "Bu kademenin bedeli ödenmeden yeni müşteri eklenemez."
        : $"İmzalı onam evrakı sınırına ulaşıldı ({(e.Capacity ?? e.Count).ToString("N0", Tr)} evrak). " +
          "Bu kademenin bedeli ödenmeden yeni onam imzalatılamaz.";

    /// <summary>
    /// SALONUN MÜŞTERİSİNE gösterilen mesaj (online kayıt / randevu portalı) — faturalama içeriği YOK.
    /// </summary>
    public const string PublicCustomerLimitMessage =
        "Bu salon şu an yeni online kayıt alamıyor. Lütfen randevu için salonu arayın.";
}

/// <summary>Dijital onam hakkı — <see cref="TierEntitlementQuery"/>'nin onam boyutu (geriye dönük ad).</summary>
public static class ConsentEntitlementQuery
{
    public static Task<ConsentEntitlement> EvaluateAsync(GuzellikDbContext db, Guid tenantId, DateTime nowUtc, CancellationToken ct) =>
        TierEntitlementQuery.EvaluateAsync(db, tenantId, TierDimension.ConsentDocuments, nowUtc, ct);

    public static Task<int?> PaidTierAboveAsync(GuzellikDbContext db, Guid tenantId, DateTime nowUtc, CancellationToken ct) =>
        TierEntitlementQuery.PaidTierAboveAsync(db, tenantId, TierDimension.ConsentDocuments, nowUtc, ct);

    public static string LimitMessage(ConsentEntitlement e) => TierEntitlementQuery.LimitMessage(TierDimension.ConsentDocuments, e);
}

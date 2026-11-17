using System.Linq.Expressions;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// FİYATLAMA SAYAÇLARI — kurum genelinde şube, müşteri ve İMZALI dijital onam formu sayısı.
///
/// <para>
/// <b>Sorgu filtreleri bilerek aşılır, TenantId açıkça süzülür.</b> Yenileme tahsilatı arka plan
/// işinden kurum kapsamı OLMADAN çalışır; filtreli DbSet orada 0 sayar ve kurum sessizce eksik
/// ücretlendirilirdi. Silinmişler sayılmaz; pasif / kara listedeki müşteriler kayıtlı müşteridir ve sayılır.
/// </para>
/// <para>
/// ONAM: imzalanmış HER evrak sayılır — sonradan silinmiş olsa da (<see cref="CountsAsSignedConsent"/>).
/// Sayaç hem ücreti hem İMZA KAPISINI belirler; silinen imzalı evrak düşülseydi kurum eski evrakı silip
/// ödemeden kapasite geri kazanabilirdi. Ücret, kapı ve MRR AYNI ifadeyi kullanır.
/// </para>
/// </summary>
public static class BillingCountsQuery
{
    /// <summary>Kotaya giren onam evrakı: imzalanmış (imza anı yazılmış) — silinmiş olsa da.</summary>
    public static readonly Expression<Func<CustomerConsentForm, bool>> CountsAsSignedConsent = f => f.SignedAtUtc != null;

    /// <summary>Kurumun kotaya giren imzalı onam evrakı sayısı (kapsam filtresi dışı, silinmişler dahil).</summary>
    public static Task<int> CountSignedConsentsAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct) =>
        db.CustomerConsentForms.IgnoreQueryFilters().AsNoTracking()
            .Where(f => f.TenantId == tenantId)
            .Where(CountsAsSignedConsent)
            .CountAsync(ct);

    /// <summary>
    /// Kurumun kotaya giren MÜŞTERİ sayısı: silinmemiş kayıtlı müşteri (pasif / kara listedeki dahil).
    /// Stok sayaçtır — KVKK silmesi sayıyı düşürebilmeli. Ücret, müşteri kapısı ve içe aktarma bunu kullanır.
    /// </summary>
    public static Task<int> CountCustomersAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct) =>
        db.Customers.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(c => c.TenantId == tenantId && !c.IsDeleted, ct);

    public static async Task<BillingCounts> CountAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct)
    {
        var branches = await db.Branches.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(b => b.TenantId == tenantId && !b.IsDeleted, ct);
        var customers = await CountCustomersAsync(db, tenantId, ct);
        var consents = await CountSignedConsentsAsync(db, tenantId, ct);
        return new BillingCounts(branches, customers, consents);
    }

    /// <summary>
    /// Çok kurum için tek turda sayaçlar (platform raporu): kurum başına üç sorgu yerine TÜM kurumlar
    /// üzerinde üç gruplu COUNT. Kimlik listesiyle sunucu süzgeci (<c>ids.Contains</c>) BİLEREK YOK —
    /// MySQL sağlayıcısı yerel koleksiyonu çeviremez (500); süzme bellekte yapılır.
    /// </summary>
    public static async Task<Dictionary<Guid, BillingCounts>> CountManyAsync(GuzellikDbContext db, IReadOnlyCollection<Guid> tenantIds, CancellationToken ct)
    {
        if (tenantIds.Count == 0) return new Dictionary<Guid, BillingCounts>();

        var branches = (await db.Branches.IgnoreQueryFilters().AsNoTracking()
                .Where(b => !b.IsDeleted)
                .GroupBy(b => b.TenantId).Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Count);
        var customers = (await db.Customers.IgnoreQueryFilters().AsNoTracking()
                .Where(c => !c.IsDeleted)
                .GroupBy(c => c.TenantId).Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Count);
        var consents = (await db.CustomerConsentForms.IgnoreQueryFilters().AsNoTracking()
                .Where(CountsAsSignedConsent)
                .GroupBy(f => f.TenantId).Select(g => new { g.Key, Count = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.Key, x => x.Count);

        return tenantIds.Distinct().ToDictionary(id => id, id => new BillingCounts(
            branches.GetValueOrDefault(id), customers.GetValueOrDefault(id), consents.GetValueOrDefault(id)));
    }
}

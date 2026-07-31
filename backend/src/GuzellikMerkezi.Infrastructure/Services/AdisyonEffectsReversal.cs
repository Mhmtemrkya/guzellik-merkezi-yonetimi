using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Onaylı bir adisyonun YAN ETKİLERİNİ geri alır / yeniden uygular.
///
/// <para>
/// Adisyon onaylanınca yalnız cariye borç yazılmaz; personel primi tahakkuk eder, sadakat puanı
/// kazanılır, ürün stoktan düşer ve hediye çeki harcanır. Bu etkiler iki ayrı yerde geri alınmalı:
/// adisyon silinirken ve <b>satış iptal edilirken</b>. Satış iptali eskiden yalnız adisyonun
/// statüsünü değiştiriyordu — cari kaybolurken prim ve stok düşümü sistemde kalıyordu.
/// Ortak servis bu ikiliği bitirir.
/// </para>
///
/// <para>
/// TASARIM: prim ve sadakat satırları SİLİNMEZ, soft-delete edilir (bu DbContext'te
/// <c>Remove()</c> zaten soft-delete'e çevrilir). Böylece geri alma, kayıtları sıfırdan yeniden
/// hesaplamak yerine aynı satırları canlandırır — onay anındaki tutarlar birebir korunur.
/// </para>
/// </summary>
public interface IAdisyonEffectsReversal
{
    /// <summary>Prim, sadakat, stok ve kupon etkilerini geri alır (adisyon nesnesi Items ile yüklü olmalı).</summary>
    Task ReverseAsync(Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken = default);

    /// <summary>
    /// <see cref="ReverseAsync"/> ile geri alınan etkileri yeniden uygular (satış iptali geri alınırken).
    /// Stok yeniden düşer, prim/sadakat satırları canlandırılır, kupon yeniden harcanır.
    /// </summary>
    Task ReapplyAsync(Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken = default);
}

public sealed class AdisyonEffectsReversal : IAdisyonEffectsReversal
{
    private readonly GuzellikDbContext _db;
    private readonly IDateTimeProvider _clock;

    public AdisyonEffectsReversal(GuzellikDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private static string ReferenceOf(Adisyon adisyon) => $"ADS-{adisyon.Id:N}"[..16];

    public async Task ReverseAsync(Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken = default)
    {
        var nowUtc = _clock.UtcNow;
        var reference = ReferenceOf(adisyon);

        // 1) Personel primleri — soft-delete (geri almada canlandırılır).
        var commissions = await _db.StaffCommissions
            .Where(c => c.TenantId == tenantId && c.SourceAdisyonId == adisyon.Id)
            .ToListAsync(cancellationToken);
        _db.StaffCommissions.RemoveRange(commissions);

        // 2) Sadakat puanı kazanımları — soft-delete.
        var loyalty = await _db.LoyaltyTransactions
            .Where(l => l.TenantId == tenantId && l.SourceType == "Adisyon" && l.SourceId == adisyon.Id)
            .ToListAsync(cancellationToken);
        _db.LoyaltyTransactions.RemoveRange(loyalty);

        // 3) Ürün satışı → stoğu geri ekle + iade hareketi kaydet.
        foreach (var (item, product) in await ProductLinesAsync(tenantId, adisyon, cancellationToken))
        {
            var qty = Math.Max(1, Math.Round(item.Quantity, 3, MidpointRounding.AwayFromZero));
            product.AdjustStock(StockMovementType.Inbound, qty);
            _db.StockMovements.Add(new StockMovement(
                tenantId, product.Id, StockMovementType.Inbound, qty, nowUtc,
                unitCost: product.Cost, reference: reference,
                notes: "Satış iptali — stok iadesi", staffMemberId: item.StaffMemberId));
        }

        // 4) Hediye çeki / kupon kullanımını geri aç.
        foreach (var discount in adisyon.Items.Where(i => i.Type == AdisyonItemType.Discount && i.RefId.HasValue))
        {
            var card = await _db.GiftCards
                .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == discount.RefId!.Value, cancellationToken);
            card?.UndoRedeem(discount.LineTotal);
        }
    }

    public async Task ReapplyAsync(Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken = default)
    {
        var nowUtc = _clock.UtcNow;
        var reference = ReferenceOf(adisyon);

        // 1) Primleri canlandır — onay anındaki tutarlar korunur (yeniden hesaplanmaz).
        var commissions = await _db.StaffCommissions.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.SourceAdisyonId == adisyon.Id && c.IsDeleted)
            .ToListAsync(cancellationToken);
        foreach (var c in commissions) c.Restore(nowUtc);

        // 2) Sadakat kazanımlarını canlandır.
        var loyalty = await _db.LoyaltyTransactions.IgnoreQueryFilters()
            .Where(l => l.TenantId == tenantId && l.SourceType == "Adisyon" && l.SourceId == adisyon.Id && l.IsDeleted)
            .ToListAsync(cancellationToken);
        foreach (var l in loyalty) l.Restore(nowUtc);

        // 3) Ürünü yeniden stoktan düş.
        foreach (var (item, product) in await ProductLinesAsync(tenantId, adisyon, cancellationToken))
        {
            var qty = Math.Max(1, Math.Round(item.Quantity, 3, MidpointRounding.AwayFromZero));
            product.AdjustStock(StockMovementType.Sale, qty);
            _db.StockMovements.Add(new StockMovement(
                tenantId, product.Id, StockMovementType.Sale, qty, nowUtc,
                unitCost: product.Cost, reference: reference,
                notes: "İptal geri alındı — satış yeniden işlendi", staffMemberId: item.StaffMemberId));
        }

        // 4) Hediye çekini yeniden harca.
        foreach (var discount in adisyon.Items.Where(i => i.Type == AdisyonItemType.Discount && i.RefId.HasValue))
        {
            var card = await _db.GiftCards
                .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == discount.RefId!.Value, cancellationToken);
            card?.Redeem(discount.LineTotal, nowUtc);
        }
    }

    /// <summary>
    /// Adisyondaki ürün kalemleri + karşılık gelen ürün kayıtları.
    /// Guid listesiyle <c>.Contains()</c> MySQL sağlayıcısında SQL'e çevrilemez → bellekte eşlenir.
    /// </summary>
    private async Task<List<(AdisyonItem Item, Product Product)>> ProductLinesAsync(
        Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken)
    {
        var items = adisyon.Items
            .Where(i => i.Type == AdisyonItemType.Product && i.RefId.HasValue && !i.CoveredByPackage)
            .ToList();
        if (items.Count == 0) return [];

        var wanted = items.Select(i => i.RefId!.Value).ToHashSet();
        var products = (await _db.Products.Where(p => p.TenantId == tenantId).ToListAsync(cancellationToken))
            .Where(p => wanted.Contains(p.Id))
            .ToDictionary(p => p.Id);

        var result = new List<(AdisyonItem, Product)>(items.Count);
        foreach (var item in items)
        {
            if (products.TryGetValue(item.RefId!.Value, out var product)) result.Add((item, product));
        }
        return result;
    }
}

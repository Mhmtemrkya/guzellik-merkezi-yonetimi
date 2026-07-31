using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Bir adisyonun ters kaydında NE DEĞİŞTİĞİNİN dökümü. İptal yedeğine (snapshot) yazılır ve
/// "iptali geri al" yalnız buradaki kayıtlara dokunur.
/// <para>
/// Neden gerekli: geri alma eskiden "bu adisyona bağlı TÜM soft-delete prim/sadakat satırlarını
/// canlandır" diyordu. Daha önce BAŞKA bir sebeple pasifleştirilmiş bir prim de böylece
/// diriliyordu. Kapsamı iptalde fiilen değiştirilen Id'lerle sınırlamak bu sızıntıyı kapatır.
/// </para>
/// </summary>
/// <param name="PackageUses">Geri kredilenen seans bakiyeleri: (seans Id, kaç adet).</param>
public sealed record AdisyonReversalRecord(
    Guid AdisyonId,
    IReadOnlyList<Guid> CommissionIds,
    IReadOnlyList<Guid> LoyaltyIds,
    IReadOnlyList<PackageUseCredit> PackageUses)
{
    public static AdisyonReversalRecord Empty(Guid adisyonId) => new(adisyonId, [], [], []);
}

public sealed record PackageUseCredit(Guid SessionId, int Count);

/// <summary>
/// Onaylı bir adisyonun YAN ETKİLERİNİ geri alır / yeniden uygular.
///
/// <para>
/// Adisyon onaylanınca yalnız cariye borç yazılmaz; personel primi tahakkuk eder, sadakat puanı
/// kazanılır, ürün stoktan düşer, hediye çeki harcanır ve başka bir paketin seansı tüketilebilir.
/// Bu etkiler iki ayrı yerde geri alınmalı: adisyon silinirken ve <b>satış iptal edilirken</b>.
/// Satış iptali eskiden yalnız adisyonun statüsünü değiştiriyordu — cari kaybolurken personel
/// primi ve stok düşümü sistemde kalıyordu. Ortak servis bu ikiliği bitirir.
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
    /// <summary>
    /// Prim, sadakat, stok, kupon ve paket-kullanımı etkilerini geri alır (adisyon nesnesi Items
    /// ile yüklü olmalı). Dönen döküm yedeğe yazılıp <see cref="ReapplyAsync"/>'e geri verilir.
    /// </summary>
    Task<AdisyonReversalRecord> ReverseAsync(Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken = default);

    /// <summary>
    /// <see cref="ReverseAsync"/> ile geri alınan etkileri yeniden uygular (satış iptali geri alınırken).
    /// <paramref name="record"/> null ise (yedeği bu alan eklenmeden önce yazılmış eski iptaller)
    /// adisyona bağlı tüm pasif prim/sadakat satırlarına düşülür.
    /// </summary>
    Task ReapplyAsync(Guid tenantId, Adisyon adisyon, AdisyonReversalRecord? record, CancellationToken cancellationToken = default);
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

    public async Task<AdisyonReversalRecord> ReverseAsync(Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken = default)
    {
        var nowUtc = _clock.UtcNow;
        var reference = ReferenceOf(adisyon);

        // 1) Personel primleri — soft-delete (geri almada canlandırılır).
        //    ÖDENMİŞ prim dokunulmaz: karşılığında zaten bir gider (prim ödemesi) yazılmıştır;
        //    primi silmek gideri yerinde bırakıp prim raporuyla kasayı çelişkiye düşürürdü.
        var commissions = await _db.StaffCommissions
            .Where(c => c.TenantId == tenantId && c.SourceAdisyonId == adisyon.Id)
            .ToListAsync(cancellationToken);
        var reversedCommissions = commissions.Where(c => !c.IsPaid).ToList();
        _db.StaffCommissions.RemoveRange(reversedCommissions);

        // 2) Sadakat puanı hareketleri — soft-delete.
        //    Kazanım geri alınırken müşteri o puanı harcamış olabilir; bakiyeyi eksiye düşürecek
        //    kazanıma DOKUNULMAZ (puan bakiyesi negatif olamaz).
        var loyalty = await _db.LoyaltyTransactions
            .Where(l => l.TenantId == tenantId && l.SourceType == "Adisyon" && l.SourceId == adisyon.Id)
            .ToListAsync(cancellationToken);
        var reversedLoyalty = new List<LoyaltyTransaction>(loyalty.Count);
        if (loyalty.Count > 0)
        {
            var balance = await _db.LoyaltyTransactions
                .Where(l => l.TenantId == tenantId && l.CustomerId == adisyon.CustomerId)
                .SumAsync(l => (int?)l.Points, cancellationToken) ?? 0;

            // Küçük kazanımdan başla: bakiye yetmiyorsa mümkün olan en çoğu geri alınsın.
            foreach (var row in loyalty.OrderBy(l => l.Points))
            {
                if (balance - row.Points < 0) continue;
                balance -= row.Points;
                reversedLoyalty.Add(row);
            }
            _db.LoyaltyTransactions.RemoveRange(reversedLoyalty);
        }

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

        // 5) Paket kullanımı — bu adisyon BAŞKA bir paketin seansını tükettiyse geri kredile.
        //    Eksikti: satış iptal ediliyor ama müşterinin başka paketinden düşen seans düşük kalıyordu.
        var packageUses = await CreditPackageUsesAsync(tenantId, adisyon, cancellationToken);

        return new AdisyonReversalRecord(
            adisyon.Id,
            reversedCommissions.Select(c => c.Id).ToList(),
            reversedLoyalty.Select(l => l.Id).ToList(),
            packageUses);
    }

    public async Task ReapplyAsync(Guid tenantId, Adisyon adisyon, AdisyonReversalRecord? record, CancellationToken cancellationToken = default)
    {
        var nowUtc = _clock.UtcNow;
        var reference = ReferenceOf(adisyon);

        // 1) Primleri canlandır — onay anındaki tutarlar korunur (yeniden hesaplanmaz).
        //    Kapsam: yalnız iptalde pasifleştirilen Id'ler. Döküm yoksa (eski yedek) adisyonun
        //    tüm pasif primleri — eski davranış korunur, aksi hâlde geri alma hiçbir şey yapmazdı.
        var commissions = await _db.StaffCommissions.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.SourceAdisyonId == adisyon.Id && c.IsDeleted)
            .ToListAsync(cancellationToken);
        foreach (var c in Scope(commissions, record?.CommissionIds)) c.Restore(nowUtc);

        // 2) Sadakat hareketlerini canlandır.
        var loyalty = await _db.LoyaltyTransactions.IgnoreQueryFilters()
            .Where(l => l.TenantId == tenantId && l.SourceType == "Adisyon" && l.SourceId == adisyon.Id && l.IsDeleted)
            .ToListAsync(cancellationToken);
        foreach (var l in Scope(loyalty, record?.LoyaltyIds)) l.Restore(nowUtc);

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

        // 5) Geri kredilenen paket seanslarını yeniden tüket — AYNI seans kaydından, aynı adette.
        foreach (var use in record?.PackageUses ?? [])
        {
            // Seans, iptal edilen satışın kendi seansı olabilir: geri almada henüz KAYDEDİLMEMİŞ
            // (Added) durumdadır ve DB sorgusu onu bulamaz → önce izlenen nesnelere bakılır.
            var session = _db.CustomerPackageSessions.Local.FirstOrDefault(s => s.Id == use.SessionId)
                ?? await _db.CustomerPackageSessions
                    .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == use.SessionId, cancellationToken);
            if (session is null) continue;
            for (var k = 0; k < use.Count; k++)
            {
                if (!session.TryConsume()) break;
            }
        }
    }

    /// <summary>
    /// Döküm varsa yalnız oradaki Id'ler, yoksa listenin tamamı (eski yedeklerle uyum).
    /// </summary>
    private static IEnumerable<T> Scope<T>(List<T> rows, IReadOnlyList<Guid>? ids) where T : Entity
    {
        if (ids is null) return rows;
        var wanted = ids.ToHashSet();
        return rows.Where(r => wanted.Contains(r.Id));
    }

    /// <summary>
    /// Adisyondaki "paketten kullan" kalemlerinin tükettiği seansları geri verir.
    /// Adayları TEK sorguda belleğe alır: aynı sorguyu döngü içinde tekrarlamak, henüz kaydedilmemiş
    /// (UsedSessions düşürülmüş) satırı DB hâlâ dolu gördüğü için ikinci kez seçip sayacı şişiriyordu.
    /// </summary>
    private async Task<List<PackageUseCredit>> CreditPackageUsesAsync(
        Guid tenantId, Adisyon adisyon, CancellationToken cancellationToken)
    {
        var items = adisyon.Items.Where(i => i.Type == AdisyonItemType.PackageUse && i.RefId.HasValue).ToList();
        if (items.Count == 0) return [];

        var candidates = await _db.CustomerPackageSessions
            .Where(s => s.TenantId == tenantId && s.CustomerId == adisyon.CustomerId)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0) return [];

        // En son kullanılan seanstan geri al (adisyonun tükettiği büyük olasılıkla odur).
        candidates = candidates.OrderByDescending(s => s.UpdatedAtUtc ?? s.CreatedAtUtc).ToList();

        var credits = new Dictionary<Guid, int>();
        foreach (var item in items)
        {
            var qty = (int)Math.Max(1, Math.Round(item.Quantity, MidpointRounding.AwayFromZero));
            for (var k = 0; k < qty; k++)
            {
                var session = candidates.FirstOrDefault(
                    s => s.ServiceDefinitionId == item.RefId!.Value && s.UsedSessions > 0);
                if (session is null) break;
                session.RestoreOne();
                credits[session.Id] = credits.GetValueOrDefault(session.Id) + 1;
            }
        }

        return credits.Select(kv => new PackageUseCredit(kv.Key, kv.Value)).ToList();
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

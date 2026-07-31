using GuzellikMerkezi.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// İPTAL EDİLEN SATIŞLARIN RAPORLARA BESLENMESİ.
/// <para>
/// İptal edilen satışın cari/seans satırları canlı tablolarda YOKTUR — <c>cancelled_sales</c>
/// arşivine taşınmıştır. Raporların "İptal Edilen" kartları bu satırları saymaya devam edebilsin
/// diye arşiv, mevcut <see cref="AccountRow"/>/<see cref="SessionRow"/> tiplerine dönüştürülüp
/// yükleyicilerin sonucuna eklenir; <c>CancelledAtUtc</c> dolu gelir.
/// </para>
/// <para>
/// Böylece çağıran taraf DEĞİŞMEZ: <c>Where(a =&gt; a.CancelledAtUtc == null)</c> yazan yollar
/// (ciro, personel karnesi, şube kıyası) bu satırları eler; iptal sayacı ise onları görür.
/// </para>
/// </summary>
public sealed partial class ReportsService
{
    private sealed record CancelledArchive(List<AccountRow> Accounts, List<SessionRow> Sessions);

    /// <summary>Aynı istek içinde birden çok yükleyici çağırdığı için tek seferlik önbelleklenir.</summary>
    private readonly Dictionary<(Guid TenantId, bool CrossBranch), CancelledArchive> _cancelledArchiveCache = new();

    private async Task<CancelledArchive> LoadCancelledArchiveAsync(Guid tenantId, bool crossBranch, CancellationToken ct)
    {
        if (_cancelledArchiveCache.TryGetValue((tenantId, crossBranch), out var cached)) return cached;

        var query = crossBranch
            ? _db.CancelledSales.AsNoTracking().IgnoreQueryFilters().Where(x => !x.IsDeleted && x.TenantId == tenantId)
            : _db.CancelledSales.AsNoTracking().Where(x => x.TenantId == tenantId);

        var rows = await query
            .Where(x => x.RestoredAtUtc == null)
            .Select(x => new
            {
                x.OriginalAccountId, x.BranchId, x.CustomerId, x.ServicePackageId, x.Name, x.TotalAmount,
                x.SoldAtUtc, x.CancelledAtUtc, x.SoldByStaffMemberId, x.CreatedBy, x.Snapshot,
            })
            .ToListAsync(ct);

        var accounts = new List<AccountRow>(rows.Count);
        var sessions = new List<SessionRow>();

        if (rows.Count > 0)
        {
            // Hizmet adı/kategorisi yedeğe kopyalanmaz (ŞİFRELİ kolonlar, PII kopyasını çoğaltmamak
            // için) — katalogdan çözülür. Guid listesiyle .Contains() MySQL sağlayıcısında SQL'e
            // çevrilemediğinden kurumun hizmetleri çekilip bellekte eşlenir.
            var serviceMeta = (await _db.ServiceDefinitions.AsNoTracking()
                    .Where(s => s.TenantId == tenantId)
                    .Select(s => new { s.Id, s.Name, s.Category, s.SubCategory })
                    .ToListAsync(ct))
                .ToDictionary(s => s.Id, s => (s.Name, s.Category, s.SubCategory));

            foreach (var row in rows)
            {
                var snapshot = SaleSnapshotReader.Parse(row.Snapshot);
                var createdAt = snapshot?.Account.CreatedAtUtc ?? row.CancelledAtUtc;

                accounts.Add(new AccountRow(
                    row.OriginalAccountId, row.BranchId, row.CustomerId, row.ServicePackageId,
                    row.Name ?? string.Empty, row.TotalAmount,
                    EffectiveSoldAt(row.SoldAtUtc, createdAt),
                    row.CancelledAtUtc, row.SoldByStaffMemberId, row.CreatedBy));

                if (snapshot is null) continue;
                foreach (var s in snapshot.Sessions)
                {
                    var meta = serviceMeta.TryGetValue(s.ServiceDefinitionId, out var m) ? m : (Name: "Hizmet", Category: (string?)null, SubCategory: (string?)null);
                    sessions.Add(new SessionRow(
                        row.OriginalAccountId, row.CustomerId, s.ServicePackageId, s.ServiceDefinitionId,
                        string.IsNullOrWhiteSpace(meta.Name) ? "Hizmet" : meta.Name,
                        meta.Category, meta.SubCategory,
                        s.TotalSessions, s.UsedSessions, s.CreatedAtUtc));
                }
            }
        }

        var archive = new CancelledArchive(accounts, sessions);
        _cancelledArchiveCache[(tenantId, crossBranch)] = archive;
        return archive;
    }
}

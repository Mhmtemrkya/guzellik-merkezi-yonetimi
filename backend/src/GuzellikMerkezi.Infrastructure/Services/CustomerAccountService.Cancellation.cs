using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using SaleSnapshot = GuzellikMerkezi.Infrastructure.Services.SaleSnapshotReader.SaleSnapshot;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Satış iptali = arşive taşıma. Bu dosya, silinen satırların yedeğini geri kuran ve arşivi
/// raporlara besleyen yardımcıları taşır (bkz. <see cref="CustomerAccountService.CancelSaleAsync"/>).
/// Yedeğin JSON şeması ortak <see cref="SaleSnapshotReader"/>'dadır — raporlar da aynı şemayı okur.
/// </summary>
public sealed partial class CustomerAccountService
{
    private static DateTime Utc(DateTime value) => SaleSnapshotReader.Utc(value);

    private static DateTime? Utc(DateTime? value) => SaleSnapshotReader.Utc(value);

    private static string BuildSaleSnapshot(
        CustomerAccount account,
        IReadOnlyList<CustomerPackageSession> sessions,
        IReadOnlyList<Adisyon> adisyonlar) => SaleSnapshotReader.Build(account, sessions, adisyonlar);

    private static SaleSnapshot? ParseSaleSnapshot(string json) => SaleSnapshotReader.Parse(json);

    /// <summary>
    /// Yedekteki satırları AYNI Id'lerle yeniden ekler. Id/Status gibi alanlar entity'de
    /// <c>protected set</c> olduğundan EF'in <see cref="Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry"/>
    /// property erişimiyle yazılır — domain'e yalnız geri yükleme için setter açmaya gerek kalmaz.
    /// </summary>
    private RebuiltSale RebuildFromSnapshot(Guid tenantId, Guid accountId, SaleSnapshot snapshot)
    {
        var a = snapshot.Account;

        var account = new CustomerAccount(
            tenantId, a.BranchId, a.CustomerId, a.ServicePackageId, a.Name, a.TotalAmount, a.DepositAmount);
        account.SetNotes(a.Notes);
        account.SetSaleInfo(Utc(a.SoldAtUtc), a.SoldByStaffMemberId, a.IsHistorical);
        account.SetAppliedBy(a.AppliedByStaffMemberId);
        if (a.IsActive) account.Activate(); else account.Deactivate();

        _db.CustomerAccounts.Add(account);
        _db.Entry(account).Property(x => x.Id).CurrentValue = accountId;

        var installments = new List<Installment>(snapshot.Installments.Count);
        foreach (var i in snapshot.Installments)
        {
            var installment = new Installment(accountId, i.No, i.DueDate, i.Amount);
            _db.Installments.Add(installment);
            var entry = _db.Entry(installment);
            entry.Property(x => x.Id).CurrentValue = i.Id;
            entry.Property(x => x.Status).CurrentValue =
                Enum.TryParse<InstallmentStatus>(i.Status, out var status) ? status : InstallmentStatus.Planned;
            entry.Property(x => x.PaidAtUtc).CurrentValue = Utc(i.PaidAtUtc);
            installments.Add(installment);
        }

        var payments = new List<AccountPayment>(snapshot.Payments.Count);
        foreach (var p in snapshot.Payments)
        {
            var payment = new AccountPayment(accountId, p.Amount, p.Method, p.Reference, Utc(p.OccurredAtUtc));
            _db.AccountPayments.Add(payment);
            _db.Entry(payment).Property(x => x.Id).CurrentValue = p.Id;
            payments.Add(payment);
        }

        var sessions = new List<CustomerPackageSession>(snapshot.Sessions.Count);
        foreach (var s in snapshot.Sessions)
        {
            var session = new CustomerPackageSession(
                tenantId, a.CustomerId, accountId, s.ServicePackageId, s.ServiceDefinitionId, s.TotalSessions, s.SourceAdisyonId);
            _db.CustomerPackageSessions.Add(session);
            var entry = _db.Entry(session);
            entry.Property(x => x.Id).CurrentValue = s.Id;
            entry.Property(x => x.UsedSessions).CurrentValue = s.UsedSessions;
            sessions.Add(session);
        }

        return new RebuiltSale(account, installments, payments, sessions);
    }

    /// <summary>Geri yüklenen satırlar — oluşturma damgalarını düzeltmek için tutulur.</summary>
    private sealed record RebuiltSale(
        CustomerAccount Account,
        List<Installment> Installments,
        List<AccountPayment> Payments,
        List<CustomerPackageSession> Sessions);

    /// <summary>
    /// ApplyAuditInfo, EKLENEN her satırın <c>CreatedAtUtc</c>/<c>CreatedBy</c> alanlarını "şimdi" ve
    /// "geri yükleyen kullanıcı" yapar. Geri yüklenen satış için ikisi de yanlıştır: dönem raporları
    /// satış tarihi boşsa kayıt tarihine düşer ve "kim sattı" düşümü <c>CreatedBy</c>'a bakar.
    /// <para>
    /// İlk SaveChanges'ten SONRA çağrılır: satırlar artık Modified olduğu için ApplyAuditInfo yalnız
    /// <c>Touch()</c> uygular ve buradaki orijinal damgalar korunur. (ExecuteUpdate kullanılmaz —
    /// ilişkisel sağlayıcıya özeldir, birim testleri InMemory üzerinde çalışır.)
    /// </para>
    /// </summary>
    private static void ApplyOriginalTimestamps(RebuiltSale rebuilt, SaleSnapshot snapshot)
    {
        rebuilt.Account.MarkCreated(Utc(snapshot.Account.CreatedAtUtc), snapshot.Account.CreatedBy);

        for (var i = 0; i < rebuilt.Installments.Count; i++)
            rebuilt.Installments[i].MarkCreated(Utc(snapshot.Installments[i].CreatedAtUtc));
        for (var i = 0; i < rebuilt.Payments.Count; i++)
            rebuilt.Payments[i].MarkCreated(Utc(snapshot.Payments[i].CreatedAtUtc));
        for (var i = 0; i < rebuilt.Sessions.Count; i++)
            rebuilt.Sessions[i].MarkCreated(Utc(snapshot.Sessions[i].CreatedAtUtc));
    }

    /// <summary>
    /// Bu cari iptal edilip arşive mi taşındı? Silinmiş bir hesaba işlem denendiğinde kullanıcıya
    /// "bulunamadı" yerine gerçek sebebi söyleyebilmek için kullanılır.
    /// </summary>
    private Task<bool> IsArchivedAsync(Guid tenantId, Guid accountId, CancellationToken ct) =>
        _db.CancelledSales.AsNoTracking()
            .AnyAsync(x => x.TenantId == tenantId && x.OriginalAccountId == accountId && x.RestoredAtUtc == null, ct);

    /// <summary>
    /// Verilen işi TEK transaction içinde çalıştırır: iptal/geri alma birden çok SaveChanges
    /// gerektirir (FK sırası) ve arada bağlantı koparsa yarım kalmış bir durum kalırdı —
    /// ör. arşiv kaydı oluşmuş ama canlı cari hâlâ dururken.
    /// <para>
    /// InMemory sağlayıcı transaction desteklemez (birim testleri onu kullanır); orada iş
    /// doğrudan çalıştırılır. Zaten süren bir transaction varsa yenisi açılmaz.
    /// </para>
    /// </summary>
    private async Task<T> InTransactionAsync<T>(Func<Task<T>> work, CancellationToken ct)
    {
        if (!_db.Database.IsRelational() || _db.Database.CurrentTransaction is not null)
            return await work();

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            var result = await work();
            await tx.CommitAsync(ct);
            return result;
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    /// <summary>
    /// İptal edilecek cariyi SATIR KİLİDİYLE okur ve aynı satış için zaten aktif bir arşiv
    /// kaydı varsa false döner.
    /// <para>
    /// İki kullanıcı aynı satışı aynı anda iptal ederse ikisi de cariyi silinmeden okuyabilir ve
    /// çift arşiv kaydı / yarım kalmış istek oluşurdu. <c>FOR UPDATE</c> ikinci isteği ilkinin
    /// commit'ine kadar bekletir; sonra aktif arşiv kontrolü onu nazikçe reddeder.
    /// </para>
    /// </summary>
    private async Task<bool> TryLockForCancelAsync(Guid tenantId, Guid accountId, CancellationToken ct)
    {
        if (_db.Database.IsRelational())
        {
            // Guid kolonu char(36): parametre olarak string geçilir.
            var rows = await _db.Database.SqlQueryRaw<Guid>(
                    "SELECT Id AS Value FROM customer_accounts WHERE Id = {0} AND TenantId = {1} FOR UPDATE",
                    accountId.ToString(), tenantId.ToString())
                .ToListAsync(ct);
            if (rows.Count == 0) return false;
        }

        // Kilit alındıktan sonra bak: bu satış zaten arşivlenmiş mi?
        return !await _db.CancelledSales
            .AnyAsync(x => x.TenantId == tenantId && x.OriginalAccountId == accountId && x.RestoredAtUtc == null, ct);
    }

    /// <summary>
    /// Rapor kartlarındaki "İptal Edilen" sayacı için arşiv özeti. İptal edilen satışın satırları
    /// canlı tablolarda YOKTUR; paket/hizmet kırılımı yalnızca yedekteki seans listesinden çıkar.
    /// </summary>
    /// <param name="SoldAt">Dönem süzgecinin baktığı tarih (satış tarihi yoksa kayıt tarihi).</param>
    /// <param name="Sessions">İptal edilen satıştaki (paket, hizmet) çiftleri.</param>
    private sealed record CancelledSaleSummary(
        Guid OriginalAccountId,
        Guid? ServicePackageId,
        DateTime SoldAt,
        IReadOnlyList<(Guid PackageId, Guid ServiceId)> Sessions);

    /// <summary>
    /// Arşivdeki (geri alınmamış) iptalleri dönem süzgeciyle okur. Dönem karşılaştırması BELLEKTE
    /// yapılır: satış tarihi boş kalan eski kayıtlarda yedekteki kayıt tarihine düşülmesi gerekir
    /// ve yedek şifreli kolonda olduğu için SQL'de süzülemez.
    /// </summary>
    private async Task<List<CancelledSaleSummary>> LoadCancelledSummariesAsync(
        Guid tenantId, DateTime? fromUtc, DateTime? toUtc, CancellationToken ct)
    {
        var rows = await _db.CancelledSales.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RestoredAtUtc == null)
            .Select(x => new { x.OriginalAccountId, x.ServicePackageId, x.SoldAtUtc, x.Snapshot })
            .ToListAsync(ct);

        var result = new List<CancelledSaleSummary>(rows.Count);
        foreach (var row in rows)
        {
            var snapshot = ParseSaleSnapshot(row.Snapshot);
            var soldAt = row.SoldAtUtc >= LegacySoldAtThreshold
                ? row.SoldAtUtc
                : snapshot?.Account.CreatedAtUtc ?? row.SoldAtUtc;

            if (fromUtc.HasValue && soldAt < fromUtc.Value) continue;
            if (toUtc.HasValue && soldAt >= toUtc.Value) continue;

            var sessions = snapshot?.Sessions
                .Select(s => (s.ServicePackageId, s.ServiceDefinitionId))
                .ToList() ?? new List<(Guid, Guid)>();

            result.Add(new CancelledSaleSummary(row.OriginalAccountId, row.ServicePackageId, soldAt, sessions));
        }
        return result;
    }

}

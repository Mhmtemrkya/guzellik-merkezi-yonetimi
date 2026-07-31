using GuzellikMerkezi.Application.Common;
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
        IReadOnlyList<Adisyon> adisyonlar,
        IReadOnlyDictionary<Guid, (AdisyonStatus Status, DateTime? ApprovedAtUtc)> adisyonStatuses,
        IReadOnlyList<AdisyonReversalRecord> reversals,
        IReadOnlyList<Guid> cancelledAppointmentIds) =>
        SaleSnapshotReader.Build(account, sessions, adisyonlar, adisyonStatuses, reversals, cancelledAppointmentIds);

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
        // Önceki geri almalarda korunmuş iadeler kümülatiftir; yoksa (eski yedek) 0 gelir.
        account.SetRefundedAmount(a.RefundedAmount);
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
    /// Başarısız <see cref="Result{TValue}"/> de geri alınır: iş yarıda "hata" dönerse o ana kadar
    /// yazılanlar commit edilmemeli (ör. arşiv yazıldı ama doğrulama sonradan patladı).
    /// </para>
    /// <para>
    /// Zaten süren bir transaction varsa (servis dışarıdan bir işlemin içinde çağrılırsa) SAVEPOINT
    /// açılır; hata/başarısızlıkta yalnız buradaki değişiklikler geri alınır. Savepoint olmadan dış
    /// çağıran hatayı yutup commit ederse yarım kalmış bir iptal kalıcı olurdu.
    /// InMemory sağlayıcı transaction desteklemez (birim testleri onu kullanır) → iş doğrudan çalışır.
    /// </para>
    /// </summary>
    private async Task<Result<TValue>> InTransactionAsync<TValue>(Func<Task<Result<TValue>>> work, CancellationToken ct)
    {
        if (!_db.Database.IsRelational()) return await work();

        if (_db.Database.CurrentTransaction is { } outer)
        {
            if (!outer.SupportsSavepoints) return await work();

            var savepoint = "sp_cancel_" + Guid.NewGuid().ToString("N")[..12];
            await outer.CreateSavepointAsync(savepoint, ct);
            try
            {
                var nested = await work();
                if (nested.IsFailure) await outer.RollbackToSavepointAsync(savepoint, ct);
                else await outer.ReleaseSavepointAsync(savepoint, ct);
                return nested;
            }
            catch
            {
                await outer.RollbackToSavepointAsync(savepoint, ct);
                throw;
            }
            // NOT: burada ChangeTracker TEMİZLENMEZ. Temizlemek dış transaction'ın HENÜZ
            // KAYDEDİLMEMİŞ değişikliklerini de detach edip sessizce kaybettirirdi. Savepoint'e
            // dönen çağıran, bu akışın dokunduğu satırları kendisi yeniden yüklemelidir.
            // (Kendi transaction'ımızı açtığımız yolda temizlemek güvenlidir — orada bize ait
            // olmayan izlenen değişiklik yoktur.)
        }

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            var result = await work();
            if (result.IsFailure)
            {
                await tx.RollbackAsync(ct);
                _db.ChangeTracker.Clear();
                return result;
            }
            await tx.CommitAsync(ct);
            return result;
        }
        catch
        {
            await tx.RollbackAsync(ct);
            _db.ChangeTracker.Clear();
            throw;
        }
    }

    private enum CancelLockState { Locked, NotFound, AlreadyArchived }

    /// <summary>
    /// İptal edilecek cari satırını <c>FOR UPDATE</c> ile kilitler.
    /// <para>
    /// İki kullanıcı aynı satışı aynı anda iptal ederse ikisi de cariyi silinmeden okuyabilir ve
    /// çift arşiv kaydı / yarım kalmış istek oluşurdu. Kilit ikinci isteği ilkinin commit'ine kadar
    /// bekletir; sonra aktif arşiv kontrolü onu nazikçe reddeder.
    /// </para>
    /// <para>
    /// KRİTİK: çağıran cariyi bu kilitten SONRA okumalıdır. Kilit öncesi okunan tutarlar araya giren
    /// bir tahsilatı kaçırır ve o tahsilat yedeğe girmeden kalıcı olarak silinirdi.
    /// </para>
    /// </summary>
    private async Task<CancelLockState> LockForCancelAsync(Guid tenantId, Guid accountId, CancellationToken ct)
    {
        if (_db.Database.IsRelational())
        {
            // Guid kolonu char(36): parametre olarak string geçilir.
            var rows = await _db.Database.SqlQueryRaw<Guid>(
                    "SELECT Id AS Value FROM customer_accounts WHERE Id = {0} AND TenantId = {1} AND IsDeleted = 0 FOR UPDATE",
                    accountId.ToString(), tenantId.ToString())
                .ToListAsync(ct);
            if (rows.Count == 0)
            {
                return await IsArchivedAsync(tenantId, accountId, ct)
                    ? CancelLockState.AlreadyArchived
                    : CancelLockState.NotFound;
            }
        }

        // Kilit alındıktan sonra bak: bu satış zaten arşivlenmiş mi?
        return await _db.CancelledSales
            .AnyAsync(x => x.TenantId == tenantId && x.OriginalAccountId == accountId && x.RestoredAtUtc == null, ct)
            ? CancelLockState.AlreadyArchived
            : CancelLockState.Locked;
    }

    /// <summary>
    /// İptal edilen satıştan doğan ve BAŞKA hiçbir paketten karşılanmayan aktif randevuları kapatır
    /// (Planlandı/Onaylandı/Taslak). Kapatılan Id'ler yedeğe yazılır; geri alma yalnız onları canlandırır.
    /// <para>
    /// Neden gerekli: satış ve seans bakiyeleri iptal ediliyor ama randevu takvimde kalıyordu —
    /// personel karşılığı olmayan bir işe gidiyordu. Tamamlanmış/iptal randevulara DOKUNULMAZ.
    /// </para>
    /// <para>
    /// Neden "karşılıksız" süzgeci: müşterinin aynı hizmet için başka bir paketi hâlâ duruyorsa
    /// randevusu geçerlidir; hepsini silmek iptal edilmeyen bir satışın randevusunu da götürürdü.
    /// </para>
    /// </summary>
    /// <remarks>
    /// SINIR: bu sistemde randevu bir satışa/seansa REZERVE EDİLMEZ (Appointment'ta böyle bir bağ
    /// yok); seans ancak randevu "Tamamlandı" olunca düşer. Bu yüzden eşleştirme kaçınılmaz olarak
    /// sezgiseldir ve bilerek TEMKİNLİ tutulur — şüphede randevu KORUNUR:
    /// <list type="bullet">
    ///   <item>Ücretli randevuya (Price &gt; 0) dokunulmaz: müşteri nakit ödeyecek demektir,
    ///         iptal edilen paketle ilgisi yoktur.</item>
    ///   <item>Başka paketten kalan seans SAYISI kadar randevu korunur (en yakın tarihliler);
    ///         yalnız fazlası kapatılır. Eskiden tek bir kalan seans, aynı hizmete ait 5 randevunun
    ///         tamamını koruyordu.</item>
    /// </list>
    /// </remarks>
    private async Task<List<Guid>> CancelOrphanAppointmentsAsync(
        Guid tenantId,
        Guid customerId,
        Guid accountId,
        IReadOnlyList<CustomerPackageSession> cancelledSessions,
        CancellationToken ct)
    {
        var soldServiceIds = cancelledSessions.Select(s => s.ServiceDefinitionId).ToHashSet();
        if (soldServiceIds.Count == 0) return [];

        // Bu satış dışında kalan seans bakiyeleri — hizmet başına KAÇ seans kaldığı önemli.
        var remainingElsewhere = (await _db.CustomerPackageSessions
                .Where(s => s.TenantId == tenantId && s.CustomerId == customerId && s.CustomerAccountId != accountId)
                .Select(s => new { s.ServiceDefinitionId, s.TotalSessions, s.UsedSessions })
                .ToListAsync(ct))
            .GroupBy(s => s.ServiceDefinitionId)
            .ToDictionary(g => g.Key, g => g.Sum(s => Math.Max(0, s.TotalSessions - s.UsedSessions)));

        // Guid listesi .Contains() MySQL'de çevrilemez → müşteri+durum sunucuda, hizmet bellekte süzülür.
        var candidates = (await _db.Appointments
                .Where(a => a.TenantId == tenantId && a.CustomerId == customerId
                            && (a.Status == AppointmentStatus.Scheduled
                                || a.Status == AppointmentStatus.Confirmed
                                || a.Status == AppointmentStatus.Draft))
                .ToListAsync(ct))
            // Ücretli randevu paketten karşılanmıyor → satış iptali onu ilgilendirmez.
            .Where(a => a.Price <= 0m && soldServiceIds.Contains(a.ServiceDefinitionId))
            .ToList();
        if (candidates.Count == 0) return [];

        var doomed = new List<Appointment>();
        foreach (var group in candidates.GroupBy(a => a.ServiceDefinitionId))
        {
            var keep = remainingElsewhere.TryGetValue(group.Key, out var left) ? left : 0;
            // En yakın tarihliler korunur; kalan seansla karşılanamayanlar kapatılır.
            doomed.AddRange(group.OrderBy(a => a.StartUtc).Skip(keep));
        }
        if (doomed.Count == 0) return [];

        // Soft-delete (HardDeleteEnabled açılmadan önce çalışır) → geri almada Restore() ile canlanır.
        _db.Appointments.RemoveRange(doomed);
        return doomed.Select(a => a.Id).ToList();
    }

    /// <summary>
    /// İptalde değiştirilecek YAN ETKİ satırlarını ortak protokolle kilitler (bkz. <see cref="RowLock"/>).
    /// <para>
    /// Kilit yalnız caride olduğu için eşzamanlı bir satış/onay ile iptal birbirinin stok, kupon,
    /// seans ve sadakat güncellemesini eziyordu. Sıra adisyon onayıyla AYNIDIR → deadlock olmaz.
    /// </para>
    /// </summary>
    private async Task LockSideEffectRowsAsync(
        Guid customerId,
        IEnumerable<Guid> adisyonIds,
        IEnumerable<Guid> productIds,
        IEnumerable<Guid> giftCardIds,
        IEnumerable<Guid> sessionIds,
        CancellationToken ct)
    {
        // Müşteri satırı: sadakat BAKİYESİ bir toplam olduğu için tek satır kilitlenemez; aynı
        // müşterinin iki işlemi burada serileşir ve puan eksiye düşemez.
        await RowLock.LockRowAsync(_db, "customers", customerId, ct);
        await RowLock.LockRowsAsync(_db, "adisyonlar", adisyonIds, ct);
        await RowLock.LockRowsAsync(_db, "products", productIds, ct);
        await RowLock.LockRowsAsync(_db, "gift_cards", giftCardIds, ct);
        await RowLock.LockRowsAsync(_db, "customer_package_sessions", sessionIds, ct);
    }

    /// <summary>
    /// Geri alınacak ARŞİV satırını kilitler ve Id'sini döner (bulunamazsa null).
    /// <para>
    /// İptalde olduğu gibi burada da yarış vardı: iki eşzamanlı "iptali geri al" isteği arşivi aktif
    /// görüp ikisi de cariyi AYNI Id ile yeniden eklemeye çalışıyor, biri duplicate-key hatası
    /// alıyordu. <c>FOR UPDATE</c> ikinciyi bekletir; kilit sonrası okuma onu nazikçe reddeder.
    /// </para>
    /// </summary>
    private async Task<Guid?> LockArchiveForRestoreAsync(Guid tenantId, Guid id, CancellationToken ct)
    {
        if (_db.Database.IsRelational())
        {
            var locked = await _db.Database.SqlQueryRaw<Guid>(
                    "SELECT Id AS Value FROM cancelled_sales " +
                    "WHERE TenantId = {1} AND IsDeleted = 0 AND RestoredAtUtc IS NULL " +
                    "AND (Id = {0} OR OriginalAccountId = {0}) " +
                    "ORDER BY CancelledAtUtc DESC FOR UPDATE",
                    id.ToString(), tenantId.ToString())
                .ToListAsync(ct);
            return locked.Count == 0 ? null : locked[0];
        }

        // InMemory (birim testleri): kilit yok, seçim mantığı aynı kalsın.
        var row = await _db.CancelledSales.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RestoredAtUtc == null && (x.Id == id || x.OriginalAccountId == id))
            .OrderByDescending(x => x.CancelledAtUtc)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(ct);
        return row;
    }

    /// <summary>
    /// Silinecek tahsilatların KALICI defter kopyasını üretir.
    /// <para>
    /// Cari silinince <c>account_payments</c> cascade ile gider; gelir raporları yalnız canlı
    /// satırları okuduğu için geçmişte tahsil edilen para sıfırlanıyor, üstüne iade gider yazılınca
    /// net kasa EKSİYE düşüyordu. Bu kopya sayesinde tahsilat defterden silinmez, yer değiştirir.
    /// </para>
    /// </summary>
    private static List<ArchivedSalePayment> BuildArchivedPayments(
        Guid tenantId, CancelledSale archive, CustomerAccount account) =>
        account.Payments
            .Select(p => new ArchivedSalePayment(
                tenantId, account.BranchId, archive.Id, account.Id, p.Id, account.CustomerId,
                account.Name, p.Amount, p.Method, p.Reference, Utc(p.OccurredAtUtc)))
            .ToList();

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

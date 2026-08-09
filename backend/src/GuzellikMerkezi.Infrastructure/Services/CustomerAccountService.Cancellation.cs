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
    /// <param name="legacyPrices">
    /// Snapshot'ta donmuş fiyatı OLMAYAN hizmetler için tamamlayıcı katalog fiyatları
    /// (migration öncesi arşivler). Boş sözlük = tamamlanacak bir şey yok.
    /// </param>
    private RebuiltSale RebuildFromSnapshot(
        Guid tenantId, Guid accountId, SaleSnapshot snapshot, IReadOnlyDictionary<Guid, decimal> legacyPrices)
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
            // KAYNAK BAĞLARININ İKİSİ DE GERİ KURULUR (adisyon + randevu). Bağsız geri yüklenen
            // tahsilat iki yerde birden bozuluyordu: bu satışın adisyonu sonradan silindiğinde
            // bulunamayıp para kasada kalıyor, randevu bağı boş kaldığında ise tamamlaması geri
            // alınan randevunun parası sahipsiz kalıyordu. Eski yedeklerde alanlar null gelir →
            // davranış değişmez. (bkz. SaleSnapshotReader.SnapshotPayment)
            var payment = new AccountPayment(
                accountId, p.Amount, p.Method, p.Reference, Utc(p.OccurredAtUtc), p.SourceAdisyonId, p.SourceAppointmentId);
            _db.AccountPayments.Add(payment);
            _db.Entry(payment).Property(x => x.Id).CurrentValue = p.Id;
            payments.Add(payment);
        }

        var sessions = new List<CustomerPackageSession>(snapshot.Sessions.Count);
        foreach (var s in snapshot.Sessions)
        {
            // DONMUŞ FİYAT DA GERİ YÜKLENİR: aktarılmazsa geri alınan satışın cirosu sessizce
            // seans adedi dağıtımına kayardı (snapshot şema paritesi).
            // Snapshot'ta fiyat varsa O kullanılır; yoksa (eski arşiv) katalogdan tamamlanır.
            var frozenPrice = s.UnitPriceAtSale is { } snapPrice && snapPrice > 0m
                ? snapPrice
                : legacyPrices.TryGetValue(s.ServiceDefinitionId, out var legacy) && legacy > 0m
                    ? legacy
                    : (decimal?)null;
            var session = new CustomerPackageSession(
                tenantId, a.CustomerId, accountId, s.ServicePackageId, s.ServiceDefinitionId, s.TotalSessions,
                s.SourceAdisyonId, frozenPrice);
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
    /// Bu akış KENDİ transaction'ına sahip olmalıdır: dış bir transaction içinden çağrılırsa
    /// <see cref="InvalidOperationException"/> atar (gerekçe aşağıda).
    /// InMemory sağlayıcı transaction desteklemez (birim testleri onu kullanır) → iş doğrudan çalışır.
    /// </para>
    /// </summary>
    private async Task<Result<TValue>> InTransactionAsync<TValue>(Func<Task<Result<TValue>>> work, CancellationToken ct)
    {
        if (!_db.Database.IsRelational()) return await work();

        // İÇ İÇE ÇAĞRI DESTEKLENMİYOR — bilinçli ve SESLİ bir sınır.
        //
        // Bu akış, satır kilidini aldıktan sonra taze okumayı garantilemek için
        // `_db.ChangeTracker.Clear()` kullanır (birkaç yerde). Dış bir transaction içinden
        // çağrılırsa o temizlik, çağıranın HENÜZ KAYDEDİLMEMİŞ değişikliklerini de detach edip
        // sessizce kaybettirir. Savepoint yalnızca transaction'ı korur, ChangeTracker'ı KORUMAZ;
        // bu yüzden eski "iç içe destekleniyor" garantisi gerçekte doğru değildi.
        //
        // Bugün böyle bir çağıran yok (iptal/geri alma yalnızca endpoint'ten çağrılır). İleride
        // biri eklerse sessiz veri kaybı yerine burada yüksek sesle patlar.
        if (_db.Database.CurrentTransaction is not null)
        {
            throw new InvalidOperationException(
                "Satış iptali/geri alma dış bir transaction içinden çağrılamaz: bu akış kilit " +
                "sonrası ChangeTracker'ı temizler ve çağıranın kaydedilmemiş değişikliklerini " +
                "kaybettirir. Çağrıyı kendi transaction'ının dışına alın.");
        }

        // İZOLASYON READ COMMITTED (varsayılan REPEATABLE READ DEĞİL). MariaDB/MySQL'de
        // REPEATABLE READ, transaction'ın İLK okumasında bir snapshot dondurur: cari satırı
        // FOR UPDATE ile kilitlense bile, kilitten SONRAKİ normal okumalar hâlâ o eski
        // snapshot'ı görür. Araya giren bir tahsilat böylece "yok" görünüp arşive girmiyor,
        // ardından cari cascade silinince o para KALICI olarak kayboluyordu.
        // READ COMMITTED'da her ifade en güncel commit'i okur → kilit sonrası okuma gerçekten taze.
        await using var tx = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct);
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
        catch (Exception ex) when (IsLockContention(ex))
        {
            // KİLİT ÇAKIŞMASI 500 DEĞİLDİR: veritabanı deadlock kurbanı seçtiğinde ya da kilit
            // bekleme süresi dolduğunda hiçbir şey yazılmamıştır — kullanıcıya "tekrar deneyin"
            // demek doğru cevap. Yığın izli 500 hem yanıltıcı hem de gereksiz alarm üretiyordu.
            await tx.RollbackAsync(ct);
            _db.ChangeTracker.Clear();
            return Result<TValue>.Failure(Error.Conflict(
                "Bu kayıt üzerinde eşzamanlı başka bir işlem var. Lütfen birkaç saniye sonra tekrar deneyin."));
        }
        catch
        {
            await tx.RollbackAsync(ct);
            _db.ChangeTracker.Clear();
            throw;
        }
    }

    /// <summary>
    /// MySQL/MariaDB kilit çakışması mı? 1213 = deadlock (kurban seçildi), 1205 = kilit bekleme
    /// süresi doldu. İkisinde de transaction geri alınmıştır; işlem güvenle tekrarlanabilir.
    /// </summary>
    private static bool IsLockContention(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            var number = e.GetType().GetProperty("Number")?.GetValue(e) as int?;
            if (number is 1213 or 1205) return true;
            if (e.InnerException is null) break;
        }
        return false;
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

        // ── KESİN BAĞ ÖNCE, TAHMİN SONRA ────────────────────────────────────────────────────
        // Yeni randevular hangi seanstan geldiklerini taşır (Appointment.SourceCustomerPackageSessionId).
        // Bu randevularda tahmine gerek yok: bağı bu satışın seansına düşenler kapanır, BAŞKA bir
        // satışın seansına bağlı olanlar korunur. Yalnızca bağsız (eski) kayıtlar sezgisel yola kalır.
        var cancelledSessionIds = cancelledSessions.Select(s => s.Id).ToHashSet();
        var doomed = candidates
            .Where(a => a.SourceCustomerPackageSessionId is { } sid && cancelledSessionIds.Contains(sid))
            .ToList();

        var legacy = candidates.Where(a => a.SourceCustomerPackageSessionId is null).ToList();
        foreach (var group in legacy.GroupBy(a => a.ServiceDefinitionId))
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
    /// seans ve sadakat güncellemesini eziyordu.
    /// </para>
    /// <para>
    /// SIRA: <see cref="RowLock.TableOrder"/>. Adisyon onayı eskiden adisyonlar'ı customers'tan
    /// ÖNCE alıyordu ve bu iki yön birbirini bekleyebiliyordu; onay tarafı düzeltildi.
    /// İptal yolu da artık <c>customers</c>'ı EN BAŞTA (cari kilidinden önce) alıyor: aynı
    /// müşterinin iki işlemi kapıda serileşiyor, böylece "iptal cariyi önce / onay adisyonu önce"
    /// çaprazı oluşamıyor. Kilit çakışması yine de olursa istek 500 değil Conflict döner
    /// (bkz. <c>InTransactionAsync</c>).
    /// </para>
    /// </summary>
    private async Task LockSideEffectRowsAsync(
        Guid customerId,
        IEnumerable<Guid> adisyonIds,
        IEnumerable<Guid> productIds,
        IEnumerable<Guid> giftCardIds,
        IEnumerable<Guid> sessionIds,
        CancellationToken ct,
        IEnumerable<Guid>? staffMemberIds = null)
    {
        // Müşteri satırı: sadakat BAKİYESİ bir toplam olduğu için tek satır kilitlenemez; aynı
        // müşterinin iki işlemi burada serileşir ve puan eksiye düşemez.
        await RowLock.LockRowAsync(_db, "customers", customerId, ct);
        // Personel satırı: randevu SLOT kapasitesi bu satırda serileşir (bkz. AppointmentService).
        // Sıra RowLock.TableOrder ile aynıdır — customers'tan sonra, adisyonlar'dan önce.
        if (staffMemberIds is not null) await RowLock.LockRowsAsync(_db, "staff_members", staffMemberIds, ct);
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

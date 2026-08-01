using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// YARIŞ DURUMLARI — GERÇEK VERİTABANI DAVRANIŞI.
///
/// <para>
/// Adisyon onayında transaction + <c>SELECT … FOR UPDATE</c>, peşinat taşımada ise deterministik
/// birincil anahtar koruması var. Bu korumaların HİÇBİRİ InMemory sağlayıcıda çalışmaz: orada
/// transaction yok sayılır, satır kilidi atlanır ve iki "eşzamanlı" çağrı zaten sırayla işler.
/// Yani korumaların doğru kurulduğu ancak gerçek MySQL/MariaDB üzerinde görülebilir — burası orası.
/// Sunucu yoksa testler atlanır (bkz. <see cref="MySqlFactAttribute"/>).
/// </para>
/// </summary>
public sealed class ConcurrencyMySqlTests
{
    private static AdisyonService NewAdisyonService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(
            db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user),
            new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Yarış QA", $"yaris-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "YARIŞ MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id);
    }

    /// <summary>1.000 ₺ borç + 400 ₺ tahsilat içeren AÇIK adisyon açar.</summary>
    private static async Task<Guid> OpenAdisyonAsync(MySqlTestDatabase database, Seed seed)
    {
        await using var db = database.NewContext();
        var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Yarış testi");
        db.Adisyonlar.Add(adisyon);
        await db.SaveChangesAsync();

        // Kalemler, AddItemAsync ile aynı şekilde DbSet'e AÇIKÇA eklenir (PK ctor'da set edildiği
        // için EF aksi hâlde UPDATE üretir — bkz. AdisyonService.AddItemAsync).
        db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Extra, null, "Ek hizmet", 1, 1000m, null, false));
        db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Payment, null, "Nakit tahsilat", 1, 400m, null, false, "cash"));
        await db.SaveChangesAsync();
        return adisyon.Id;
    }

    // =====================================================================================
    // 1) Eşzamanlı ÇİFT ONAY
    // =====================================================================================

    /// <summary>
    /// Aynı fişe iki onay isteği AYNI ANDA gelirse (çift tıklama, yeniden gönderilen istek,
    /// iki sekme) yalnız biri geçmeli. Kilit ve transaction olmasaydı ikisi de fişi "Open"
    /// okuyup borcu, tahsilatı ve sadakat puanını İKİ KEZ üretirdi: 400 ₺ tahsilat kasaya
    /// 800 ₺ olarak düşer, müşteriye iki cari açılırdı.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentApprove_AppliesEffectsExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var adisyonId = await OpenAdisyonAsync(database, seed);

        async Task<bool> ApproveAsync()
        {
            await using var db = database.NewContext();
            var result = await NewAdisyonService(db).ApproveAsync(seed.TenantId, adisyonId);
            return result.IsSuccess;
        }

        var results = await Task.WhenAll(ApproveAsync(), ApproveAsync());

        Assert.Equal(1, results.Count(x => x));

        await using var check = database.NewContext();
        Assert.Equal(AdisyonStatus.Approved, (await check.Adisyonlar.SingleAsync(a => a.Id == adisyonId)).Status);

        // Onayın TÜM yan etkileri tam olarak bir kez oluşmalı.
        var account = Assert.Single(await check.CustomerAccounts.ToListAsync());
        Assert.Equal(1000m, account.TotalAmount);
        var payment = Assert.Single(await check.AccountPayments.ToListAsync());
        Assert.Equal(400m, payment.Amount);
        var loyalty = Assert.Single(await check.LoyaltyTransactions.ToListAsync());
        Assert.Equal(40, loyalty.Points); // 400 ₺ / 10 = 40 puan
    }

    // =====================================================================================
    // 2) ONAY ↔ İPTAL yarışı
    // =====================================================================================

    /// <summary>
    /// ONAY–İPTAL YARIŞI (kayıp güncelleme). İptal isteği fişi okur (Status = Open), araya giren
    /// başka bir istek fişi onaylar, sonra iptal isteği YAZAR. Kilit alınmadan okunursa iptal,
    /// bayat anlık görüntüsüne dayanarak fişi "İptal" yapar: para kasaya girmiş, seans düşmüş,
    /// stok azalmıştır ama fiş iptal görünür — muhasebe defteriyle fiş kalıcı olarak ayrışır.
    ///
    /// <para>
    /// Sıralama BİLİNÇLİ olarak deterministiktir (uyku/zamanlamaya bağlı test değil): okuma →
    /// araya giren onay → yazma. EF izlediği nesnenin değerlerini yeniden sorguda tazelemez,
    /// bu yüzden ikinci istek gerçekten bayat veriyle yazmaya çalışır.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task CancelLosingRaceWithApprove_DoesNotOverwriteApprovedReceipt()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var adisyonId = await OpenAdisyonAsync(database, seed);

        // 1) İptal isteği fişi OKUR — henüz yazmaz.
        await using var cancelDb = database.NewContext();
        var cancelService = NewAdisyonService(cancelDb);
        Assert.Equal(AdisyonStatus.Open,
            (await cancelDb.Adisyonlar.Include(a => a.Items).SingleAsync(a => a.Id == adisyonId)).Status);

        // 2) Araya BAŞKA bir istek girer ve fişi onaylar (borç cariye, tahsilat kasaya).
        await using (var approveDb = database.NewContext())
        {
            var approved = await NewAdisyonService(approveDb).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        // 3) İptal isteği şimdi yazmaya çalışır — reddedilmeli.
        var cancelled = await cancelService.CancelAsync(seed.TenantId, adisyonId);
        Assert.True(cancelled.IsFailure, "Onaylanmış fiş bayat okumayla iptal edilebildi.");

        await using var check = database.NewContext();
        Assert.Equal(AdisyonStatus.Approved, (await check.Adisyonlar.SingleAsync(a => a.Id == adisyonId)).Status);
        // Para hâlâ defterde: fiş iptale dönseydi bu tahsilatın karşılığı kalmazdı.
        Assert.Equal(400m, (await check.AccountPayments.SingleAsync()).Amount);
    }

    // =====================================================================================
    // 3) PEŞİNAT TAŞIMA yarışı
    // =====================================================================================

    /// <summary>
    /// PEŞİNAT TAŞIMA YARIŞI. Açılışta çalışan taşıma işi (<c>BackfillDepositPaymentsAsync</c>)
    /// birden çok backend örneğinde AYNI ANDA çalışabilir. İkisi de "bu carinin peşinat tahsilatı
    /// yok" görüp satır eklerse peşinat iki kez gelir yazılır. Koruma tahsilatın Id'sinin CARİNİN
    /// Id'si olmasıdır: ikinci ekleme birincil anahtar çakışmasıyla reddedilir.
    ///
    /// <para>Birim testi bu Id eşitliğini bellekte doğruluyor; buradaki test veritabanının
    /// ikinci satırı GERÇEKTEN reddettiğini doğrular — asıl koruma orada.</para>
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentDepositBackfill_WritesDepositPaymentOnlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // ESKİ KAYIT: peşinatı olan ama tahsilat satırı BULUNMAYAN cari (taşımadan önceki hâl).
        Guid accountId;
        await using (var db = database.NewContext())
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Eski satış", 5000m, 1500m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            accountId = account.Id;
            Assert.Empty(await db.AccountPayments.ToListAsync());
        }

        // İki backend örneği aynı anda açılıyor.
        await using var first = database.NewServiceProvider();
        await using var second = database.NewServiceProvider();
        await Task.WhenAll(
            DatabaseBootstrap.BackfillDepositPaymentsAsync(first),
            DatabaseBootstrap.BackfillDepositPaymentsAsync(second));

        await using (var check = database.NewContext())
        {
            var payment = Assert.Single(await check.AccountPayments.ToListAsync());
            Assert.Equal(1500m, payment.Amount);
            Assert.Equal(accountId, payment.Id); // deterministik anahtar = mükerrer koruması
        }

        // Taşıma tekrar çalışsa da (yeniden başlatma) ikinci satır oluşmamalı.
        await using var third = database.NewServiceProvider();
        await DatabaseBootstrap.BackfillDepositPaymentsAsync(third);

        await using (var check = database.NewContext())
            Assert.Single(await check.AccountPayments.ToListAsync());
    }

    // =====================================================================================
    // 4) Kuyruk temizliği — MariaDB uyumlu DELETE
    // =====================================================================================

    /// <summary>
    /// KUYRUK TEMİZLİĞİ GERÇEKTEN ÇALIŞIYOR MU. Temizlik <c>ExecuteDeleteAsync</c> ile yazılmıştı;
    /// EF bunu <c>DELETE FROM background_jobs AS b …</c> olarak üretiyor ve MariaDB takma adlı bu
    /// biçimi reddediyor — canlıda temizlik hiç çalışmadan saatte bir hata logu bırakıyordu.
    /// Test hem sorgunun gerçek sunucuda geçtiğini hem de yalnız DOĞRU satırları sildiğini kilitler:
    /// taze işler ve dead-letter (Failed) kayıtları durmalı.
    /// </summary>
    [MySqlFact]
    public async Task PurgeSucceeded_RemovesOnlyExpiredSucceededJobs()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var now = DateTime.UtcNow;

        await using (var db = database.NewContext())
        {
            var expired = new BackgroundJob("Test.Expired", "{}");
            expired.MarkSucceeded();
            var fresh = new BackgroundJob("Test.Fresh", "{}");
            fresh.MarkSucceeded();
            var deadLetter = new BackgroundJob("Test.DeadLetter", "{}", maxAttempts: 1);
            deadLetter.MarkFailedAttempt("kalıcı hata");
            var pending = new BackgroundJob("Test.Pending", "{}");

            db.BackgroundJobs.AddRange(expired, fresh, deadLetter, pending);
            await db.SaveChangesAsync();

            // Tamamlanma anları geriye alınır (özel setter yok — EF üzerinden yazılır).
            db.Entry(expired).Property(j => j.CompletedAtUtc).CurrentValue = now.AddDays(-30);
            db.Entry(deadLetter).Property(j => j.CompletedAtUtc).CurrentValue = now.AddDays(-30);
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var removed = await BackgroundJobMaintenance.PurgeSucceededAsync(db, now.AddDays(-7), maxBatches: 20);
            Assert.Equal(1, removed);
        }

        await using (var check = database.NewContext())
        {
            var remaining = (await check.BackgroundJobs.ToListAsync()).Select(j => j.Type).OrderBy(t => t).ToArray();
            Assert.Equal(["Test.DeadLetter", "Test.Fresh", "Test.Pending"], remaining);
        }
    }
}

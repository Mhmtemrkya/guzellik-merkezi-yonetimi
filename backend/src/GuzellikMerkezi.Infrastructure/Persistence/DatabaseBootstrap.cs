using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
// DbContext.GetService<T>() — migration'ları sağlayıcının kilidi olmadan uygulamak için gereken
// EF iç servisleri (bkz. ApplyPendingMigrationsAsync).
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Infrastructure.Persistence;

public static class DatabaseBootstrap
{
    /// <summary>
    /// MySQL kullanılıyorsa, connection string'de belirtilen database yoksa
    /// önce sunucuya database-less bağlanıp CREATE DATABASE IF NOT EXISTS çalıştırır.
    /// InMemory kullanılıyorsa hiçbir şey yapmaz.
    /// </summary>
    public static async Task EnsureDatabaseAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var builder = new MySqlConnectionStringBuilder(connectionString);
        var databaseName = builder.Database;
        if (string.IsNullOrWhiteSpace(databaseName)) return;

        // Sunucuya bağlanmak için database adını boşalt
        builder.Database = string.Empty;

        try
        {
            await using var connection = new MySqlConnection(builder.ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE IF NOT EXISTS `{databaseName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
            await command.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");
            logger.LogWarning(
                ex,
                "Database '{Database}' otomatik oluşturulamadı. MySQL sunucusunun çalıştığından ve connection string'in doğru olduğundan emin ol.",
                databaseName);
        }
    }

    /// <summary>
    /// EF Core migration'larını uygular. Daha önce EnsureCreated / SQL bootstrap ile kurulmuş
    /// mevcut bir veritabanı tespit edilirse (tablolar var ama migration geçmişi yok) ilk migration
    /// baseline olarak işaretlenir — şema yeniden oluşturulmaz, veri kaybolmaz. Sonraki tüm şema
    /// değişiklikleri yalnızca yeni migration'larla gelir (dotnet ef migrations add ...).
    /// </summary>
    public static async Task MigrateDatabaseAsync(GuzellikDbContext db, ILogger? logger = null)
    {
        if (db.Database.IsInMemory())
        {
            await db.Database.EnsureCreatedAsync();
            return;
        }

        var pending = (await db.Database.GetPendingMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).ToArray();
        if (pending.Length == 0) return;

        var applied = (await db.Database.GetAppliedMigrationsAsync()).Any();
        var legacySchemaExists = !applied && await TableExistsAsync(db, "tenants");
        if (legacySchemaExists)
        {
            // Baseline: ilk migration mevcut şemayı temsil ediyor; çalıştırmadan geçmişe yaz.
            var initialMigration = pending[0];
            var productVersion = typeof(DbContext).Assembly.GetName().Version?.ToString(3) ?? "10.0.0";
            await db.Database.ExecuteSqlRawAsync(
                "CREATE TABLE IF NOT EXISTS `__EFMigrationsHistory` (" +
                "`MigrationId` VARCHAR(150) NOT NULL, `ProductVersion` VARCHAR(32) NOT NULL, " +
                "PRIMARY KEY (`MigrationId`)) CHARACTER SET utf8mb4;");
            await db.Database.ExecuteSqlAsync(
                $"INSERT IGNORE INTO `__EFMigrationsHistory` (`MigrationId`, `ProductVersion`) VALUES ({initialMigration}, {productVersion});");
            logger?.LogInformation("Mevcut veritabanı baseline alındı: {Migration} uygulanmış sayıldı.", initialMigration);
            // Baseline yazıldı; bekleyen liste yeniden hesaplanmalı (ilk migration artık uygulanmış).
            pending = (await db.Database.GetPendingMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).ToArray();
            if (pending.Length == 0) return;
        }

        await ApplyPendingMigrationsAsync(db, pending, logger);
    }

    /// <summary>
    /// Bekleyen migration'ları TEK TEK uygular — <c>Database.MigrateAsync()</c> KULLANILMAZ.
    ///
    /// <para>
    /// NEDEN: MySQL sağlayıcısı migration'lara başlamadan önce bir "veritabanı kilidi" alıyor
    /// (<c>MySQLHistoryRepository.AcquireDatabaseLockAsync</c>) ve dönen değeri koşulsuz
    /// <c>long</c>'a çeviriyor. Canlıdaki MariaDB 10.6'da bu çağrı <c>NULL</c> dönebiliyor ve
    /// açılış <c>InvalidCastException: Unable to cast object of type 'System.DBNull' to type
    /// 'System.Int64'</c> ile PATLIYOR — yani uygulamanın kendi migration yolu MariaDB'de hiç
    /// çalışmıyordu (boş şemaya kurulum ve otomatik yükseltme senaryoları). Sağlayıcı sürümüne
    /// bağımlı kalmamak için migration SQL'ini EF'in kendi üreticisinden alıp kendimiz uygularız;
    /// üretilen SQL <c>dotnet ef database update</c> ile AYNIDIR.
    /// </para>
    /// <para>
    /// ÇOK INSTANCE KORUMASI KAYBOLMAZ: sağlayıcının kilidi yerine kendi adlandırılmış kilidimizi
    /// alırız (<c>GET_LOCK</c>) ve NULL dönüşünü doğru ele alırız. Kilit alınamazsa migration
    /// uygulanmaz — iki backend aynı anda açılırsa biri bekler, sonra bekleyen migration kalmadığını
    /// görür.
    /// </para>
    /// <para>
    /// Her migration KENDİ transaction'ında uygulanır ve geçmiş satırı aynı transaction'da yazılır:
    /// yarıda kalan bir migration "uygulanmış" görünmez. (DDL'in MySQL'de örtük commit ürettiği
    /// durumlar sağlayıcının kendi davranışıyla aynıdır.)
    /// </para>
    /// </summary>
    private static async Task ApplyPendingMigrationsAsync(GuzellikDbContext db, string[] pending, ILogger? logger)
    {
        var lockName = MigrationLockName(db);

        var migrationsAssembly = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrationsAssembly>();
        var sqlGenerator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrationsSqlGenerator>();
        var commandExecutor = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrationCommandExecutor>();
        var history = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IHistoryRepository>();
        var connection = db.GetService<Microsoft.EntityFrameworkCore.Storage.IRelationalConnection>();
        // Migration'ın hedef modeli SQL üretiminden ÖNCE "finalize" edilmeli; aksi hâlde sağlayıcı
        // GetRelationalModel() çağrısında "model must be finalized" hatası verir (EF'in kendi
        // Migrator'ı da tam olarak bunu yapar).
        var modelInitializer = db.GetService<IModelRuntimeInitializer>();
        var productVersion = typeof(DbContext).Assembly.GetName().Version?.ToString(3) ?? "10.0.0";

        // KİLİT ALINAMAZSA AÇILIŞ DURUR (fail-closed).
        //
        // Eskiden yalnızca uyarı loglanıp devam ediliyordu: yeni binary, ESKİ ŞEMA üzerinde trafik
        // kabul ediyordu. Sonuç sessiz ve tehlikelidir — eksik kolona yazan uçlar 500 verir,
        // beklenen kısıtlar yoktur, veri yanlış yazılabilir. 90 saniye bekleyip kilit hâlâ
        // alınamıyorsa doğru davranış hizmete BAŞLAMAMAKTIR: operatör durumu görür ve düzeltir.
        if (!await TryAcquireMigrationLockAsync(db, lockName))
        {
            throw new InvalidOperationException(
                "Migration kilidi alınamadı (90 sn). Başka bir örnek migration uyguluyor olabilir ya da " +
                "kilit sahibi bir oturum takılmış olabilir. Şema durumu bilinmediği için uygulama " +
                $"BAŞLATILMADI — birkaç dakika sonra yeniden deneyin; sürerse veritabanında " +
                $"`SELECT IS_USED_LOCK('{lockName}');` ile kilit sahibini kontrol edin.");
        }

        try
        {
            // Kilit beklerken başka bir örnek uygulamış olabilir → listeyi tazele.
            pending = (await db.Database.GetPendingMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).ToArray();
            if (pending.Length == 0) return;

            await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript());
            await EnsureMigrationAttemptTableAsync(db);

            // YARIM KALMIŞ MIGRATION VARSA AÇILIŞ DURUR.
            //
            // MariaDB'de DDL ÖRTÜK COMMIT üretir: `ALTER TABLE` uygulandıktan sonra, geçmiş satırı
            // yazılmadan süreç ölürse şema değişmiş ama migration "bekliyor" görünür. Bir sonraki
            // açılış aynı DDL'i tekrar çalıştırır ve "Duplicate column" ile PATLAR — üstelik her
            // açılışta, yani kalıcı bir açılış kilidi (brick) oluşur. Otomatik onarım güvenli
            // değildir (hangi komutların geçtiği bilinmiyor); doğru davranış operatöre NE OLDUĞUNU
            // ve NE YAPACAĞINI net söylemektir.
            var abandoned = await ReadMigrationAttemptAsync(db);
            if (abandoned is { } stuck && pending.Contains(stuck))
            {
                throw new InvalidOperationException(
                    $"Önceki açılışta '{stuck}' migration'ı YARIDA KALDI (şema değişmiş olabilir ama " +
                    "geçmişe yazılmadı). Otomatik devam etmek aynı DDL'i tekrar çalıştırıp kalıcı " +
                    "açılış hatası üretir. Yapılacak: şemayı kontrol edin; migration GERÇEKTEN " +
                    $"uygulanmışsa `INSERT INTO __EFMigrationsHistory VALUES ('{stuck}', '{productVersion}');` " +
                    "yazıp `DELETE FROM __migration_attempt;` çalıştırın; uygulanmamışsa yalnızca " +
                    "`DELETE FROM __migration_attempt;` yeterlidir.");
            }

            foreach (var migrationId in pending)
            {
                if (!migrationsAssembly.Migrations.TryGetValue(migrationId, out var migrationType))
                    throw new InvalidOperationException($"Migration bulunamadı: {migrationId}");

                // DDL'DEN ÖNCE İZ BIRAK: çökme penceresinde hangi migration'ın yarıda kaldığı bilinsin.
                await WriteMigrationAttemptAsync(db, migrationId);

                var migration = migrationsAssembly.CreateMigration(migrationType, db.Database.ProviderName!);
                var targetModel = migration.TargetModel is { } m ? modelInitializer.Initialize(m) : null;
                var commands = sqlGenerator.Generate(migration.UpOperations, targetModel);
                await commandExecutor.ExecuteNonQueryAsync(commands, connection);

                await db.Database.ExecuteSqlRawAsync(
                    history.GetInsertScript(new Microsoft.EntityFrameworkCore.Migrations.HistoryRow(migrationId, productVersion)));
                await ClearMigrationAttemptAsync(db);
                logger?.LogInformation("Migration uygulandı: {Migration}", migrationId);
            }
        }
        finally
        {
            await ReleaseMigrationLockAsync(db, lockName);
        }
    }

    /// <summary>
    /// MIGRATION KİLİDİNİN ADI — VERİTABANINA ÖZELDİR.
    ///
    /// <para>
    /// <c>GET_LOCK</c> SUNUCU GENELİNDE tektir, veritabanı başına değil. Sabit bir ad kullanmak,
    /// aynı MariaDB sunucusundaki AYRI kurulumların (canlı + staging, ya da çok kiracılı barındırma)
    /// birbirinin açılışını kilitlemesi demekti: biri migration uygularken diğeri 90 sn bekleyip
    /// hata ile durur. Kilit korumak istediği şeyin — TEK BİR ŞEMANIN — adıyla anılmalıdır.
    /// </para>
    /// <para>
    /// Ad kısaltılır: MySQL kilit adları 64 karakterle sınırlıdır ve veritabanı adı uzun olabilir.
    /// SHA-256'nın ilk 16 hex hanesi çakışma için fazlasıyla yeterlidir.
    /// </para>
    /// </summary>
    public static string MigrationLockName(GuzellikDbContext db)
    {
        var database = db.Database.GetDbConnection().Database ?? string.Empty;
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(database));
        return $"beautyasist_mig_{Convert.ToHexString(hash)[..16].ToLowerInvariant()}";
    }

    /// <summary>
    /// YARIM KALAN MIGRATION İZİ. Tek satırlı küçük bir tablo: DDL'den ÖNCE yazılır, geçmiş satırı
    /// yazıldıktan SONRA silinir. Aradaki çökme bu satırla teşhis edilir (bkz. ApplyPendingMigrationsAsync).
    /// </summary>
    private static Task EnsureMigrationAttemptTableAsync(GuzellikDbContext db) =>
        db.Database.ExecuteSqlRawAsync(
            "CREATE TABLE IF NOT EXISTS `__migration_attempt` (" +
            "`MigrationId` VARCHAR(150) NOT NULL, `StartedAtUtc` DATETIME(6) NOT NULL, " +
            "PRIMARY KEY (`MigrationId`)) CHARACTER SET utf8mb4;");

    private static async Task<string?> ReadMigrationAttemptAsync(GuzellikDbContext db)
    {
        var rows = await db.Database
            .SqlQueryRaw<string>("SELECT `MigrationId` AS Value FROM `__migration_attempt` LIMIT 1")
            .ToListAsync();
        return rows.FirstOrDefault();
    }

    private static async Task WriteMigrationAttemptAsync(GuzellikDbContext db, string migrationId)
    {
        await db.Database.ExecuteSqlRawAsync("DELETE FROM `__migration_attempt`");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO `__migration_attempt` (`MigrationId`, `StartedAtUtc`) VALUES ({0}, {1})",
            migrationId, DateTime.UtcNow);
    }

    private static Task ClearMigrationAttemptAsync(GuzellikDbContext db) =>
        db.Database.ExecuteSqlRawAsync("DELETE FROM `__migration_attempt`");

    /// <summary>
    /// Adlandırılmış kilit alır. <c>GET_LOCK</c> 1 (alındı), 0 (zaman aşımı) ya da NULL (hata)
    /// döner — NULL'u <c>long</c>'a çevirmeye çalışmak sağlayıcıdaki hatanın ta kendisiydi;
    /// burada açıkça "alınamadı" sayılır. İlişkisel olmayan sağlayıcıda kilit yoktur (true döner).
    /// </summary>
    /// <summary>Kilit için beklenecek süre (saniye).</summary>
    private const int MigrationLockWaitSeconds = 90;

    private static async Task<bool> TryAcquireMigrationLockAsync(GuzellikDbContext db, string lockName)
    {
        if (!db.Database.IsRelational()) return true;
        var conn = db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT GET_LOCK(@n, {MigrationLockWaitSeconds});";

        // KOMUT ZAMAN AŞIMI, BEKLEME SÜRESİNDEN UZUN OLMALI.
        //
        // Sürücünün varsayılan komut zaman aşımı 30 saniyedir; GET_LOCK 90 saniye beklerken komut
        // ÖNCE zaman aşımına uğruyordu. Sonuç iki yönden kötüydü: (1) kilit gerçekten meşgulken
        // "alınamadı" yerine anlaşılmaz bir sürücü hatası düşüyor, operatör sebebi göremiyordu;
        // (2) MySql.Data zaman aşımını YAN BİR BAĞLANTIDAN kill ederek uyguladığı için, kilit
        // beklerken bu ikinci bağlantı da bloklanıp süreci tamamen kilitleyebiliyordu.
        cmd.CommandTimeout = MigrationLockWaitSeconds + 30;

        var p = cmd.CreateParameter();
        p.ParameterName = "@n";
        p.Value = lockName;
        cmd.Parameters.Add(p);
        var result = await cmd.ExecuteScalarAsync();
        return result is not null && result != DBNull.Value && Convert.ToInt64(result) == 1;
    }

    private static async Task ReleaseMigrationLockAsync(GuzellikDbContext db, string lockName)
    {
        if (!db.Database.IsRelational()) return;
        try
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "DO RELEASE_LOCK(@n);";
            var p = cmd.CreateParameter();
            p.ParameterName = "@n";
            p.Value = lockName;
            cmd.Parameters.Add(p);
            await cmd.ExecuteNonQueryAsync();
        }
        catch
        {
            // Bağlantı kapanınca kilit zaten düşer; bırakma hatası açılışı engellememeli.
        }
    }

    private static async Task<bool> TableExistsAsync(GuzellikDbContext db, string tableName)
    {
        var conn = db.Database.GetDbConnection();
        var shouldClose = conn.State != System.Data.ConnectionState.Open;
        if (shouldClose) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t;";
            var p = cmd.CreateParameter();
            p.ParameterName = "@t";
            p.Value = tableName;
            cmd.Parameters.Add(p);
            var result = await cmd.ExecuteScalarAsync();
            return Convert.ToInt64(result) > 0;
        }
        finally
        {
            if (shouldClose) await conn.CloseAsync();
        }
    }

    /// <summary>
    /// Şema dışı referans verileri: eski kurulumlarda collation hizalama + varsayılan abonelik planları.
    /// Şema değişiklikleri artık burada DEĞİL, EF migration'larında yapılır.
    /// </summary>
    public static async Task EnsureReferenceDataAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");

        // Yeni feature tablolarının collation'ını çekirdek tablolarla (customers) HİZALA.
        // MySQL'de farklı collation'lı CHAR(36) kolonları JOIN'lemek "Illegal mix of collations"
        // hatası verir (adisyon/seans/prim/sadakat sorguları çekirdek tablolarla JOIN yapıyor).
        // Bu adım, tablo nasıl oluşturulmuş olursa olsun (bootstrap CREATE = utf8mb4_unicode_ci,
        // EnsureCreated = sunucu varsayılanı) tutarlılığı garanti eder. Idempotent + koşullu:
        // yalnızca collation'ı uyuşmayan tabloyu çevirir, gereksiz rebuild yapmaz.
        await AlignFeatureTableCollationsAsync(db, logger);

        await SeedSubscriptionPlansAsync(db, logger);
        await SeedWhatsAppBillingAsync(db, logger);
    }

    /// <summary>
    /// Mevcut müşterilerin blind index'ini (SearchIndex) doldurur — şifreli olduğu için SQL ile
    /// hesaplanamaz, uygulama içinde çözülüp yeniden yazılmalıdır.
    /// </summary>
    /// <remarks>
    /// <para>Idempotent ve kesintiye dayanıklı: yalnızca <c>SearchIndex IS NULL</c> satırları alır, partiler
    /// hâlinde ilerler. Yarıda kalırsa sonraki açılışta kaldığı yerden devam eder.</para>
    /// <para>Backfill bitene kadar arama ve mükerrer-telefon kontrolü otomatik olarak eski (tam tarama)
    /// davranışına düşer; yani bu iş bitmeden de sonuçlar DOĞRUdur, sadece yavaştır.</para>
    /// <para>Yan etki: indekslenen satırların <c>UpdatedAtUtc</c> alanı tazelenir (tek seferlik).</para>
    /// </remarks>
    public static async Task BackfillCustomerSearchIndexAsync(IServiceProvider services)
    {
        const int BatchSize = 500;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("SearchIndexBackfill");

        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();

            var total = 0;
            while (true)
            {
                // Query filter startup'ta tenant bağlamı olmadığından devre dışı; yine de silinmişleri atla.
                var batch = await db.Customers.IgnoreQueryFilters()
                    .Where(x => !x.IsDeleted && x.SearchIndex == null)
                    .Take(BatchSize)
                    .ToListAsync();
                if (batch.Count == 0) break;

                // Değeri bilerek "değişmiş" işaretliyoruz; gerçek indeksi SaveChanges (ApplySearchIndex) üretir.
                foreach (var customer in batch) customer.SetSearchIndex(string.Empty);
                await db.SaveChangesAsync();

                total += batch.Count;
                if (batch.Count < BatchSize) break;
            }

            if (total > 0) logger.LogInformation("{Count} müşteri için arama indeksi (blind index) oluşturuldu.", total);
        }
        catch (Exception ex)
        {
            // Şema henüz yoksa veya DB erişilemiyorsa uygulama açılışı bundan ötürü durmamalı.
            logger.LogWarning(ex, "Müşteri arama indeksi backfill'i tamamlanamadı; arama tam-tarama moduna düşecek.");
        }
    }

    /// <summary>
    /// İPTAL ARŞİVİ BAKIMI — her ortamda çalışır, veri-only ve idempotenttir.
    /// <list type="number">
    ///   <item>
    ///     <b>Düz metin yedekleri şifreler.</b> Eski iptalleri arşive taşıyan migration ham SQL
    ///     yazdığı için EF'in şifreleme dönüştürücüsü devreye girmedi: tutarlar, tarihler, kimlikler
    ///     ve seans yapısı <c>cancelled_sales.Snapshot</c> içinde AÇIK kaldı. Burada satır EF üzerinden
    ///     yeniden yazılır → değer <c>ENC:v1:</c> olarak kaydedilir.
    ///   </item>
    ///   <item>
    ///     <b>Eksik tahsilat defteri satırlarını üretir.</b> <c>archived_sale_payments</c> eklenmeden
    ///     önce iptal edilmiş satışların tahsilatları yalnızca yedeğin içindedir; yedek şifreli
    ///     olduğu için SQL migration'ı bunu yapamaz — okuma/çözme uygulama tarafında olmak zorunda.
    ///   </item>
    /// </list>
    /// Şema henüz yoksa ya da DB erişilemiyorsa uyarı loglanır, açılış engellenmez.
    /// </summary>
    public static async Task BackfillCancelledSaleArchivesAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("CancelledSaleArchiveBackfill");

        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            if (db.Database.IsInMemory()) return;

            // Startup'ta kiracı bağlamı yok → global filtreler devre dışı, silinmişler elle atlanır.
            var archives = await db.CancelledSales.IgnoreQueryFilters()
                .Where(x => !x.IsDeleted)
                .ToListAsync();
            if (archives.Count == 0) return;

            // 1) Ham SQL ile yazılmış DÜZ METİN yedekler. Değer okunurken çözücüden geçtiği için
            //    şifreli mi ayırt edilemez; ham kolona bakmak gerekir.
            var plaintextIds = (await db.Database
                    .SqlQueryRaw<Guid>(
                        "SELECT Id AS Value FROM cancelled_sales " +
                        "WHERE IsDeleted = 0 AND Snapshot IS NOT NULL AND Snapshot <> '' AND Snapshot NOT LIKE 'ENC:v1:%'")
                    .ToListAsync())
                .ToHashSet();

            var encrypted = 0;
            foreach (var archive in archives.Where(a => plaintextIds.Contains(a.Id)))
            {
                // Değer aynı kalır; kolonu "değişti" işaretlemek EF'in dönüştürücüsünü çalıştırır.
                db.Entry(archive).Property(x => x.Snapshot).IsModified = true;
                encrypted++;
            }

            // 2) Tahsilat defteri: geri alınmamış her arşivin tahsilatları bir kez yazılır.
            //    Kontrol ÖDEME BAZINDA: yalnız arşiv bazında bakılsaydı çok ödemeli bir arşivde tek
            //    satır bulunması kalan ödemeleri sonsuza dek eksik bırakırdı. Mükerrer eklemeye karşı
            //    ayrıca (CancelledSaleId, OriginalPaymentId) üzerinde UNIQUE index var — iki backend
            //    aynı anda açılırsa ikincisi DB tarafından reddedilir.
            var covered = (await db.ArchivedSalePayments.IgnoreQueryFilters()
                    .Select(p => new { p.CancelledSaleId, p.OriginalPaymentId })
                    .ToListAsync())
                .Select(x => (x.CancelledSaleId, x.OriginalPaymentId))
                .ToHashSet();

            var addedPayments = 0;
            foreach (var archive in archives.Where(a => a.RestoredAtUtc == null))
            {
                var snapshot = SaleSnapshotReader.Parse(archive.Snapshot);
                if (snapshot is null) continue;

                foreach (var payment in snapshot.Payments)
                {
                    if (!covered.Add((archive.Id, payment.Id))) continue;
                    db.ArchivedSalePayments.Add(new ArchivedSalePayment(
                        archive.TenantId, archive.BranchId, archive.Id, archive.OriginalAccountId,
                        payment.Id, archive.CustomerId, archive.Name, payment.Amount,
                        payment.Method, payment.Reference, SaleSnapshotReader.Utc(payment.OccurredAtUtc)));
                    addedPayments++;
                }
            }

            if (encrypted == 0 && addedPayments == 0) return;

            await db.SaveChangesAsync();
            if (encrypted > 0) logger.LogInformation("{Count} iptal yedeği şifrelendi (düz metin → ENC:v1).", encrypted);
            if (addedPayments > 0) logger.LogInformation("{Count} arşiv tahsilatı kalıcı deftere taşındı.", addedPayments);
        }
        catch (Exception ex)
        {
            // Şema henüz yoksa (migration uygulanmamış) ya da DB erişilemiyorsa açılış durmamalı.
            logger.LogWarning(ex, "İptal arşivi bakımı tamamlanamadı; tahsilat defteri eksik kalabilir.");
        }
    }

    /// <summary>
    /// TAKSİT PLANI ↔ CARİ TOPLAMI SAPMASINI ONARIR — OPT-IN, varsayılan KAPALI.
    ///
    /// <para>
    /// Cari toplamı elle güncellenirken plan yeniden kurulmuyordu (kod tarafı düzeltildi). Geride
    /// kalan kayıtlarda plan toplamı cari toplamının ALTINDA duruyor ve aradaki fark hiçbir yerde
    /// görünmüyor: taksit ve açık alacak raporları PLAN toplamını okuduğu için o alacak sessizce
    /// kayboluyor (denetimde canlıda 8.750 cari ↔ 8.500 plan = 250 TL).
    /// </para>
    /// <para>
    /// NEDEN OPT-IN VE HEDEFLİ: bu, PARA ETKİLEYEN bir veri düzeltmesidir ve bilinen TEK bir kayıt
    /// içindir. Her açılışta kendiliğinden çalışması onu "bakım" olmaktan çıkarıp kalıcı bir otomatik
    /// yazma davranışına dönüştürüyordu. Bayrağın TEK BAŞINA açılması da yetmez: hedef liste boşken
    /// iş "sapmış tüm kayıtları" tarayıp düzeltiyordu — operatörün görmediği, sebebi bilinmeyen
    /// kayıtlar da sessizce yeniden bölünürdü. Artık her hedef AÇIKÇA yazılır ve BEKLENEN DEĞERLERİYLE
    /// birlikte doğrulanır:
    /// </para>
    /// <code>
    /// Maintenance:RepairInstallmentPlanDrift=true                                 # işi etkinleştirir
    /// Maintenance:RepairInstallmentPlanAccountIds=&lt;accountId&gt;[,&lt;accountId&gt;…]        # ZORUNLU, boş olamaz
    /// Maintenance:RepairInstallmentPlanExpected:&lt;accountId&gt;:TenantId=&lt;guid&gt;
    /// Maintenance:RepairInstallmentPlanExpected:&lt;accountId&gt;:TotalAmount=8750
    /// Maintenance:RepairInstallmentPlanExpected:&lt;accountId&gt;:DepositAmount=0
    /// Maintenance:RepairInstallmentPlanExpected:&lt;accountId&gt;:FinancedAmount=8750
    /// Maintenance:RepairInstallmentPlanExpected:&lt;accountId&gt;:PlanTotal=8500
    /// Maintenance:RepairInstallmentPlanExpected:&lt;accountId&gt;:InstallmentCount=10
    /// </code>
    /// <para>
    /// FAIL-FAST, HER YERDE: bayrak açık ama liste boşsa, bir kimlik/sayı ayrıştırılamıyorsa, hedef
    /// cari bulunamıyorsa, veritabanındaki değerler beklenen tuple ile BİREBİR eşleşmiyorsa ya da
    /// hedeflerden biri onarılamıyorsa HİÇBİR VERİ DEĞİŞTİRİLMEDEN istisna fırlatılır ve açılış
    /// (dolayısıyla deployment) başarısız olur. Sessizce "0 kayıt onarıldı" deyip devam etmek, operatöre
    /// düzeltme yapıldığını düşündürürdü. Başarıda onarılan sayı hedef sayısına EŞİTTİR.
    /// </para>
    /// <para>
    /// Önerilen kullanım: yedek alınır, bilinen kaydın kimliği ve beklenen değerleri yazılır, bir kez
    /// deploy edilir, sapma 1 → 0 doğrulanır, bayrak kapatılır ve servis yeniden başlatılır.
    /// </para>
    /// <para>
    /// Para YARATMAZ/SİLMEZ: "ödenen" bilgisi taksitte değil tahsilat satırlarında durur, plan
    /// yeniden bölünse de tahsilatlar vade sırasıyla yeniden dağıtılır. İptal edilmiş satışa ve
    /// planı olmayan (peşin) cariye dokunulmaz; finanse edilen tutar 0/negatif ise de dokunulmaz.
    /// </para>
    /// </summary>
    public static async Task RepairInstallmentPlanDriftAsync(IServiceProvider services, IConfiguration configuration)
    {
        if (!bool.TryParse(configuration["Maintenance:RepairInstallmentPlanDrift"], out var enabled) || !enabled) return;

        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("InstallmentPlanDriftRepair");

        try
        {
            // Konfigürasyon ÖNCE ayrıştırılır: hatalı kurulum veritabanına hiç dokunmadan yakalanır.
            var targets = ParseRepairTargets(configuration);

            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            if (db.Database.IsInMemory()) return;

            logger.LogWarning(
                "Taksit planı sapma onarımı ETKİN (Maintenance:RepairInstallmentPlanDrift=true). Hedef cari sayısı: {Count} — {Ids}.",
                targets.Count, string.Join(", ", targets.Select(t => t.AccountId)));

            var repaired = await RepairInstallmentPlanDriftAsync(db, logger, targets);
            logger.LogInformation("{Count} carinin taksit planı cari toplamıyla hizalandı.", repaired);
        }
        catch (Exception ex)
        {
            // Bilinçli olarak istenen, para etkileyen bir düzeltme yapılamadı → açılış BAŞARISIZ.
            logger.LogError(ex, "Taksit planı sapma onarımı tamamlanamadı; açılış durduruluyor.");
            throw;
        }
    }

    /// <summary>Bakımın onaracağı TEK cari ve onarımdan ÖNCE beklenen durumu (doğrulama tuple'ı).</summary>
    /// <param name="FinancedAmount">Beklenen finanse edilen tutar — <c>TotalAmount − DepositAmount</c>.</param>
    /// <param name="PlanTotal">Beklenen (sapmış) aktif plan toplamı.</param>
    /// <param name="InstallmentCount">Beklenen aktif taksit sayısı.</param>
    public sealed record InstallmentPlanRepairTarget(
        Guid AccountId,
        Guid TenantId,
        decimal TotalAmount,
        decimal DepositAmount,
        decimal FinancedAmount,
        decimal PlanTotal,
        int InstallmentCount);

    /// <summary>
    /// Hedefleri ve beklenen değerlerini konfigürasyondan STRICT okur. Eksik/bozuk her girdi
    /// istisnadır: sessizce atlanan bir kimlik, operatörün onardığını sandığı kaydın el değmemiş
    /// kalması demektir.
    /// </summary>
    private static List<InstallmentPlanRepairTarget> ParseRepairTargets(IConfiguration configuration)
    {
        var raw = configuration["Maintenance:RepairInstallmentPlanAccountIds"];
        if (string.IsNullOrWhiteSpace(raw))
        {
            throw new InvalidOperationException(
                "Maintenance:RepairInstallmentPlanDrift açık ama Maintenance:RepairInstallmentPlanAccountIds boş. "
                + "Para etkileyen bu bakım yalnızca AÇIKÇA listelenen cariler için çalışır; genel tarama yapılmaz.");
        }

        // BOŞ TOKEN ELENMEZ, HATA SAYILIR. RemoveEmptyEntries ile "id1,,id2", "id1," ve ",id1"
        // sessizce geçerli kabul ediliyordu: para etkileyen bir bakım ayarındaki yazım hatası fark
        // edilmeden geçiyor, operatör listenin tamamının okunduğunu sanıyordu.
        var ids = raw.Split(',', StringSplitOptions.TrimEntries);
        var targets = new List<InstallmentPlanRepairTarget>(ids.Length);
        var seen = new HashSet<Guid>();

        foreach (var entry in ids)
        {
            if (string.IsNullOrWhiteSpace(entry))
            {
                throw new InvalidOperationException(
                    "Maintenance:RepairInstallmentPlanAccountIds içinde boş girdi var (baştaki/sondaki ya da "
                    + "art arda gelen virgül). Liste yazım hatası sessizce yok sayılmaz; ayar düzeltilmeli.");
            }
            if (!Guid.TryParse(entry, out var accountId) || accountId == Guid.Empty)
            {
                throw new InvalidOperationException(
                    $"Maintenance:RepairInstallmentPlanAccountIds içinde geçersiz cari kimliği: '{entry}'. "
                    + "Hatalı kimlik sessizce atlanmaz; konfigürasyon düzeltilmeli.");
            }
            // MÜKERRER KİMLİK DE HATADIR: sessizce atlamak, operatörün yanlış yazdığı listeyi
            // "başarıyla uygulandı" gibi gösterirdi (ikinci kayıt aslında hedeflenmek istenen
            // BAŞKA bir cari olabilir).
            if (!seen.Add(accountId))
            {
                throw new InvalidOperationException(
                    $"Maintenance:RepairInstallmentPlanAccountIds içinde mükerrer cari kimliği: {accountId}. "
                    + "Liste her cariyi yalnız bir kez içermelidir.");
            }

            var section = configuration.GetSection($"Maintenance:RepairInstallmentPlanExpected:{accountId}");
            if (!section.Exists())
            {
                throw new InvalidOperationException(
                    $"Cari {accountId} için beklenen değerler yok "
                    + $"(Maintenance:RepairInstallmentPlanExpected:{accountId}:…). Bakım, doğrulanmamış bir kayda dokunmaz.");
            }

            var tenantIdRaw = section["TenantId"];
            if (!Guid.TryParse(tenantIdRaw, out var tenantId) || tenantId == Guid.Empty)
            {
                throw new InvalidOperationException(
                    $"Cari {accountId} için beklenen TenantId okunamadı: '{tenantIdRaw}'.");
            }

            var target = new InstallmentPlanRepairTarget(
                accountId,
                tenantId,
                ReadDecimal(section, accountId, "TotalAmount"),
                ReadDecimal(section, accountId, "DepositAmount"),
                ReadDecimal(section, accountId, "FinancedAmount"),
                ReadDecimal(section, accountId, "PlanTotal"),
                ReadInt(section, accountId, "InstallmentCount"));

            // Beklenen değerler KENDİ İÇİNDE tutarlı olmalı: finanse = toplam − peşinat ve plan
            // gerçekten sapmış (plan < finanse) olmalı. Tutarsız bir tuple, operatörün elindeki
            // rakamların bu kayda ait olmadığını gösterir.
            if (target.FinancedAmount != target.TotalAmount - target.DepositAmount)
            {
                throw new InvalidOperationException(
                    $"Cari {accountId}: beklenen FinancedAmount ({target.FinancedAmount}) "
                    + $"TotalAmount − DepositAmount ({target.TotalAmount - target.DepositAmount}) ile uyuşmuyor.");
            }
            if (target.InstallmentCount <= 0)
            {
                throw new InvalidOperationException(
                    $"Cari {accountId}: beklenen InstallmentCount pozitif olmalı (verilen: {target.InstallmentCount}).");
            }
            if (target.PlanTotal >= target.FinancedAmount)
            {
                throw new InvalidOperationException(
                    $"Cari {accountId}: beklenen PlanTotal ({target.PlanTotal}) finanse edilen tutarın "
                    + $"({target.FinancedAmount}) altında olmalı — bakım yalnızca 'plan eksik' yönünü onarır.");
            }

            targets.Add(target);
        }

        if (targets.Count == 0)
        {
            throw new InvalidOperationException(
                "Maintenance:RepairInstallmentPlanAccountIds geçerli bir cari kimliği içermiyor.");
        }
        return targets;
    }

    private static decimal ReadDecimal(IConfiguration section, Guid accountId, string key)
    {
        var raw = section[key];
        if (decimal.TryParse(raw, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var value))
        {
            return value;
        }
        throw new InvalidOperationException($"Cari {accountId}: beklenen {key} okunamadı ('{raw}'). Ondalık ayırıcı nokta olmalı.");
    }

    private static int ReadInt(IConfiguration section, Guid accountId, string key)
    {
        var raw = section[key];
        if (int.TryParse(raw, System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var value))
        {
            return value;
        }
        throw new InvalidOperationException($"Cari {accountId}: beklenen {key} okunamadı ('{raw}').");
    }

    /// <summary>
    /// TEK AÇILIŞTA ONARILACAK EN ÇOK CARİ — devre kesici.
    /// <para>
    /// Bu iş bilinen, DAR bir hatanın (elle güncellenen toplamın planı yeniden kurmaması) geride
    /// bıraktığı kayıtlar içindir; canlıda böyle TEK kayıt var. Hedef sayısı bunun üstüne çıkıyorsa
    /// ortada tek seferlik bir artık değil SİSTEMİK bir sorun vardır ve para etkileyen bir düzeltmeyi
    /// bu ölçekte otomatik uygulamak yanlış olur — iş HATA FIRLATIR, karar insana kalır.
    /// </para>
    /// </summary>
    private const int MaxInstallmentPlanRepairsPerRun = 25;

    /// <summary>
    /// <see cref="RepairInstallmentPlanDriftAsync(IServiceProvider, IConfiguration)"/>'ın test edilebilir
    /// gövdesi; onarılan cari sayısını döndürür — bu sayı DAİMA hedef sayısına eşittir, aksi hâlde
    /// istisna fırlatılmıştır.
    ///
    /// <para>
    /// FAIL-FAST: hedef listesi boşsa, sınır aşılmışsa, hedef cari yoksa, veritabanındaki değerler
    /// beklenen tuple ile eşleşmiyorsa ya da onarım uygulanamıyorsa istisna atılır. Eskiden bunların
    /// hepsi "0 onarıldı" ile sessizce geçiliyordu: operatör düzeltmenin yapıldığını sanıyor, kayıt
    /// el değmemiş kalıyordu.
    /// </para>
    /// <para>
    /// HEPSİ YA DA HİÇBİRİ. Hedefler eskiden AYRI transaction'larda onarılıp tek tek commit
    /// ediliyordu: A düzeltilip commit edildikten sonra B doğrulamada patlarsa açılış duruyor ama
    /// A'daki PARA ETKİLEYEN değişiklik kalıcı kalıyordu — "bir hedef hata verirse hiçbir veri
    /// değişmez" garantisi tutmuyordu. Artık iki fazlı ve TEK transaction: önce tüm hedefler kilit
    /// altında doğrulanır, sonra hepsi hizalanır, en sonda tek <c>SaveChanges</c> + commit yapılır.
    /// Herhangi bir aşamadaki hata tamamını geri alır.
    /// </para>
    /// </summary>
    public static async Task<int> RepairInstallmentPlanDriftAsync(
        GuzellikDbContext db, ILogger? logger, IReadOnlyCollection<InstallmentPlanRepairTarget> targets)
    {
        if (targets is null || targets.Count == 0)
        {
            throw new InvalidOperationException(
                "Taksit planı bakımı hedefsiz çalıştırılamaz: onarılacak cariler açıkça verilmelidir.");
        }

        if (targets.Count > MaxInstallmentPlanRepairsPerRun)
        {
            throw new InvalidOperationException(
                $"Taksit planı bakımı {targets.Count} cari için istendi (sınır {MaxInstallmentPlanRepairsPerRun}). "
                + "Bu, bilinen tek seferlik artığın ötesinde; para etkileyen düzeltme bu ölçekte otomatik uygulanmaz.");
        }

        var relational = db.Database.IsRelational();
        await using var tx = relational && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted)
            : null;

        // FAZ 1 — TÜM hedefleri kilitle ve doğrula. Hiçbir yazma yapılmaz; ilk uyuşmazlıkta
        // istisna atılır ve transaction (varsa) dispose ile geri alınır.
        // Kilitler ID sırasına göre alınır (RowLock protokolü): aynı anda açılan iki backend
        // hedefleri aynı sırayla kilitler, çapraz bekleme oluşmaz.
        var pending = new List<ValidatedRepairTarget>(targets.Count);
        var alreadyAligned = 0;
        foreach (var target in targets.OrderBy(t => t.AccountId))
        {
            var validated = await LockAndValidateRepairTargetAsync(db, target, relational);
            if (validated is null) alreadyAligned++;   // bakım bu kayıtta ZATEN uygulanmış
            else pending.Add(validated);
        }

        // FAZ 2 — hizalama (bellekte) + TEK kalıcılık noktası.
        foreach (var item in pending)
        {
            if (!item.Account.RealignInstallmentAmounts())
                throw new InvalidOperationException($"Hedef cari {item.Target.AccountId}: taksit tutarları hizalanamadı.");
        }

        if (pending.Count > 0)
        {
            await db.SaveChangesAsync();
            if (tx is not null) await tx.CommitAsync();
        }

        // Para etkileyen düzeltme: hangi kayıt, ne kadar kaymıştı — izlenebilir kalsın.
        foreach (var item in pending)
        {
            logger?.LogInformation(
                "Cari {AccountId}: plan {Before} → {After} (taksit {Count}; satır kimlikleri ve vadeler korundu).",
                item.Target.AccountId, item.PlanTotalBefore, item.FinancedAmount, item.InstallmentCount);
        }
        if (alreadyAligned > 0)
        {
            logger?.LogInformation(
                "{Count} hedef zaten hizalıydı (bakım daha önce uygulanmış) — hiçbir değişiklik yapılmadı.",
                alreadyAligned);
        }
        return pending.Count + alreadyAligned;
    }

    /// <summary>Kilit altında doğrulanmış hedef: hizalama bu nesne üzerinden yapılır.</summary>
    private sealed record ValidatedRepairTarget(
        InstallmentPlanRepairTarget Target,
        CustomerAccount Account,
        decimal PlanTotalBefore,
        decimal FinancedAmount,
        int InstallmentCount);

    /// <summary>
    /// TEK CARİYİ KİLİT ALTINDA OKUR VE BEKLENEN DEĞERLERİNİ DOĞRULAR — hiçbir şey YAZMAZ.
    /// Uyuşmayan her durum istisnadır; hizalama çağıranın FAZ 2'sinde, tek transaction içinde yapılır.
    ///
    /// <para>
    /// PARA ETKİLEYEN YAZMA, İSTEK YOLUNDAKİYLE AYNI PROTOKOLE UYAR (bkz. <see cref="RowLock"/>):
    /// <c>customer_accounts</c> satır kilidi + kilitten SONRA taze okuma. Kilitsiz sürüm iki riski
    /// taşıyordu: (1) iki backend aynı anda açılırsa ikisi de sapmayı görüp planı ayrı ayrı
    /// yazıyordu; (2) okuma ile yazma arasında bir kullanıcı toplamı güncellerse onarım BAYAT
    /// tutara göre bölüyordu. Kilit çağıranın transaction'ı boyunca durur.
    /// </para>
    /// <para>
    /// BEKLENEN TUPLE KİLİT ALTINDA DOĞRULANIR: kurum, toplam, peşinat, finanse edilen tutar, plan
    /// toplamı ve aktif taksit sayısı operatörün verdiği değerlerle BİREBİR eşleşmezse yazma
    /// yapılmaz. Böylece yanlış kimlik girilmesi, kaydın arada değişmiş olması ya da yedekten
    /// dönülmüş bir veritabanına aynı ayarla açılmak sessiz bir mutasyona dönüşemez.
    /// </para>
    /// <para>
    /// Plan YENİDEN KURULMAZ, tutarlar yerinde düzeltilir
    /// (<see cref="CustomerAccount.RealignInstallmentAmounts"/>): taksit kimlikleri, durumları,
    /// ödeme damgaları ve elle girilmiş vadeler korunur.
    /// </para>
    /// </summary>
    /// <returns>
    /// Onarılacak hedef; kayıt ZATEN hedeflenen duruma getirilmişse <c>null</c> (idempotent başarı).
    /// </returns>
    private static async Task<ValidatedRepairTarget?> LockAndValidateRepairTargetAsync(
        GuzellikDbContext db, InstallmentPlanRepairTarget target, bool relational)
    {
        var accountId = target.AccountId;

        if (relational && !await RowLock.LockRowAsync(db, "customer_accounts", accountId, CancellationToken.None))
            throw new InvalidOperationException($"Hedef cari {accountId} bulunamadı (satır kilitlenemedi).");

        // HEDEFLİ DETACH (genel ChangeTracker.Clear DEĞİL — o, dış akışın bekleyen değişikliklerini
        // de silerdi): izleyicide bu cariye ait bayat bir kopya varsa sorgu onu DÖNDÜRÜR ve
        // "kilitten sonra taze oku" protokolü hiçbir şey korumaz.
        DetachAccountAggregate(db, accountId);

        var account = await db.CustomerAccounts.IgnoreQueryFilters()
            .Include(a => a.Installments)
            .FirstOrDefaultAsync(a => a.Id == accountId);
        if (account is null)
            throw new InvalidOperationException($"Hedef cari {accountId} bulunamadı.");
        if (account.IsDeleted || account.CancelledAtUtc is not null)
            throw new InvalidOperationException($"Hedef cari {accountId} silinmiş ya da iptal edilmiş; bakım uygulanmaz.");

        var activePlan = account.Installments
            .Where(i => !i.IsDeleted && i.Status != InstallmentStatus.Cancelled)
            .ToList();

        var financed = account.TotalAmount - account.DepositAmount;
        var before = activePlan.Sum(i => i.Amount);

        // KİMLİK ALANLARI HER DURUMDA TUTMALI: yanlış cari ya da yedekten dönülmüş başka bir
        // veritabanı burada yakalanır (bunlar "zaten uygulanmış" sayılamaz).
        Expect(accountId, "TenantId", target.TenantId, account.TenantId);
        Expect(accountId, "TotalAmount", target.TotalAmount, account.TotalAmount);
        Expect(accountId, "DepositAmount", target.DepositAmount, account.DepositAmount);
        Expect(accountId, "FinancedAmount", target.FinancedAmount, financed);
        Expect(accountId, "InstallmentCount", target.InstallmentCount, activePlan.Count);

        // ÜÇ DURUM AYRILIR (bakım İDEMPOTENT olmalı):
        //
        //   plan == beklenen ESKİ değer  → onarılacak
        //   plan == finanse edilen tutar → ZATEN UYGULANMIŞ, sessizce başarı
        //   bunların dışında            → fail-fast
        //
        // Üçüncü durum eskiden ikinciyi de kapsıyordu: ilk instance planı 8.500 → 8.750 yapıyor,
        // aynı ayarla açılan İKİNCİ instance hâlâ 8.500 beklediği için istisna atıyor ve SERVİS
        // AÇILMIYORDU. Rolling deploy'da (iki instance) ya da commit sonrası herhangi bir açılış
        // hatasından sonra yeniden başlatmada bu, erişilebilirlik kaybı demekti. Kilit altında
        // taze okunan plan zaten hedef değerdeyse yapacak iş yoktur.
        if (before == financed)
        {
            return null;
        }

        Expect(accountId, "PlanTotal", target.PlanTotal, before);

        if (financed <= 0 || before > financed)
        {
            throw new InvalidOperationException(
                $"Hedef cari {accountId}: beklenen sapma yok (finanse {financed}, plan {before}). "
                + "Bakım yalnızca 'plan eksik' yönünü onarır.");
        }

        return new ValidatedRepairTarget(target, account, before, financed, activePlan.Count);
    }

    /// <summary>Beklenen ile gerçekleşen değer aynı değilse bakımı durdurur (hiçbir yazma yapılmadan).</summary>
    private static void Expect<T>(Guid accountId, string field, T expected, T actual)
    {
        if (EqualityComparer<T>.Default.Equals(expected, actual)) return;
        throw new InvalidOperationException(
            $"Hedef cari {accountId}: {field} beklenenle uyuşmuyor (beklenen {expected}, veritabanında {actual}). "
            + "Hiçbir veri değiştirilmedi.");
    }

    /// <summary>Bir cariyi ve taksitlerini izleyiciden düşürür (bkz. <c>AdisyonService.DetachAdisyonAggregate</c>).</summary>
    private static void DetachAccountAggregate(GuzellikDbContext db, Guid accountId)
    {
        foreach (var entry in db.ChangeTracker.Entries<Installment>()
                     .Where(e => e.Entity.CustomerAccountId == accountId).ToList())
        {
            entry.State = EntityState.Detached;
        }
        foreach (var entry in db.ChangeTracker.Entries<CustomerAccount>()
                     .Where(e => e.Entity.Id == accountId).ToList())
        {
            entry.State = EntityState.Detached;
        }
    }

    /// <summary>
    /// PEŞİNATLARI GERÇEK TAHSİLAT HAREKETİNE TAŞIR — her ortamda çalışır, idempotenttir.
    /// <para>
    /// <c>DepositAmount</c> yalnız bir kolondu: cari onu "tahsil edilmiş" sayıyor ama kasa akışı,
    /// kâr-zarar ve raporlar sadece <c>account_payments</c> okuduğu için para hiçbir finans
    /// defterinde görünmüyordu. Satış iptal edilirse peşinat kadarına iade yapılabiliyor, ama
    /// karşılığında arşivlenecek bir tahsilat bulunmuyordu (gelir 0 / gider peşinat).
    /// </para>
    /// <para>
    /// Buradan sonra peşinat cari açılırken otomatik tahsilat satırı üretir; bu iş yalnızca ESKİ
    /// kayıtlar içindir. Kolon PLAN alanı olarak yerinde kalır (taksit matematiği değişmesin).
    /// Şifreli <c>Reference</c> alanı SQL'de süzülemediğinden kontrol uygulama tarafında yapılır.
    /// </para>
    /// </summary>
    public static async Task BackfillDepositPaymentsAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DepositPaymentBackfill");

        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            if (db.Database.IsInMemory()) return;

            var accounts = await db.CustomerAccounts.IgnoreQueryFilters()
                .Where(a => !a.IsDeleted && a.DepositAmount > 0m)
                .Select(a => new { a.Id, a.DepositAmount, a.SoldAtUtc })
                .ToListAsync();
            if (accounts.Count == 0) return;

            var paidByAccount = await LoadDepositAccountPaymentTotalsAsync(db);

            var added = 0;
            foreach (var account in accounts)
            {
                if (IsDepositCovered(paidByAccount, account.Id, account.DepositAmount)) continue;

                // Tahsilat DOĞRUDAN eklenir: cari nesnesini izlemeye almak (ve Touch ile UPDATE
                // üretmek) gereksiz — kolon değişmiyor, yalnız yeni bir satır doğuyor.
                // Id CARININ Id'sidir: iki backend ayni anda acilirsa ikinci ekleme birincil anahtar
                // catismasiyla reddedilir -> mukerrer pesinat tahsilati olusamaz.
                db.AccountPayments.Add(AccountPayment.ForDeposit(
                    account.Id,
                    account.DepositAmount,
                    "cash",
                    DateTime.SpecifyKind(account.SoldAtUtc, DateTimeKind.Utc)));
                added++;
            }

            if (added == 0) return;
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                // Yarisi baska bir ornek kazandi; veri zaten dogru -> sessizce gec.
                // KAPSAM YİNE DE DOĞRULANIR: yarışı kaybettiğimizi VARSAYMAK yetmez, diğer örnek
                // gerçekten tamamlamış olmalı (aksi hâlde eksik peşinatla trafik açılırdı).
                logger.LogInformation(ex, "Peşinat taşıma yarışı başka bir örnek tarafından tamamlandı; kapsam doğrulanıyor.");
                db.ChangeTracker.Clear();
                await EnsureDepositCoverageAsync(db, logger);
                return;
            }
            logger.LogInformation("{Count} peşinat gerçek tahsilat hareketine taşındı.", added);
        }
        catch (Exception ex)
        {
            // FAIL-OPEN DEĞİL: peşinat taşınamadıysa cari "tahsil edilmiş" sayarken kasa/rapor o
            // parayı görmez — uygulama bu durumda trafik ALMAMALI. İş veri-only ve idempotenttir;
            // hata gerçek bir sorunun (şema, bağlantı, veri) işaretidir ve açılışı durdurmalıdır.
            logger.LogError(ex, "Peşinat taşıma işi tamamlanamadı; açılış durduruluyor (peşinatlar kasa defterinde eksik kalırdı).");
            throw;
        }
    }

    /// <summary>
    /// PEŞİNATI OLAN CARİLERİN CANLI TAHSİLAT TOPLAMI (kapsam ölçütünün TEK kaynağı).
    ///
    /// <para>
    /// KAPSAM ÖLÇÜTÜ "İŞARET" DEĞİL "PARA"DIR. Eskiden bir peşinat satırı yalnız iki İŞARETTEN
    /// biriyle tanınıyordu: deterministik Id (<c>payment.Id == account.Id</c>) ya da "Peşinat"
    /// referansı. ADİSYONDAN doğan satışlar bu işaretlerin İKİSİNİ DE taşımaz — fişin ödeme
    /// kalemleri normal <c>RegisterPaymentAsync</c> ile, rastgele Id ve <c>ADS-…</c> referansıyla
    /// yazılır (yöntem kırılımı korunsun diye bilinçli; bkz. AdisyonService 6. adım). Taksitli
    /// satışta peşinat kolonu da doldurulduğundan (12 Ağu) bu cariler "kapsanmamış" görünüyor ve
    /// açılıştaki taşıma işi peşinatı İKİNCİ KEZ yazıyordu.
    /// <b>CANLIDA YAŞANDI:</b> tek bir açılışta üç caride 24.000 TL mükerrer tahsilat üretildi
    /// (35 kayıt/127.730 TL → 38 kayıt/151.730 TL) ve sürüm geri alınmak zorunda kaldı.
    /// </para>
    /// <para>
    /// Doğru soru "peşinat işaretli bir satır var mı" değil, <b>"bu paranın karşılığı defterde
    /// zaten duruyor mu"</b>: carinin canlı tahsilat toplamı peşinatı karşılıyorsa para
    /// defterdedir, ikinci satır yalnızca geliri şişirir. Ölçüt işaretlerden bağımsız olduğu için
    /// yeni bir yazma yolu eklendiğinde de sessizce bozulmaz.
    /// </para>
    /// <para>
    /// Bu ölçüt eski davranıştan yalnız TEK yönde ayrılır: şüphede <b>eklemez</b>. Peşinatı kadar
    /// parası zaten görünen bir caride ikinci satır açılmaz — para gerçekten eksikse (hiç tahsilat
    /// yok ya da toplam peşinatın altında) taşıma eskisi gibi çalışır.
    /// </para>
    /// <para>
    /// SİLİNMİŞ TAHSİLAT SAYILMAZ: <c>IgnoreQueryFilters</c> soft-delete süzgecini de kapatır;
    /// silinmiş satır kapsam sayılsaydı cari fiilen peşinatsız kalır ve uygulama EKSİK kasa
    /// defteriyle açılırdı. Süzme sunucuda yapılır — yerel Guid listesiyle <c>.Contains()</c>
    /// bu sağlayıcıda çevrilemiyor ([[project_mysql_query_gotchas]]).
    /// </para>
    /// </summary>
    private static async Task<Dictionary<Guid, decimal>> LoadDepositAccountPaymentTotalsAsync(GuzellikDbContext db)
        => (await db.AccountPayments.IgnoreQueryFilters()
                .Where(x => !x.IsDeleted && db.CustomerAccounts.IgnoreQueryFilters()
                    .Any(a => a.Id == x.CustomerAccountId && !a.IsDeleted && a.DepositAmount > 0m))
                .Select(x => new { x.CustomerAccountId, x.Amount })
                .ToListAsync())
            .GroupBy(x => x.CustomerAccountId)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));

    /// <summary>
    /// Peşinatın karşılığı defterde duruyor mu? Ana döngü ile doğrulama AYNI yanıtı vermek
    /// ZORUNDA — ölçüt bu yüzden tek bir yerde durur (iki kopya sessizce ayrışmıştı).
    /// Kuruş toleransı: <c>decimal</c> toplamı tam eşitlikte takılmasın.
    /// </summary>
    private static bool IsDepositCovered(IReadOnlyDictionary<Guid, decimal> paidByAccount, Guid accountId, decimal deposit)
        => paidByAccount.TryGetValue(accountId, out var paid) && paid >= deposit - 0.005m;

    /// <summary>
    /// Taşınmamış peşinat KALDI MI? Yarış sonrası çağrılır: "diğer örnek hallettiyse" varsayımı
    /// doğrulanır. Eksik varsa istisna atılır — açılış durur.
    /// </summary>
    private static async Task EnsureDepositCoverageAsync(GuzellikDbContext db, ILogger logger)
    {
        var accounts = await db.CustomerAccounts.IgnoreQueryFilters()
            .Where(a => !a.IsDeleted && a.DepositAmount > 0m)
            .Select(a => new { a.Id, a.DepositAmount })
            .ToListAsync();
        if (accounts.Count == 0) return;

        var paidByAccount = await LoadDepositAccountPaymentTotalsAsync(db);
        var missing = accounts.Count(a => !IsDepositCovered(paidByAccount, a.Id, a.DepositAmount));
        if (missing == 0) return;

        logger.LogError("{Count} carinin peşinatı hâlâ tahsilat hareketine taşınmamış.", missing);
        throw new InvalidOperationException(
            $"{missing} carinin peşinatı tahsilat hareketine taşınamadı; uygulama eksik kasa defteriyle açılmamalı.");
    }

    /// <summary>
    /// ESKİ TAHSİLAT VE STOK HAREKETLERİNE KAYNAK ADİSYON BAĞI YAZAR (idempotent, her ortamda).
    /// <para>
    /// Bağ eskiden yalnız <c>Reference</c> metnindeydi ("ADS-…"). Bu kolon AES-GCM ile ve RASTGELE
    /// nonce ile şifreli olduğundan aynı metin her seferinde farklı ciphertext üretir → SQL
    /// eşitliği hiçbir zaman eşleşmiyordu. Sonuç: onaylı adisyon silinirken tahsilat bulunamıyor ve
    /// para kasada kalıyor, stok ters kaydı satış anındaki maliyeti bulamıyordu.
    /// </para>
    /// <para>
    /// Burada değer uygulama içinde ÇÖZÜLÜP ("ADS-" + adisyon Id'sinin ilk 12 hex hanesi) mevcut
    /// adisyonlarla eşlenir ve deterministik kolona yazılır. Eşleşmeyen satırlara dokunulmaz.
    /// </para>
    /// </summary>
    public static async Task BackfillAdisyonSourceLinksAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("AdisyonSourceLinkBackfill");
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            if (db.Database.IsInMemory()) return;

            // Referans, adisyon Id'sinin ilk 12 hex hanesini taşır (16 karaktere kırpılmış "ADS-…").
            // KİMLİK EŞLEŞMESİ ŞART: referans KULLANICI TARAFINDAN yazılabilen serbest bir alandır.
            // Elle girilmiş bağımsız bir tahsilata "ADS-…" biçimli bir metin yazılırsa, bu backfill
            // onu o fişin ödemesi sanıp bağlıyor; fiş sonradan silindiğinde ALAKASIZ tahsilat da
            // kasadan siliniyordu. Bu yüzden adisyonun müşteri/cari kimliği de doğrulanır.
            var adisyonInfo = (await db.Adisyonlar.IgnoreQueryFilters()
                    .Select(a => new { a.Id, a.CustomerId, a.CustomerAccountId, a.BranchId, a.CreatedAtUtc })
                    .ToListAsync())
                .GroupBy(a => "ADS-" + a.Id.ToString("N")[..12])
                .Where(g => g.Count() == 1) // aynı önekte iki fiş varsa (astronomik) dokunma
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
            if (adisyonInfo.Count == 0) return;

            var linkedPayments = 0;
            foreach (var payment in await db.AccountPayments.IgnoreQueryFilters()
                         .Where(x => x.SourceAdisyonId == null && x.Reference != null)
                         .ToListAsync())
            {
                if (payment.Reference is not { } r || !adisyonInfo.TryGetValue(r.Trim(), out var adisyon)) continue;

                // TAM CARİ EŞLEŞMESİ ZORUNLU. Eskiden "aynı MÜŞTERİNİN başka bir carisi" de kabul
                // ediliyordu: müşteriye elle girilen BAĞIMSIZ bir tahsilata "ADS-…" biçimli bir
                // açıklama yazmak yetiyor, o tahsilat fişin ödemesi sanılıyordu — fiş silinince
                // alakasız para kasadan siliniyordu. Adisyonun ürettiği tahsilat HER ZAMAN
                // adisyonun KENDİ carisine yazılır; başka cari eşleşmesi kanıt değildir.
                if (adisyon.CustomerAccountId != payment.CustomerAccountId) continue;

                // ZAMAN YÖNÜ: bir fişin tahsilatı fişten ÖNCE oluşturulmuş olamaz. (İş tarihi
                // geriye alınabildiği için OccurredAtUtc değil, SATIR oluşturma anı kullanılır.)
                if (payment.CreatedAtUtc < adisyon.CreatedAtUtc) continue;

                payment.LinkToAdisyon(adisyon.Id);
                linkedPayments++;
            }

            // Stok hareketinde cari/müşteri kimliği yok; fişin O ÜRÜNÜ gerçekten içerdiği
            // doğrulanır (referans metnine tek başına güvenilmez).
            var adisyonProducts = (await db.AdisyonItems.IgnoreQueryFilters()
                    .Where(i => i.Type == Domain.Enums.AdisyonItemType.Product && i.RefId != null)
                    .Select(i => new { i.AdisyonId, ProductId = i.RefId!.Value })
                    .ToListAsync())
                .GroupBy(x => x.AdisyonId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.ProductId).ToHashSet());

            var linkedMovements = 0;
            foreach (var movement in await db.StockMovements.IgnoreQueryFilters()
                         .Where(x => x.SourceAdisyonId == null && x.Reference != null)
                         .ToListAsync())
            {
                if (movement.Reference is not { } r || !adisyonInfo.TryGetValue(r.Trim(), out var adisyon)) continue;
                if (!adisyonProducts.TryGetValue(adisyon.Id, out var products) || !products.Contains(movement.ProductId)) continue;

                // TÜR EŞLEŞMESİ: adisyon onayı yalnız SATIŞ hareketi üretir. Elle girilen giriş,
                // sayım düzeltmesi ya da fire hareketi fişin ürettiği hareket DEĞİLDİR; bağlanırsa
                // fiş silindiğinde yanlış hareket ters çevrilip stok maliyeti bozulurdu.
                if (movement.Type != Domain.Enums.StockMovementType.Sale) continue;

                // ZAMAN YÖNÜ: fişten önce oluşmuş bir hareket o fişin sonucu olamaz.
                if (movement.CreatedAtUtc < adisyon.CreatedAtUtc) continue;

                movement.LinkToAdisyon(adisyon.Id);
                linkedMovements++;
            }

            if (linkedPayments == 0 && linkedMovements == 0) return;
            await db.SaveChangesAsync();
            logger.LogInformation(
                "Kaynak adisyon bağı yazıldı: {Payments} tahsilat, {Movements} stok hareketi.",
                linkedPayments, linkedMovements);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Adisyon kaynak bağı backfill'i tamamlanamadı; eski kayıtlar eşleşmeyebilir.");
        }
    }

    /// <summary>
    /// ESKİ PAKET KULLANIMLARINA KESİN SEANS BAĞI ÜRETİR (idempotent, her ortamda).
    /// <para>
    /// <c>package_session_usages</c> yalnız YENİ onaylarda doluyor. Bağı olmayan eski adisyonlarda
    /// satış iptali tahminî yönteme düşüyor; müşterinin aynı hizmeti içeren ikinci bir paketi varsa
    /// YANLIŞ pakete kredi yazılabiliyor. Burada tahminin hâlâ TEK doğru cevabı olduğu durumlar
    /// (o hizmet için kullanılmış tek seans kaydı) kalıcı bağa çevrilir; birden çok aday varsa
    /// DOKUNULMAZ — yanlış bağ yazmaktansa eski davranışta kalmak yeğdir.
    /// </para>
    /// </summary>
    /// <summary>
    /// "Paket alındı ve AYNI ziyarette kullanıldı" durumunda seans satırı ile kullanım kalemi
    /// aynı saniyelere düşer; satır yazım sırası garanti değildir. Bu küçük pay o meşru durumu
    /// kapsar, sonradan (günler sonra) alınmış bir paketi kapsamaz.
    /// </summary>
    private static readonly TimeSpan PackageUsageClockGrace = TimeSpan.FromMinutes(5);

    public static async Task BackfillPackageSessionUsagesAsync(IServiceProvider services)
    {
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("PackageUsageBackfill");
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            if (db.Database.IsInMemory()) return;

            // KALEM bazında bakılır, ADİSYON bazında değil: bir fişte tek kalem bağlıysa diğer
            // kalemler de "kapsandı" sayılıp atlanıyor, iptalde o seanslar geri verilmiyordu.
            var linkedItemIds = (await db.PackageSessionUsages.IgnoreQueryFilters()
                .Select(u => u.AdisyonItemId).Distinct().ToListAsync()).ToHashSet();

            var items = await db.AdisyonItems.IgnoreQueryFilters()
                .Where(i => !i.IsDeleted && i.Type == Domain.Enums.AdisyonItemType.PackageUse && i.RefId != null)
                .Join(db.Adisyonlar.IgnoreQueryFilters().Where(a => !a.IsDeleted && a.Status == Domain.Enums.AdisyonStatus.Approved),
                      i => i.AdisyonId, a => a.Id,
                      (i, a) => new { Item = i, a.TenantId, a.CustomerId })
                .ToListAsync();
            if (items.Count == 0) return;

            var added = 0;
            foreach (var row in items.Where(x => !linkedItemIds.Contains(x.Item.Id)))
            {
                var customerId = row.CustomerId;
                var serviceId = row.Item.RefId!.Value;

                // SEANS, KULLANIMDAN ÖNCE VAR OLMUŞ OLMALI.
                //
                // SOMUT AÇIK: aday süzgeci yalnız (müşteri + hizmet + kullanılmış seans) bakıyordu,
                // ZAMANA hiç bakmıyordu. Müşteri eski paketini bitirip AYNI hizmetten YENİ bir paket
                // aldığında tek aday yeni paket oluyor ve ESKİ satışın kullanımı ona bağlanıyordu;
                // o eski satış iptal edilince hak, hiç ilgisi olmayan yeni pakete iade ediliyordu.
                // Kullanım kaydından sonra açılmış bir seans, o kullanımın kaynağı OLAMAZ.
                var existedBefore = row.Item.CreatedAtUtc + PackageUsageClockGrace;
                var candidates = await db.CustomerPackageSessions.IgnoreQueryFilters()
                    .Where(x => !x.IsDeleted && x.TenantId == row.TenantId && x.CustomerId == customerId
                                && x.ServiceDefinitionId == serviceId && x.UsedSessions > 0
                                && x.CreatedAtUtc <= existedBefore)
                    .Select(x => x.Id)
                    .ToListAsync();

                // Tek aday = tahmin ile kesin bilgi aynı → güvenle bağla. Birden çoksa atla.
                if (candidates.Count != 1) continue;

                var quantity = (int)Math.Max(1, Math.Round(row.Item.Quantity, MidpointRounding.AwayFromZero));
                db.PackageSessionUsages.Add(new PackageSessionUsage(
                    row.TenantId, row.Item.AdisyonId, row.Item.Id, candidates[0],
                    row.CustomerId, serviceId, quantity, row.Item.CreatedAtUtc));
                added++;
            }

            if (added == 0) return;
            await db.SaveChangesAsync();
            logger.LogInformation("{Count} eski paket kullanımı kesin seans bağına taşındı.", added);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Paket kullanımı bağ backfill'i tamamlanamadı; eski kayıtlar tahminî yolda kalır.");
        }
    }

    /// <summary>
    /// WhatsApp faturalama başlangıç verisi: kategori fiyat kuralları, kontör paketleri, genel ayar (kur/tavan).
    /// Idempotent — yalnızca hiç kural yoksa ekler. Ayrıca eski (per-tenant token'la çalışan) WhatsApp
    /// bağlantılarını yeni ConnectionStatus modeline taşır (canlı gönderim kopmadan devam etsin).
    /// </summary>
    private static async Task SeedWhatsAppBillingAsync(GuzellikDbContext db, ILogger logger)
    {
        try
        {
            // 1) Genel ayar (singleton) — yoksa gerçekçi kur ile oluştur.
            if (!await db.WhatsAppBillingSettings.AnyAsync())
            {
                var settings = new Domain.Entities.WhatsAppBillingSettings();
                // 22 Tem 2026 yaklaşık kur; tavan ₺500; otomatik onay KAPALI (her yükleme platform onayından geçer).
                settings.Update(billingEnabled: true, chargeSimulated: false, usdTryRate: 47.21m,
                    lowBalanceThresholdTry: 50m, defaultMonthlySpendCapTry: 500m, autoApproveTopUps: false);
                db.WhatsAppBillingSettings.Add(settings);
            }

            // 2) Kategori fiyatları — yoksa Meta liste fiyatı + makul satış marjı ile ekle.
            if (!await db.WhatsAppPricingRules.AnyAsync())
            {
                var from = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                db.WhatsAppPricingRules.AddRange(
                    new Domain.Entities.WhatsAppPricingRule(Domain.Enums.WhatsAppMessageCategory.Utility, 0.0009m, 0.15m, from, "İşlemsel hatırlatma/onay"),
                    new Domain.Entities.WhatsAppPricingRule(Domain.Enums.WhatsAppMessageCategory.Authentication, 0.0009m, 0.15m, from, "Doğrulama kodu"),
                    new Domain.Entities.WhatsAppPricingRule(Domain.Enums.WhatsAppMessageCategory.Marketing, 0.0109m, 0.90m, from, "Kampanya/indirim"),
                    new Domain.Entities.WhatsAppPricingRule(Domain.Enums.WhatsAppMessageCategory.Service, 0m, 0m, from, "Müşteri 24s serbest yanıt (ücretsiz)"));
            }

            // 3) Kontör paketleri — yoksa 3 varsayılan paket.
            if (!await db.WhatsAppCreditPackages.AnyAsync())
            {
                db.WhatsAppCreditPackages.AddRange(
                    new Domain.Entities.WhatsAppCreditPackage("Başlangıç Kontör", 150m, 150m, 1, "≈1.000 hatırlatma mesajı"),
                    new Domain.Entities.WhatsAppCreditPackage("Standart Kontör", 350m, 375m, 2, "≈2.500 hatırlatma + bonus"),
                    new Domain.Entities.WhatsAppCreditPackage("Büyük Kontör", 650m, 750m, 3, "≈5.000 hatırlatma + bonus"));
            }

            await db.SaveChangesAsync();

            // 4) Eski bağlantıları taşı: Enabled + numara + token varsa ama durum NotConnected ise → Connected.
            var legacy = await db.WhatsAppSettings.IgnoreQueryFilters()
                .Where(s => !s.IsDeleted && s.Enabled
                         && s.PhoneNumberId != null && s.AccessTokenEncrypted != null
                         && s.ConnectionStatus == Domain.Enums.WhatsAppConnectionStatus.NotConnected)
                .ToListAsync();
            foreach (var s in legacy)
                s.SetConnectionStatus(Domain.Enums.WhatsAppConnectionStatus.Connected);
            if (legacy.Count > 0)
            {
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} eski WhatsApp bağlantısı yeni modele (Connected) taşındı.", legacy.Count);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "WhatsApp faturalama başlangıç verisi eklenemedi (şema henüz yok olabilir).");
        }
    }

    /// <summary>
    /// Yalnızca varsayılan abonelik planlarını ekler (key bazlı, idempotent). Collation/DDL veya demo verisi
    /// YAPMAZ. Her ortamda güvenle çağrılabilir; production'da opsiyonel (Database:SeedReferenceData=true) olarak
    /// kullanılır. Şema henüz yoksa hata loglanır ve sessizce geçilir.
    /// </summary>
    public static async Task EnsureDefaultSubscriptionPlansAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");
        await SeedSubscriptionPlansAsync(db, logger);
        await SeedWhatsAppBillingAsync(db, logger);
    }

    private static readonly string[] CollationSensitiveTables =
    {
        "customer_package_sessions", "adisyonlar", "adisyon_items",
        "staff_commissions", "staff_time_offs", "campaigns", "loyalty_transactions",
    };

    private static async Task AlignFeatureTableCollationsAsync(GuzellikDbContext db, ILogger logger)
    {
        try
        {
            // Referans: çekirdek 'customers' tablosunun collation'ı (JOIN'lerin diğer ucu).
            var reference = await GetTableCollationAsync(db, "customers");
            if (string.IsNullOrWhiteSpace(reference) || !IsSafeIdentifier(reference)) return;
            var charset = reference.Split('_')[0]; // utf8mb4_0900_ai_ci → utf8mb4
            if (!IsSafeIdentifier(charset)) return;

            foreach (var table in CollationSensitiveTables)
            {
                var current = await GetTableCollationAsync(db, table);
                if (current is null) continue; // tablo yoksa atla
                if (string.Equals(current, reference, StringComparison.OrdinalIgnoreCase)) continue; // zaten uyumlu

                try
                {
                    // reference/charset bilgisi information_schema'dan gelir (sistem değeri) ve IsSafeIdentifier ile
                    // doğrulanır; tablo adı sabit listeden gelir. DDL'de identifier/charset/collation parametre
                    // edilemediğinden interpolasyon zorunlu ve güvenlidir → EF1002 bilinçli olarak bastırılıyor.
#pragma warning disable EF1002
                    await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE `{table}` CONVERT TO CHARACTER SET {charset} COLLATE {reference};");
#pragma warning restore EF1002
                    logger.LogInformation("Collation hizalandı: {Table} → {Collation}", table, reference);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Collation hizalama hatası: {Table}", table);
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Collation hizalama taraması atlandı.");
        }
    }

    private static async Task<string?> GetTableCollationAsync(GuzellikDbContext db, string tableName)
    {
        var conn = db.Database.GetDbConnection();
        var shouldClose = conn.State != System.Data.ConnectionState.Open;
        if (shouldClose) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t LIMIT 1;";
            var p = cmd.CreateParameter();
            p.ParameterName = "@t";
            p.Value = tableName;
            cmd.Parameters.Add(p);
            var result = await cmd.ExecuteScalarAsync();
            return result as string;
        }
        finally
        {
            if (shouldClose) await conn.CloseAsync();
        }
    }

    private static bool IsSafeIdentifier(string value) =>
        System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9_]+$");

    private static async Task SeedSubscriptionPlansAsync(GuzellikDbContext db, ILogger logger)
    {
        // 5 default plan — sadece PlanKey yoksa eklenir, idempotent.
        // (Name LONGTEXT şifreli, ham SQL yok; EF üzerinden insert ediyoruz.)
        // Feature CSV'leri FeatureCatalog sabitlerini referans alır.

        var starter = string.Join(',', new[]
        {
            FeatureCatalog.ExcelCustomers,
            FeatureCatalog.NotificationsEmail,
            FeatureCatalog.NotificationsTemplates,
        });

        var pro = string.Join(',', new[]
        {
            FeatureCatalog.ExcelCustomers, FeatureCatalog.ExcelAppointments,
            FeatureCatalog.ExcelServices, FeatureCatalog.ExcelStaff,
            FeatureCatalog.PdfReports, FeatureCatalog.PdfCredentials,
            FeatureCatalog.ReportsFinance, FeatureCatalog.ReportsCustomer,
            FeatureCatalog.NotificationsEmail, FeatureCatalog.NotificationsSms,
            FeatureCatalog.NotificationsTemplates, FeatureCatalog.NotificationsAutomation,
            FeatureCatalog.AccountingInstallments, FeatureCatalog.AccountingPayments,
            FeatureCatalog.BillingAdisyon,
            FeatureCatalog.MultiBranch, FeatureCatalog.StaffPermissions,
            FeatureCatalog.StaffCommission, FeatureCatalog.StaffSchedule,
            FeatureCatalog.MarketingCampaigns, FeatureCatalog.LoyaltyPoints,
            FeatureCatalog.MarketingGiftCards, FeatureCatalog.FinanceCashClosing, FeatureCatalog.AppointmentsWaitlist,
            FeatureCatalog.AppointmentsOnlineBooking,
            FeatureCatalog.AuditLogs,
            FeatureCatalog.ClinicalConsultation, FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalCustomFields,
            FeatureCatalog.ClinicalConsentForms,
            FeatureCatalog.CustomersBlacklist, FeatureCatalog.CustomersPassive,
            FeatureCatalog.StockProducts,
        });

        var premium = string.Join(',', new[]
        {
            FeatureCatalog.ExcelCustomers, FeatureCatalog.ExcelAppointments,
            FeatureCatalog.ExcelServices, FeatureCatalog.ExcelStaff,
            FeatureCatalog.ExcelBranches, FeatureCatalog.ExcelReports,
            FeatureCatalog.PdfReports, FeatureCatalog.PdfCredentials,
            FeatureCatalog.ReportsFinance, FeatureCatalog.ReportsCustomer,
            FeatureCatalog.ReportsStaff, FeatureCatalog.ReportsServices,
            FeatureCatalog.NotificationsSms, FeatureCatalog.NotificationsWhatsApp,
            FeatureCatalog.NotificationsEmail, FeatureCatalog.NotificationsBulk,
            FeatureCatalog.NotificationsTemplates, FeatureCatalog.NotificationsAutomation,
            FeatureCatalog.AccountingInstallments, FeatureCatalog.AccountingPayments,
            FeatureCatalog.BillingAdisyon,
            FeatureCatalog.StockProducts, FeatureCatalog.StockMovements,
            FeatureCatalog.CategoriesExpenseCustom, FeatureCatalog.CategoriesServiceCustom,
            FeatureCatalog.AuditLogs,
            FeatureCatalog.StaffPermissions, FeatureCatalog.ApprovalWorkflow,
            FeatureCatalog.StaffCommission, FeatureCatalog.StaffSchedule,
            FeatureCatalog.MarketingCampaigns, FeatureCatalog.LoyaltyPoints,
            FeatureCatalog.MarketingGiftCards, FeatureCatalog.FinanceCashClosing, FeatureCatalog.AppointmentsWaitlist,
            FeatureCatalog.AppointmentsOnlineBooking,
            FeatureCatalog.ClinicalConsultation, FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalCustomFields,
            FeatureCatalog.ClinicalConsentForms,
            FeatureCatalog.CustomersBlacklist, FeatureCatalog.CustomersPassive,
            FeatureCatalog.MultiBranch,
            FeatureCatalog.SecurityDeviceControl,
        });

        var aiKlinik = string.Join(',', new[]
        {
            premium, FeatureCatalog.ApiAccess, FeatureCatalog.AiInsights,
        });

        var enterprise = string.Join(',', FeatureCatalog.All.Select(f => f.Key));

        var defaults = new (string Key, string Name, string Desc, decimal Price, int Branches, int Staff, int Customers, int Appts, int Sms, int WhatsApp, int Email, string Features, int Order)[]
        {
            ("Starter",   "Başlangıç",   "Tek şube, küçük ekipler için temel plan",
                599m,  1, 3, 300, 200, 0, 0, 300,
                starter, 1),
            ("Pro",       "Profesyonel", "Çok şubeli işletmeler için tam paket",
                1499m, 3, 10, 2000, 1500, 500, 300, 3000,
                pro, 2),
            ("Premium",   "Premium",     "Yüksek hacimli güzellik merkezleri için",
                2990m, 6, 25, 8000, 5000, 2500, 1500, 10000,
                premium, 3),
            ("AIKlinik",  "AI Klinik",   "AI öneriler ve müşteri segmentasyonu dahil",
                4990m, 10, 50, 20000, 12000, 8000, 5000, -1,
                aiKlinik, 4),
            ("Enterprise","Enterprise",  "Özel limitler ve dedicated destek",
                0m,    -1, -1, -1, -1, -1, -1, -1,
                enterprise, 5),
        };

        try
        {
            var existingKeys = (await db.SubscriptionPlans.AsNoTracking().Select(p => p.PlanKey).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var toAdd = defaults.Where(d => !existingKeys.Contains(d.Key))
                .Select(d => new GuzellikMerkezi.Domain.Entities.SubscriptionPlan(
                    d.Key, d.Name, d.Price,
                    d.Branches, d.Staff, d.Customers, d.Appts, d.Sms,
                    d.Features, d.Desc, d.Order, d.WhatsApp, d.Email,
                    d.Price * 12)) // varsayılan yıllık fiyat = aylık × 12 (platform admin elle düzenleyebilir)
                .ToList();

            if (toAdd.Count > 0)
            {
                db.SubscriptionPlans.AddRange(toAdd);
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} default plan seed edildi.", toAdd.Count);
            }

            // Legacy feature key migration: eski 8 generic key'in herhangi birini içeren plan'ı
            // yeni granular default set'e taşı. Sadece varsayılan plan key'lerinde (Starter/Pro/...)
            // çalışır; özel plan'lar dokunulmaz.
            var legacyKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "BasicReports", "Reports", "Notifications", "MultiBranch",
                "AdvancedAnalytics", "APIAccess", "AIInsights", "SLA",
            };
            // 'MultiBranch' yeni key set'inde de var (case-sensitive 'multiBranch'),
            // o yüzden tanılamada yeni ile karşılaştırırken FeatureCatalog.Exists kullanıyoruz.

            var defaultByKey = defaults.ToDictionary(d => d.Key, d => d.Features, StringComparer.OrdinalIgnoreCase);
            var existingPlans = await db.SubscriptionPlans.ToListAsync();
            var migratedCount = 0;

            foreach (var plan in existingPlans)
            {
                if (!defaultByKey.TryGetValue(plan.PlanKey, out var newFeatures)) continue;
                if (string.IsNullOrWhiteSpace(plan.Features)) continue;

                var parts = plan.Features.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var hasLegacy = parts.Any(p => legacyKeys.Contains(p) && !FeatureCatalog.Exists(p));
                if (!hasLegacy) continue;

                plan.SetFeatures(newFeatures);
                migratedCount++;
            }
            if (migratedCount > 0)
            {
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} plan legacy feature CSV'sinden yeni granular feature set'ine taşındı.", migratedCount);
            }

            // Geriye dönük: mevcut default plan'lara yeni mesajlaşma limitlerini + klinik feature'ları uygula
            // (mevcut feature'lar silinmez, yalnızca eklenir; limitler kolon default'u 0 ise doldurulur).
            var defaultFull = defaults.ToDictionary(d => d.Key, d => d, StringComparer.OrdinalIgnoreCase);
            var newFeatureKeys = new[]
            {
                FeatureCatalog.ClinicalConsultation, FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalCustomFields,
            FeatureCatalog.ClinicalConsentForms,
                FeatureCatalog.CustomersBlacklist, FeatureCatalog.CustomersPassive,
                FeatureCatalog.MarketingGiftCards, FeatureCatalog.FinanceCashClosing, FeatureCatalog.AppointmentsWaitlist,
                FeatureCatalog.SecurityDeviceControl,
            };
            var backfilled = 0;
            foreach (var plan in existingPlans)
            {
                if (!defaultFull.TryGetValue(plan.PlanKey, out var def)) continue;
                var changed = false;

                if (plan.MaxMonthlyWhatsAppCount == 0 && plan.MaxMonthlyEmailCount == 0 && (def.WhatsApp != 0 || def.Email != 0))
                {
                    plan.SetMessagingLimits(def.WhatsApp, def.Email);
                    changed = true;
                }

                var current = (plan.Features ?? string.Empty)
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
                foreach (var key in newFeatureKeys)
                {
                    if (def.Features.Contains(key) && !current.Any(c => string.Equals(c, key, StringComparison.OrdinalIgnoreCase)))
                    {
                        current.Add(key);
                        changed = true;
                    }
                }
                if (changed)
                {
                    plan.SetFeatures(string.Join(',', current));
                    backfilled++;
                }
            }
            if (backfilled > 0)
            {
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} plan yeni mesajlaşma limiti/klinik feature ile güncellendi.", backfilled);
            }

            // Mevcut Tenant.Plan string'lerini eşleştirilebilen plana otomatik bağla.
            var allPlans = await db.SubscriptionPlans.AsNoTracking().ToListAsync();
            var byKey = allPlans.ToDictionary(p => p.PlanKey, StringComparer.OrdinalIgnoreCase);
            var byName = allPlans.GroupBy(p => p.Name).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            var unbound = await db.Tenants.Where(t => t.SubscriptionPlanId == null).ToListAsync();
            foreach (var t in unbound)
            {
                var match = byKey.TryGetValue(t.Plan, out var p) ? p
                          : byName.TryGetValue(t.Plan, out var p2) ? p2
                          : byKey.TryGetValue("Pro", out var p3) ? p3 : null;
                if (match is not null) t.AssignSubscriptionPlan(match);
            }
            if (unbound.Count > 0) await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Plan seed/eşleme sırasında hata.");
        }
    }

    /// <summary>
    /// Mevcut plaintext kayıtları AES-GCM ile şifreler. Idempotent: <c>ENC:v1:</c> ile
    /// başlayan satırlar atlanır. Her tablo kendi bağlantısında işlenir, hata olursa
    /// log'a yazılır ve diğer tablolarla devam edilir.
    /// </summary>
    public static async Task EncryptExistingDataAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");

        // Encryption servisi singleton, scope dışı erişim sorun değil.
        var encryption = services.GetService<IEncryptionService>();
        if (encryption is null)
        {
            logger.LogWarning("IEncryptionService kayıtlı değil, mevcut veri şifrelemesi atlanıyor.");
            return;
        }

        // Tablo + şifrelenecek kolonlar haritası
        var spec = new (string Table, string[] Columns)[]
        {
            ("tenants", new[] { "Name", "OwnerName", "Domain", "Phone", "TaxNumber" }),
            ("branches", new[] { "Name", "City" }),
            ("tenant_users", new[] { "FullName", "Permissions" }),
            ("customers", new[] { "FullName", "Phone", "Email", "Notes" }),
            ("staff_members", new[] { "FullName", "Title", "Phone", "Specialties" }),
            ("service_definitions", new[] { "Name", "Category" }),
            ("service_packages", new[] { "Name", "Description" }),
            ("appointments", new[] { "Notes", "CancellationReason" }),
            ("customer_accounts", new[] { "Name", "Notes" }),
            ("account_payments", new[] { "Method", "Reference" }),
            // İptal arşivi: Snapshot'ın bir kısmı ham SQL migration'ı tarafından üretildiği için
            // EF şifreleme dönüştürücüsünden geçmemiş olabilir (bkz. BackfillCancelledSaleArchivesAsync).
            ("cancelled_sales", new[] { "Name", "Snapshot", "CancellationReason" }),
            ("refund_transactions", new[] { "Reference", "Reason" }),
            ("archived_sale_payments", new[] { "AccountName", "Reference" }),
            ("business_expenses", new[] { "Description", "Reference", "PeriodLabel" }),
            ("custom_expense_categories", new[] { "Name" }),
            ("custom_service_categories", new[] { "Name" }),
            ("products", new[] { "Name", "Unit", "Location" }),
            ("stock_movements", new[] { "Reference", "Notes" }),
            ("pending_operations", new[] { "RequestedByName", "Title", "Summary", "PayloadJson", "RejectionReason" }),
            ("notification_templates", new[] { "Name", "Body" }),
            ("notification_logs", new[] { "Recipient", "Body", "ErrorMessage" }),
            ("audit_logs", new[] { "ActorName", "Summary", "DataJson" }),
        };

        await using var connection = new MySqlConnection(connectionString);
        try
        {
            await connection.OpenAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Şifreleme migration'ı için DB bağlantısı açılamadı.");
            return;
        }

        foreach (var (table, columns) in spec)
        {
            try
            {
                await EncryptTableAsync(connection, encryption, logger, table, columns);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Tablo '{Table}' şifreleme migration'ı sırasında hata.", table);
            }
        }
    }

    private static async Task EncryptTableAsync(
        MySqlConnection connection,
        IEncryptionService encryption,
        ILogger logger,
        string table,
        string[] columns)
    {
        // Önce tablo var mı kontrol et — yoksa sessizce atla.
        await using (var existsCmd = connection.CreateCommand())
        {
            existsCmd.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t";
            var p = existsCmd.CreateParameter(); p.ParameterName = "@t"; p.Value = table; existsCmd.Parameters.Add(p);
            var result = await existsCmd.ExecuteScalarAsync();
            if (result is null || Convert.ToInt32(result) == 0) return;
        }

        var colList = string.Join(", ", columns.Select(c => $"`{c}`"));
        var rows = new List<(object Id, string?[] Values)>();
        await using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = $"SELECT `Id`, {colList} FROM `{table}`";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                // MySQL driver Id'yi CHAR(36) -> Guid olarak verir; ToString ile normalize ediyoruz.
                var idValue = reader.GetValue(0);
                var values = new string?[columns.Length];
                for (var i = 0; i < columns.Length; i++)
                {
                    if (reader.IsDBNull(i + 1)) { values[i] = null; continue; }
                    var v = reader.GetValue(i + 1);
                    values[i] = v is null ? null : v.ToString();
                }
                rows.Add((idValue, values));
            }
        }

        var updated = 0;
        foreach (var (id, values) in rows)
        {
            // Sadece henüz şifrelenmemiş ve null/empty olmayan kolonları seç
            var changes = new List<(int Index, string Encrypted)>();
            for (var i = 0; i < columns.Length; i++)
            {
                var v = values[i];
                if (string.IsNullOrEmpty(v)) continue;
                if (encryption.IsEncrypted(v)) continue;
                var enc = encryption.Encrypt(v);
                if (enc is not null) changes.Add((i, enc));
            }
            if (changes.Count == 0) continue;

            var setClauses = string.Join(", ", changes.Select((c, idx) => $"`{columns[c.Index]}` = @v{idx}"));
            await using var upd = connection.CreateCommand();
            upd.CommandText = $"UPDATE `{table}` SET {setClauses} WHERE `Id` = @id";
            for (var i = 0; i < changes.Count; i++)
            {
                var p = upd.CreateParameter();
                p.ParameterName = $"@v{i}";
                p.Value = changes[i].Encrypted;
                upd.Parameters.Add(p);
            }
            var idParam = upd.CreateParameter();
            idParam.ParameterName = "@id";
            idParam.Value = id;
            upd.Parameters.Add(idParam);
            await upd.ExecuteNonQueryAsync();
            updated++;
        }

        if (updated > 0) logger.LogInformation("'{Table}' tablosunda {Count} satır şifrelendi.", table, updated);
    }
}

using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DERİN DENETİM — FAZ 5 (migration / açılış).
///
/// <list type="bullet">
/// <item><b>C3</b> — Özel migration çalıştırıcısında iki açık vardı: (1) kilit alınamazsa yalnız
/// uyarı loglanıp AÇILIŞ SÜRÜYORDU (yeni binary eski şemada trafik kabul ediyordu); (2) MariaDB
/// DDL'i örtük commit ettiği için, DDL uygulanıp geçmiş satırı yazılmadan çökme olursa bir sonraki
/// açılış aynı DDL'i tekrar çalıştırıp "Duplicate column" ile KALICI olarak patlıyordu.</item>
/// <item><b>H15</b> — Uygulanmış migration dosyaları sonradan değiştirilmişti; hash manifesti bunu
/// CI'da yakalar.</item>
/// </list>
/// </summary>
public sealed class AuditRoundSevenPhase5Tests
{
    /// <summary>
    /// ASIL İDDİA: `dotnet ef migrations script` ile üretilen betik, GERÇEK bir MariaDB'de baştan
    /// sona çalışır.
    ///
    /// <para>
    /// NEDEN AYRI BİR TEST: canlıya çıkış betik yoluyla yapılır, uygulama içi çalıştırıcıyla değil.
    /// İkisi AYNI SQL'i üretmez sayılmaz — uygulama içi yol komutları TEK TEK yürütür, betik yolu
    /// ise hepsini tek dosyada arka arkaya koyar. Bu fark yüzünden ham SQL'in sonundaki eksik
    /// noktalı virgül uygulama içi testlerde GÖRÜNMÜYOR ama betikte bir sonraki ifadeye yapışıp
    /// MariaDB'de 1064 veriyordu — production-clone provası tam burada düşmüştü.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task MigrationScript_RunsEndToEndOnRealDatabase()
    {
        await using var database = await MySqlTestDatabase.CreateEmptyAsync();

        // ŞEMA UYGULAMANIN KENDİ ÇALIŞTIRICISIYLA KURULUR — canlıdaki desteklenen yol budur
        // (`--migrate-only`). Betik yolu YÜKSELTME için kullanılır ve aşağıda o sınanır.
        //
        // Sıfırdan kurulumun betikle yapılamamasının bilinen bir nedeni var: zincirdeki eski bir
        // migration (StaffTimeOffHourRange) saklı yordam gövdesi içerir ve `;` ile bölünen bir
        // dosyada parçalanır. O migration CANLIDA UYGULANMIŞ durumdadır; uygulanmış migration
        // DEĞİŞTİRİLMEZ (bkz. migration-manifest.sh) — bu yüzden düzeltilmez, kapsam dışı bırakılır.
        await using (var db = database.NewContext())
            await DatabaseBootstrap.MigrateDatabaseAsync(db, null);

        // Şimdi asıl iddia: SON migration'ı geri alıp YÜKSELTME BETİĞİYLE tekrar uygula.
        // Deploy tam olarak bunu yapar (mevcut sürümden head'e betik).
        string lastMigration;
        await using (var db = database.NewContext())
        {
            var applied = (await db.Database.GetAppliedMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).ToList();
            lastMigration = applied[^1];
            var previous = applied[^2];

            // Son migration'ın etkisini geri al ve geçmişten düş — "bir önceki sürümdeki sunucu".
            var downScript = db.GetService<IMigrator>().GenerateScript(lastMigration, previous);
            await using var downConn = new MySqlConnection(database.ConnectionString);
            await downConn.OpenAsync();
            new MySqlScript(downConn, downScript).Execute();
        }

        string script;
        await using (var db = database.NewContext())
        {
            var applied = (await db.Database.GetAppliedMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).ToList();
            script = db.GetService<IMigrator>().GenerateScript(applied[^1], lastMigration);
        }

        // Betiği DEPLOY'DAKİ GİBİ çalıştır: çok ifadeli dosya, `;` ayracıyla.
        // 1064 (eksik noktalı virgül) tam burada yakalanır — production-clone provası da burada düşmüştü.
        await using var connection = new MySqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        var runner = new MySqlScript(connection, script);
        runner.Execute();

        await using (var check = database.NewContext())
        {
            Assert.Empty(await check.Database.GetPendingMigrationsAsync());
            var applied = (await check.Database.GetAppliedMigrationsAsync()).ToList();
            Assert.NotEmpty(applied);
            // Şema gerçekten kuruldu: son turda eklenen kolonlar sorgulanabilmeli.
            Assert.Equal(0, await check.BackgroundJobs.IgnoreQueryFilters().CountAsync(j => j.LockToken != null));
            Assert.Equal(0, await check.NotificationLogs.IgnoreQueryFilters().CountAsync(l => l.DedupeKey != null));
        }
    }

    /// <summary>
    /// Aynı iddianın UCUZ ve HIZLI hâli: üretilen betikte ham SQL ifadeleri sonlandırılmış mı?
    /// Veritabanı gerektirmez, her CI koşusunda çalışır ve hatayı saniyeler içinde yakalar.
    /// </summary>
    [Fact]
    public void MigrationScript_EveryStatementIsTerminated()
    {
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseMySQL("server=localhost;database=script_only;user=root;password=x")
            .Options;
        using var db = new GuzellikDbContext(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());
        var script = db.GetService<IMigrator>().GenerateScript();

        // İfade başlangıcı sayılan anahtar kelimeler; her biri kendinden ÖNCEKİ ifadenin
        // sonlandırılmış olmasını gerektirir.
        string[] starters = ["CREATE ", "ALTER ", "DROP ", "INSERT ", "UPDATE ", "DELETE ", "CALL "];

        var lines = script.Split('\n').Select(l => l.TrimEnd('\r')).ToArray();
        string? previousNonEmpty = null;
        var unterminated = new List<string>();

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith("--", StringComparison.Ordinal)) continue;

            var startsStatement = starters.Any(s => trimmed.StartsWith(s, StringComparison.OrdinalIgnoreCase));
            // BEGIN/END: saklı yordam gövdesinin içi. Zincirdeki eski (ve CANLIDA UYGULANMIŞ, bu
            // yüzden değiştirilemez) bir migration böyle bir gövde içerir; kural onu işaretlemez.
            // Aranan şey, gövde DIŞINDAKİ sonlandırılmamış ham SQL'dir — 1064'ü üreten tam buydu.
            if (startsStatement && previousNonEmpty is { } prev
                && !prev.EndsWith(';')
                && !prev.EndsWith("BEGIN", StringComparison.OrdinalIgnoreCase)
                && !prev.EndsWith("END", StringComparison.OrdinalIgnoreCase))
            {
                unterminated.Add($"'{prev}' → '{trimmed}'");
            }
            previousNonEmpty = trimmed;
        }

        Assert.True(unterminated.Count == 0,
            "Sonlandırılmamış SQL ifadesi var (betik yolunda MariaDB 1064 verir):\n"
            + string.Join("\n", unterminated));
    }

    /// <summary>
    /// ASIL İDDİA: Türkçe'ye özgü harfler veritabanına gidip GERİ DÖNDÜĞÜNDE aynı kalır.
    ///
    /// <para>
    /// Bağlantı karakter seti hiçbir yerde zorlanmıyordu; sunucu varsayılanı utf8mb3/latin1 olan
    /// kurulumlarda "Cilt Bakımı" sessizce "Cilt Bakimi" oluyordu (ı, ş, ğ, İ kayboluyor).
    /// Geliştirme makinesinde (MySQL 8, varsayılan utf8mb4) hata hiç görünmüyor, canlıda müşteri
    /// ve hizmet adları KALICI olarak bozuluyordu. Artık bağlantı utf8mb4'e sabitlenir.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task TurkishCharacters_SurviveRoundTrip()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        const string tricky = "Cilt Bakımı · Ağda · Şeyma · İpek · Öz · Ünlü · ğüşiöç";
        Guid serviceId;

        await using (var db = database.NewContext())
        {
            var tenant = new GuzellikMerkezi.Domain.Entities.Tenant("Türkçe QA", $"tr-{Guid.NewGuid():N}"[..20], "Premium",
                GuzellikMerkezi.Domain.Enums.TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var service = new GuzellikMerkezi.Domain.Entities.ServiceDefinition(tenant.Id, branch.Id, tricky, 60, 1250m, "Cilt");
            db.ServiceDefinitions.Add(service);
            await db.SaveChangesAsync();
            serviceId = service.Id;
        }

        await using (var check = database.NewContext())
        {
            var name = await check.ServiceDefinitions.AsNoTracking()
                .Where(s => s.Id == serviceId).Select(s => s.Name).SingleAsync();
            Assert.Equal(tricky, name);
        }
    }

    /// <summary>
    /// ASIL İDDİA: yarıda kalmış migration izi varken açılış SESSİZCE DEVAM ETMEZ. Hata mesajı
    /// hangi migration'ın takıldığını ve operatörün ne yapacağını söyler.
    /// </summary>
    [MySqlFact]
    public async Task Migrate_WithAbandonedAttempt_FailsFastWithActionableMessage()
    {
        await using var database = await MySqlTestDatabase.CreateEmptyAsync();

        // Önce şemayı normal şekilde kur (tüm zincir uygulanır).
        await using (var db = database.NewContext())
            await DatabaseBootstrap.MigrateDatabaseAsync(db, null);

        // Sonra: SON migration'ın geçmiş satırını sil ve "yarıda kaldı" izini yaz —
        // DDL uygulanmış ama geçmişe yazılmadan çökülmüş durumun birebir taklidi.
        string lastMigration;
        await using (var db = database.NewContext())
        {
            lastMigration = (await db.Database.GetAppliedMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).Last();
            await db.Database.ExecuteSqlRawAsync(
                "DELETE FROM `__EFMigrationsHistory` WHERE `MigrationId` = {0}", lastMigration);
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO `__migration_attempt` (`MigrationId`, `StartedAtUtc`) VALUES ({0}, {1})",
                lastMigration, DateTime.UtcNow);
        }

        await using (var db = database.NewContext())
        {
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => DatabaseBootstrap.MigrateDatabaseAsync(db, null));
            Assert.Contains(lastMigration, ex.Message);
            Assert.Contains("YARIDA KALDI", ex.Message);
            // Operatöre NE YAPACAĞI söylenir — yalnız "hata" demek yetmez.
            Assert.Contains("__migration_attempt", ex.Message);
        }
    }

    /// <summary>
    /// KARŞIT DURUM: normal açılışta iz TEMİZ kalır — tamamlanan her migration'dan sonra silinir.
    /// Aksi hâlde ikinci açılış yanlışlıkla "yarıda kaldı" derdi.
    /// </summary>
    [MySqlFact]
    public async Task Migrate_CleanRun_LeavesNoAbandonedAttempt()
    {
        await using var database = await MySqlTestDatabase.CreateEmptyAsync();

        await using (var db = database.NewContext())
            await DatabaseBootstrap.MigrateDatabaseAsync(db, null);

        await using (var check = database.NewContext())
        {
            var rows = await check.Database
                .SqlQueryRaw<string>("SELECT `MigrationId` AS Value FROM `__migration_attempt`")
                .ToListAsync();
            Assert.Empty(rows);
        }

        // İkinci açılış da sorunsuz (idempotent).
        await using (var db = database.NewContext())
            await DatabaseBootstrap.MigrateDatabaseAsync(db, null);
    }

    /// <summary>
    /// KİLİT ALINAMAZSA AÇILIŞ DURUR (fail-closed). Başka bir oturum kilidi tutarken migration
    /// denemesi sessizce "atlanmaz" — eski şema üzerinde trafik kabul edilmesini bu engeller.
    /// </summary>
    [MySqlFact]
    public async Task Migrate_WhenLockHeldByAnotherSession_DoesNotSilentlySkip()
    {
        await using var database = await MySqlTestDatabase.CreateEmptyAsync();

        // Ayrı bir bağlantı kilidi TUTAR (GET_LOCK oturum bazlıdır). Kilit adı VERİTABANINA
        // özeldir: aynı sunucudaki başka kurulumlar (ve paralel testler) birbirini bloklamaz.
        await using var holder = database.NewContext();
        var lockName = DatabaseBootstrap.MigrationLockName(holder);
        var conn = holder.Database.GetDbConnection();
        await conn.OpenAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"SELECT GET_LOCK('{lockName}', 5);";
            var acquired = await cmd.ExecuteScalarAsync();
            Assert.Equal(1L, Convert.ToInt64(acquired));
        }

        try
        {
            await using var db = database.NewContext();
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => DatabaseBootstrap.MigrateDatabaseAsync(db, null));
            Assert.Contains("Migration kilidi alınamadı", ex.Message);
        }
        finally
        {
            await using var release = conn.CreateCommand();
            release.CommandText = $"DO RELEASE_LOCK('{lockName}');";
            await release.ExecuteNonQueryAsync();
        }
    }
}

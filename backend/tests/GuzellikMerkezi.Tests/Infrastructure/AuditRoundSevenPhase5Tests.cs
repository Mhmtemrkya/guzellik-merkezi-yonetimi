using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

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

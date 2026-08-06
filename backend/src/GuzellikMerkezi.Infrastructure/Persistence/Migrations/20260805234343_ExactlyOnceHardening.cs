using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ExactlyOnceHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_app_notifications_TenantId_DedupeKey",
                table: "app_notifications");

            migrationBuilder.AddColumn<string>(
                name: "RequestFingerprint",
                table: "processed_client_requests",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DedupeKey",
                table: "notification_logs",
                type: "varchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LockToken",
                table: "background_jobs",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            // notification_logs.DedupeKey YENİ bir kolondur → tüm mevcut satırlarda NULL'dur ve
            // benzersiz indeks NULL'ları kısıtlamaz. Temizlik gerekmez.
            migrationBuilder.CreateIndex(
                name: "IX_notification_logs_TenantId_DedupeKey",
                table: "notification_logs",
                columns: new[] { "TenantId", "DedupeKey" },
                unique: true);

            // MÜKERRERLERİ ÖNCE TEMİZLE — yoksa benzersiz indeks CANLIDA KURULAMAZ.
            //
            // app_notifications.DedupeKey ESKİ bir kolondur ve dolu satırlar içerir. Tekilleştirme
            // şimdiye kadar yalnız kodda ("önce sor, sonra yaz") yapılıyordu; iki backend örneği ya
            // da eşzamanlı iki çağrı aynı anda "yok" görüp aynı bildirimi iki kez yazabiliyordu.
            // Bu satırlar tabloda duruyor olabilir ve indeks oluşturmayı 1062 ile düşürürdü.
            // Her (kurum, alıcı, anahtar) üçlüsünden EN ESKİSİ korunur; fazlası silinir.
            // Kayıp yok: silinenler aynı bildirimin kopyalarıdır.
            //
            // Alt sorgu ARA TABLOYA sarılır: MySQL/MariaDB silinen tablodan doğrudan SELECT
            // yapılmasına izin vermez ("You can't specify target table for update in FROM clause").
            //
            // SONDAKİ NOKTALI VİRGÜL ZORUNLUDUR. `dotnet ef migrations script` ham SQL'i AYNEN
            // basar; sonlandırıcı yoksa bir sonraki ifade (CREATE UNIQUE INDEX) buna yapışır ve
            // MariaDB tek ifade sanıp 1064 verir. Uygulama içi çalıştırıcı komutları tek tek
            // yürüttüğü için bu hatayı GÖSTERMEZ — bozulan yalnızca script yoluyla yapılan deploy'dur.
            migrationBuilder.Sql(
                "DELETE FROM `app_notifications` WHERE `DedupeKey` IS NOT NULL AND `Id` NOT IN (" +
                "  SELECT `keep` FROM (" +
                "    SELECT MIN(`Id`) AS `keep` FROM `app_notifications` WHERE `DedupeKey` IS NOT NULL" +
                "    GROUP BY `TenantId`, `RecipientUserId`, `DedupeKey`" +
                "  ) AS `t`);");

            migrationBuilder.CreateIndex(
                name: "IX_app_notifications_TenantId_RecipientUserId_DedupeKey",
                table: "app_notifications",
                columns: new[] { "TenantId", "RecipientUserId", "DedupeKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_notification_logs_TenantId_DedupeKey",
                table: "notification_logs");

            migrationBuilder.DropIndex(
                name: "IX_app_notifications_TenantId_RecipientUserId_DedupeKey",
                table: "app_notifications");

            migrationBuilder.DropColumn(
                name: "RequestFingerprint",
                table: "processed_client_requests");

            migrationBuilder.DropColumn(
                name: "DedupeKey",
                table: "notification_logs");

            migrationBuilder.DropColumn(
                name: "LockToken",
                table: "background_jobs");

            migrationBuilder.CreateIndex(
                name: "IX_app_notifications_TenantId_DedupeKey",
                table: "app_notifications",
                columns: new[] { "TenantId", "DedupeKey" });
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ConcurrencyIndexesAndUsageUniqueness : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ÖNCE TEKİLLEŞTİR: mükerrer satır varsa unique index oluşturulamaz ve migration
            // yarıda kalır. Mükerrerlik yalnızca eşzamanlı açılış backfill'inden doğabilir; aynı
            // (kurum, fiş kalemi, seans) üçlüsünün ikinci satırı zaten hatalıdır — en eskisi kalır.
            // Takma adsız DELETE + türetilmiş tablo: MariaDB aliaslı biçimi reddeder ve MySQL
            // silinen tablodan doğrudan SELECT'e izin vermez.
            migrationBuilder.Sql(@"
                DELETE FROM package_session_usages
                WHERE Id NOT IN (
                    SELECT keep_id FROM (
                        SELECT MIN(Id) AS keep_id
                        FROM package_session_usages
                        GROUP BY TenantId, AdisyonItemId, CustomerPackageSessionId
                    ) AS keep
                );");

            migrationBuilder.CreateIndex(
                name: "IX_stock_movements_SourceAdisyonId",
                table: "stock_movements",
                column: "SourceAdisyonId");

            migrationBuilder.CreateIndex(
                name: "IX_package_session_usages_TenantId_AdisyonItemId_CustomerPackag~",
                table: "package_session_usages",
                columns: new[] { "TenantId", "AdisyonItemId", "CustomerPackageSessionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_account_payments_SourceAdisyonId",
                table: "account_payments",
                column: "SourceAdisyonId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_stock_movements_SourceAdisyonId",
                table: "stock_movements");

            migrationBuilder.DropIndex(
                name: "IX_package_session_usages_TenantId_AdisyonItemId_CustomerPackag~",
                table: "package_session_usages");

            migrationBuilder.DropIndex(
                name: "IX_account_payments_SourceAdisyonId",
                table: "account_payments");
        }
    }
}

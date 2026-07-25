using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustomerListPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_customers_TenantId_CreatedAtUtc",
                table: "customers",
                columns: new[] { "TenantId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_appointments_TenantId_CustomerId_StartUtc",
                table: "appointments",
                columns: new[] { "TenantId", "CustomerId", "StartUtc" });

            // Blind index aramasi (MATCH ... AGAINST) icin FULLTEXT — EF ile ifade edilemez.
            // "|hash|hash|" degerinde her hash ayri kelime sayilir; LIKE '%..%' tam taramasi biter.
            migrationBuilder.Sql("ALTER TABLE `customers` ADD FULLTEXT INDEX `FT_customers_SearchIndex` (`SearchIndex`);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE `customers` DROP INDEX `FT_customers_SearchIndex`;");

            migrationBuilder.DropIndex(
                name: "IX_customers_TenantId_CreatedAtUtc",
                table: "customers");

            migrationBuilder.DropIndex(
                name: "IX_appointments_TenantId_CustomerId_StartUtc",
                table: "appointments");
        }
    }
}

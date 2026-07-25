using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveProductSkuSupplierTaxLeadPending : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_products_TenantId_Sku",
                table: "products");

            migrationBuilder.DropColumn(
                name: "LeadTimeDays",
                table: "products");

            migrationBuilder.DropColumn(
                name: "PendingInbound",
                table: "products");

            migrationBuilder.DropColumn(
                name: "Sku",
                table: "products");

            migrationBuilder.DropColumn(
                name: "Supplier",
                table: "products");

            migrationBuilder.DropColumn(
                name: "TaxRatePercent",
                table: "products");

            migrationBuilder.CreateIndex(
                name: "IX_products_TenantId_Barcode",
                table: "products",
                columns: new[] { "TenantId", "Barcode" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_products_TenantId_Barcode",
                table: "products");

            migrationBuilder.AddColumn<int>(
                name: "LeadTimeDays",
                table: "products",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "PendingInbound",
                table: "products",
                type: "decimal(18,3)",
                precision: 18,
                scale: 3,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "Sku",
                table: "products",
                type: "varchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Supplier",
                table: "products",
                type: "longtext",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "TaxRatePercent",
                table: "products",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_products_TenantId_Sku",
                table: "products",
                columns: new[] { "TenantId", "Sku" });
        }
    }
}

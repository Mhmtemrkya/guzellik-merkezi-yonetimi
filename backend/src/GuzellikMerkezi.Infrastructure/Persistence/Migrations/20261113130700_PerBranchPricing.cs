using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PerBranchPricing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LinesJson",
                table: "tenant_invoices",
                type: "LONGTEXT",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "QuotedNetTRY",
                table: "tenant_invoices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "QuotedVatTRY",
                table: "tenant_invoices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ChargePerBranch",
                table: "subscription_plans",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ConsentTiersJson",
                table: "subscription_plans",
                type: "varchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomerTiersJson",
                table: "subscription_plans",
                type: "varchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "YearlyTierMultiplier",
                table: "subscription_plans",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 10m);

            migrationBuilder.AddColumn<string>(
                name: "BreakdownJson",
                table: "subscription_payments",
                type: "LONGTEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "subscription_payments",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Subscription");

            migrationBuilder.AddColumn<string>(
                name: "PayloadJson",
                table: "subscription_payments",
                type: "varchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_subscription_payments_TenantId_Kind_Status",
                table: "subscription_payments",
                columns: new[] { "TenantId", "Kind", "Status" });

            // PAKET FİYATLARI KDV DAHİL → KDV HARİÇ (YALNIZ abonelik paketleri; mesaj kredisi paketlerine
            // dokunulmaz). Tahsilat artık net + %20 KDV olarak kurulur; mevcut paketlerin BRÜT tahsilatı
            // aynı kalsın diye fiyat nete çevrilir (1.999 → 1.665,83; ×1,20 = 1.999,00 — sapma en çok 1 kuruş).
            // Geçmiş ödeme/fatura satırları (brüt) değişmez. Takma adsız UPDATE: MariaDB uyumlu.
            migrationBuilder.Sql(
                "UPDATE subscription_plans SET MonthlyPriceTRY = ROUND(MonthlyPriceTRY / 1.2, 2), YearlyPriceTRY = ROUND(YearlyPriceTRY / 1.2, 2);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE subscription_plans SET MonthlyPriceTRY = ROUND(MonthlyPriceTRY * 1.2, 2), YearlyPriceTRY = ROUND(YearlyPriceTRY * 1.2, 2);");

            migrationBuilder.DropIndex(
                name: "IX_subscription_payments_TenantId_Kind_Status",
                table: "subscription_payments");

            migrationBuilder.DropColumn(
                name: "LinesJson",
                table: "tenant_invoices");

            migrationBuilder.DropColumn(
                name: "QuotedNetTRY",
                table: "tenant_invoices");

            migrationBuilder.DropColumn(
                name: "QuotedVatTRY",
                table: "tenant_invoices");

            migrationBuilder.DropColumn(
                name: "ChargePerBranch",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "ConsentTiersJson",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "CustomerTiersJson",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "YearlyTierMultiplier",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "BreakdownJson",
                table: "subscription_payments");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "subscription_payments");

            migrationBuilder.DropColumn(
                name: "PayloadJson",
                table: "subscription_payments");
        }
    }
}

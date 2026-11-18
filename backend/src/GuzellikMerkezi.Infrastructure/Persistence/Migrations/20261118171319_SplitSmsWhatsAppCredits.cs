using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SplitSmsWhatsAppCredits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Channel",
                table: "whatsapp_credit_purchases",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "WhatsApp");

            migrationBuilder.AddColumn<string>(
                name: "Channel",
                table: "whatsapp_credit_packages",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "WhatsApp");

            migrationBuilder.AddColumn<decimal>(
                name: "SmsCreditUnitPriceTry",
                table: "whatsapp_billing_settings",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            // SMS ve WhatsApp kredisi ayrıldı (18 Kas 2026). SMS kredisinin birim fiyatı mevcut kredi fiyatıyla başlar;
            // SMS parça maliyeti (SmsCreditsPerPart) platformun ayarıdır, burada DEĞİŞTİRİLMEZ. Ortak bakiye WhatsApp
            // alanlarında kalır, SMS bakiyesi sıfırdan başlar (kota içi SMS etkilenmez; platform kanal başına düzeltebilir).
            migrationBuilder.Sql("UPDATE whatsapp_billing_settings SET SmsCreditUnitPriceTry = CreditUnitPriceTry;");

            migrationBuilder.AddColumn<decimal>(
                name: "SmsBalanceCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "SmsLifetimeSpentCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "SmsLifetimeTopUpCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "SmsReservedCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Channel",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropColumn(
                name: "Channel",
                table: "whatsapp_credit_packages");

            migrationBuilder.DropColumn(
                name: "SmsCreditUnitPriceTry",
                table: "whatsapp_billing_settings");

            migrationBuilder.DropColumn(
                name: "SmsBalanceCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "SmsLifetimeSpentCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "SmsLifetimeTopUpCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "SmsReservedCredits",
                table: "tenant_messaging_wallets");
        }
    }
}

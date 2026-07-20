using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPlatformWhatsAppSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "WhatsAppAccessTokenEncrypted",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhatsAppBusinessAccountId",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "WhatsAppEnabled",
                table: "platform_integration_settings",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WhatsAppPhoneNumberId",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhatsAppProvider",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: false,
                // Mevcut singleton satır(lar)ı için geri-doldurma; NOT NULL longtext'i strict modda güvenli ekler.
                defaultValue: "Meta");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WhatsAppAccessTokenEncrypted",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "WhatsAppBusinessAccountId",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "WhatsAppEnabled",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "WhatsAppPhoneNumberId",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "WhatsAppProvider",
                table: "platform_integration_settings");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ChatwootBridge : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ChatwootInboxId",
                table: "whatsapp_settings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChatwootWebhookSecretEncrypted",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ChatwootInboxId",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "ChatwootWebhookSecretEncrypted",
                table: "platform_integration_settings");
        }
    }
}

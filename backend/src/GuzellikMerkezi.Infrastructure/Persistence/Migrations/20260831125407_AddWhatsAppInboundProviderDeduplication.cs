using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWhatsAppInboundProviderDeduplication : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProviderChannelId",
                table: "whatsapp_messages",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ux_whatsapp_messages_provider_channel_message",
                table: "whatsapp_messages",
                columns: new[] { "ProviderChannelId", "ProviderMessageId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_whatsapp_messages_provider_channel_message",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "ProviderChannelId",
                table: "whatsapp_messages");
        }
    }
}

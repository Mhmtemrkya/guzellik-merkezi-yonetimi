using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations;

[DbContext(typeof(GuzellikDbContext))]
[Migration("20260831104500_AddWhatsAppInboundProviderDeduplication")]
public sealed class AddWhatsAppInboundProviderDeduplication : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "ProviderChannelId",
            table: "whatsapp_messages",
            type: "varchar(128)",
            maxLength: 128,
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_whatsapp_messages_ProviderChannelId_ProviderMessageId",
            table: "whatsapp_messages",
            columns: new[] { "ProviderChannelId", "ProviderMessageId" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_whatsapp_messages_ProviderChannelId_ProviderMessageId",
            table: "whatsapp_messages");

        migrationBuilder.DropColumn(
            name: "ProviderChannelId",
            table: "whatsapp_messages");
    }
}

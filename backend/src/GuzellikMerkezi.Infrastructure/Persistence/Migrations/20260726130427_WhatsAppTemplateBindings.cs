using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class WhatsAppTemplateBindings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "KvkkTemplateName",
                table: "whatsapp_settings",
                type: "varchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReminderTemplateName",
                table: "whatsapp_settings",
                type: "varchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TemplateLanguageCode",
                table: "whatsapp_settings",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "tr");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "KvkkTemplateName",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "ReminderTemplateName",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "TemplateLanguageCode",
                table: "whatsapp_settings");
        }
    }
}

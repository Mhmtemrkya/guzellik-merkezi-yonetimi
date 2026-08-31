using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class WhatsAppWaitlistRatingTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RatingTemplateName",
                table: "whatsapp_settings",
                type: "varchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WaitlistActivatedTemplateName",
                table: "whatsapp_settings",
                type: "varchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WaitlistOfferTemplateName",
                table: "whatsapp_settings",
                type: "varchar(128)",
                maxLength: 128,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RatingTemplateName",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "WaitlistActivatedTemplateName",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "WaitlistOfferTemplateName",
                table: "whatsapp_settings");
        }
    }
}

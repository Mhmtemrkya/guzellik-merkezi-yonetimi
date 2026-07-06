using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWaitlistOfferFlow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "WaitlistEntryId",
                table: "whatsapp_messages",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DurationMinutes",
                table: "waitlist_entries",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PreferredStartUtc",
                table: "waitlist_entries",
                type: "datetime(6)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WaitlistEntryId",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "DurationMinutes",
                table: "waitlist_entries");

            migrationBuilder.DropColumn(
                name: "PreferredStartUtc",
                table: "waitlist_entries");
        }
    }
}

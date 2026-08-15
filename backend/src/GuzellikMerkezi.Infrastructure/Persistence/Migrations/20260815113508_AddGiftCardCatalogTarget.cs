using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGiftCardCatalogTarget : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ServiceDefinitionId",
                table: "gift_cards",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ServicePackageId",
                table: "gift_cards",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_gift_cards_TenantId_CustomerId",
                table: "gift_cards",
                columns: new[] { "TenantId", "CustomerId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_gift_cards_TenantId_CustomerId",
                table: "gift_cards");

            migrationBuilder.DropColumn(
                name: "ServiceDefinitionId",
                table: "gift_cards");

            migrationBuilder.DropColumn(
                name: "ServicePackageId",
                table: "gift_cards");
        }
    }
}

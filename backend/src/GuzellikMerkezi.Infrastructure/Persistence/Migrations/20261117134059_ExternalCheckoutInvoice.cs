using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ExternalCheckoutInvoice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "InvoiceId",
                table: "external_checkouts",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_external_checkouts_InvoiceId",
                table: "external_checkouts",
                column: "InvoiceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_external_checkouts_InvoiceId",
                table: "external_checkouts");

            migrationBuilder.DropColumn(
                name: "InvoiceId",
                table: "external_checkouts");
        }
    }
}

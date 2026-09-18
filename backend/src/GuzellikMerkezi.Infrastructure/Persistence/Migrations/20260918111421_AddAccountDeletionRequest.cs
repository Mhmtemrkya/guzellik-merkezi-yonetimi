using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountDeletionRequest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeletionReason",
                table: "tenants",
                type: "varchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletionRequestedAtUtc",
                table: "tenants",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletionRequestedBy",
                table: "tenants",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletionScheduledAtUtc",
                table: "tenants",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "AnonymizedAtUtc",
                table: "customers",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenants_DeletionScheduledAtUtc",
                table: "tenants",
                column: "DeletionScheduledAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_tenants_DeletionScheduledAtUtc",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "DeletionReason",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "DeletionRequestedAtUtc",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "DeletionRequestedBy",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "DeletionScheduledAtUtc",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "AnonymizedAtUtc",
                table: "customers");
        }
    }
}

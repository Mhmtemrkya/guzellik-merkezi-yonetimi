using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SecurityHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "FailedLoginCount",
                table: "tenant_users",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "LockedUntilUtc",
                table: "tenant_users",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SecurityStampUtc",
                table: "tenant_users",
                type: "datetime(6)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FailedLoginCount",
                table: "tenant_users");

            migrationBuilder.DropColumn(
                name: "LockedUntilUtc",
                table: "tenant_users");

            migrationBuilder.DropColumn(
                name: "SecurityStampUtc",
                table: "tenant_users");
        }
    }
}

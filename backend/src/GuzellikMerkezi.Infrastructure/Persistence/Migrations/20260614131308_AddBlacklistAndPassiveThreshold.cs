using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBlacklistAndPassiveThreshold : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PassiveCustomerThresholdDays",
                table: "tenants",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "BlacklistReason",
                table: "customers",
                type: "varchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "BlacklistedAtUtc",
                table: "customers",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsBlacklisted",
                table: "customers",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PassiveCustomerThresholdDays",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "BlacklistReason",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "BlacklistedAtUtc",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "IsBlacklisted",
                table: "customers");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustomerAccountSaleInfo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CancellationReason",
                table: "customer_accounts",
                type: "varchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAtUtc",
                table: "customer_accounts",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsHistorical",
                table: "customer_accounts",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "SoldAtUtc",
                table: "customer_accounts",
                type: "datetime(6)",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<Guid>(
                name: "SoldByStaffMemberId",
                table: "customer_accounts",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_customer_accounts_SoldByStaffMemberId",
                table: "customer_accounts",
                column: "SoldByStaffMemberId");

            migrationBuilder.CreateIndex(
                name: "IX_customer_accounts_TenantId_CustomerId_SoldAtUtc",
                table: "customer_accounts",
                columns: new[] { "TenantId", "CustomerId", "SoldAtUtc" });

            migrationBuilder.AddForeignKey(
                name: "FK_customer_accounts_staff_members_SoldByStaffMemberId",
                table: "customer_accounts",
                column: "SoldByStaffMemberId",
                principalTable: "staff_members",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_customer_accounts_staff_members_SoldByStaffMemberId",
                table: "customer_accounts");

            migrationBuilder.DropIndex(
                name: "IX_customer_accounts_SoldByStaffMemberId",
                table: "customer_accounts");

            migrationBuilder.DropIndex(
                name: "IX_customer_accounts_TenantId_CustomerId_SoldAtUtc",
                table: "customer_accounts");

            migrationBuilder.DropColumn(
                name: "CancellationReason",
                table: "customer_accounts");

            migrationBuilder.DropColumn(
                name: "CancelledAtUtc",
                table: "customer_accounts");

            migrationBuilder.DropColumn(
                name: "IsHistorical",
                table: "customer_accounts");

            migrationBuilder.DropColumn(
                name: "SoldAtUtc",
                table: "customer_accounts");

            migrationBuilder.DropColumn(
                name: "SoldByStaffMemberId",
                table: "customer_accounts");
        }
    }
}

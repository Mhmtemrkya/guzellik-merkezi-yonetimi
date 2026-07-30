using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CustomerAccountAppliedByStaff : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AppliedByStaffMemberId",
                table: "customer_accounts",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_customer_accounts_AppliedByStaffMemberId",
                table: "customer_accounts",
                column: "AppliedByStaffMemberId");

            migrationBuilder.AddForeignKey(
                name: "FK_customer_accounts_staff_members_AppliedByStaffMemberId",
                table: "customer_accounts",
                column: "AppliedByStaffMemberId",
                principalTable: "staff_members",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_customer_accounts_staff_members_AppliedByStaffMemberId",
                table: "customer_accounts");

            migrationBuilder.DropIndex(
                name: "IX_customer_accounts_AppliedByStaffMemberId",
                table: "customer_accounts");

            migrationBuilder.DropColumn(
                name: "AppliedByStaffMemberId",
                table: "customer_accounts");
        }
    }
}

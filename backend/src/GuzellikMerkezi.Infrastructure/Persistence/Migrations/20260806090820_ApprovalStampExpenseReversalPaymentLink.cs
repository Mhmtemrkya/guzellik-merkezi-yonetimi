using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ApprovalStampExpenseReversalPaymentLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "RequesterSecurityStampUtc",
                table: "pending_operations",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ReversalOfExpenseId",
                table: "business_expenses",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceAppointmentId",
                table: "account_payments",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_business_expenses_ReversalOfExpenseId",
                table: "business_expenses",
                column: "ReversalOfExpenseId");

            migrationBuilder.CreateIndex(
                name: "IX_account_payments_SourceAppointmentId",
                table: "account_payments",
                column: "SourceAppointmentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_business_expenses_ReversalOfExpenseId",
                table: "business_expenses");

            migrationBuilder.DropIndex(
                name: "IX_account_payments_SourceAppointmentId",
                table: "account_payments");

            migrationBuilder.DropColumn(
                name: "RequesterSecurityStampUtc",
                table: "pending_operations");

            migrationBuilder.DropColumn(
                name: "ReversalOfExpenseId",
                table: "business_expenses");

            migrationBuilder.DropColumn(
                name: "SourceAppointmentId",
                table: "account_payments");
        }
    }
}

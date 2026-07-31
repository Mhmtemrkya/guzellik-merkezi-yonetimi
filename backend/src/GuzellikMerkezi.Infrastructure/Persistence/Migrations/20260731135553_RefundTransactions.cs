using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RefundTransactions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "refund_transactions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CancelledSaleId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Method = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    Reference = table.Column<string>(type: "longtext", nullable: true),
                    RefundedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    RefundedByUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    Reason = table.Column<string>(type: "longtext", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_refund_transactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_refund_transactions_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_refund_transactions_CancelledSaleId",
                table: "refund_transactions",
                column: "CancelledSaleId");

            migrationBuilder.CreateIndex(
                name: "IX_refund_transactions_CustomerId",
                table: "refund_transactions",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_refund_transactions_TenantId_RefundedAtUtc",
                table: "refund_transactions",
                columns: new[] { "TenantId", "RefundedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "refund_transactions");
        }
    }
}

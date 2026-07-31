using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CancelledSalesArchive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cancelled_sales",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    OriginalAccountId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    ServicePackageId = table.Column<Guid>(type: "char(36)", nullable: true),
                    Name = table.Column<string>(type: "longtext", nullable: false),
                    TotalAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    DepositAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CollectedAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    RefundedAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    SoldAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    SoldByStaffMemberId = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsHistorical = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    SessionsTotal = table.Column<int>(type: "int", nullable: false),
                    SessionsUsed = table.Column<int>(type: "int", nullable: false),
                    AdisyonId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CancelledAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CancellationReason = table.Column<string>(type: "longtext", nullable: true),
                    Snapshot = table.Column<string>(type: "longtext", nullable: false),
                    RestoredAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cancelled_sales", x => x.Id);
                    table.ForeignKey(
                        name: "FK_cancelled_sales_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cancelled_sales_staff_members_SoldByStaffMemberId",
                        column: x => x.SoldByStaffMemberId,
                        principalTable: "staff_members",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_cancelled_sales_CustomerId",
                table: "cancelled_sales",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_cancelled_sales_OriginalAccountId",
                table: "cancelled_sales",
                column: "OriginalAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_cancelled_sales_SoldByStaffMemberId",
                table: "cancelled_sales",
                column: "SoldByStaffMemberId");

            migrationBuilder.CreateIndex(
                name: "IX_cancelled_sales_TenantId_CancelledAtUtc",
                table: "cancelled_sales",
                columns: new[] { "TenantId", "CancelledAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_cancelled_sales_TenantId_CustomerId",
                table: "cancelled_sales",
                columns: new[] { "TenantId", "CustomerId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cancelled_sales");
        }
    }
}

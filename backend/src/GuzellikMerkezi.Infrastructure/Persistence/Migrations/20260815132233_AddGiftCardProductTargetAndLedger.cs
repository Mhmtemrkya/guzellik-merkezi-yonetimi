using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGiftCardProductTargetAndLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ProductId",
                table: "gift_cards",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "gift_card_transactions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    GiftCardId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Direction = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    BalanceDelta = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    UsesDelta = table.Column<int>(type: "int", nullable: false),
                    BalanceAfter = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    UsedCountAfter = table.Column<int>(type: "int", nullable: false),
                    SourceType = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    SourceId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: true),
                    PerformedByUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_gift_card_transactions", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_gift_card_transactions_TenantId_GiftCardId_OccurredAtUtc",
                table: "gift_card_transactions",
                columns: new[] { "TenantId", "GiftCardId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_gift_card_transactions_TenantId_OccurredAtUtc",
                table: "gift_card_transactions",
                columns: new[] { "TenantId", "OccurredAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "gift_card_transactions");

            migrationBuilder.DropColumn(
                name: "ProductId",
                table: "gift_cards");
        }
    }
}

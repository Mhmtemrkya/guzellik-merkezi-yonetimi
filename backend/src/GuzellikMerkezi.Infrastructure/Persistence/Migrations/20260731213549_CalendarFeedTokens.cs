using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CalendarFeedTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "calendar_feed_tokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Kind = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    StaffMemberId = table.Column<Guid>(type: "char(36)", nullable: true),
                    TokenHash = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    RevokedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    LastUsedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_calendar_feed_tokens", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_calendar_feed_tokens_TenantId_Kind_StaffMemberId",
                table: "calendar_feed_tokens",
                columns: new[] { "TenantId", "Kind", "StaffMemberId" });

            migrationBuilder.CreateIndex(
                name: "IX_calendar_feed_tokens_TokenHash",
                table: "calendar_feed_tokens",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "calendar_feed_tokens");
        }
    }
}

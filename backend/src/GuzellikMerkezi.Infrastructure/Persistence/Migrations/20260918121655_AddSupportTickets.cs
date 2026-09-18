using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSupportTickets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "support_tickets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    Code = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    AccessToken = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    Subject = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    Category = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    Priority = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: true),
                    TenantNameSnapshot = table.Column<string>(type: "varchar(160)", maxLength: 160, nullable: true),
                    RequesterUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    RequesterName = table.Column<string>(type: "varchar(160)", maxLength: 160, nullable: false),
                    RequesterEmail = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    RequesterPhone = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: true),
                    AssignedToUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    LastMessageAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    FirstResponseAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    ResolvedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    ClosedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    HasUnreadForRequester = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasUnreadForPlatform = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_support_tickets", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "support_ticket_messages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    SupportTicketId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Side = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Body = table.Column<string>(type: "varchar(4000)", maxLength: 4000, nullable: false),
                    AuthorUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    AuthorName = table.Column<string>(type: "varchar(160)", maxLength: 160, nullable: true),
                    SentAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_support_ticket_messages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_support_ticket_messages_support_tickets_SupportTicketId",
                        column: x => x.SupportTicketId,
                        principalTable: "support_tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_support_ticket_messages_SupportTicketId_SentAtUtc",
                table: "support_ticket_messages",
                columns: new[] { "SupportTicketId", "SentAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_support_tickets_Code",
                table: "support_tickets",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_support_tickets_Status_LastMessageAtUtc",
                table: "support_tickets",
                columns: new[] { "Status", "LastMessageAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_support_tickets_TenantId",
                table: "support_tickets",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "support_ticket_messages");

            migrationBuilder.DropTable(
                name: "support_tickets");
        }
    }
}

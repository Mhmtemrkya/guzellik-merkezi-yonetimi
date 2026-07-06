using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAppNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "app_notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    RecipientUserId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Type = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false),
                    Severity = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "longtext", nullable: false),
                    Body = table.Column<string>(type: "longtext", nullable: false),
                    DataJson = table.Column<string>(type: "longtext", nullable: true),
                    DedupeKey = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: true),
                    IsRead = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    ReadAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_notifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_app_notifications_branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_app_notifications_tenant_users_RecipientUserId",
                        column: x => x.RecipientUserId,
                        principalTable: "tenant_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "device_notification_tokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantUserId = table.Column<Guid>(type: "char(36)", nullable: false),
                    DeviceId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    Token = table.Column<string>(type: "varchar(512)", maxLength: 512, nullable: false),
                    Platform = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    LastSeenUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_notification_tokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_device_notification_tokens_tenant_users_TenantUserId",
                        column: x => x.TenantUserId,
                        principalTable: "tenant_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_app_notifications_BranchId",
                table: "app_notifications",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_app_notifications_RecipientUserId",
                table: "app_notifications",
                column: "RecipientUserId");

            migrationBuilder.CreateIndex(
                name: "IX_app_notifications_TenantId_DedupeKey",
                table: "app_notifications",
                columns: new[] { "TenantId", "DedupeKey" });

            migrationBuilder.CreateIndex(
                name: "IX_app_notifications_TenantId_RecipientUserId_CreatedAtUtc",
                table: "app_notifications",
                columns: new[] { "TenantId", "RecipientUserId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_device_notification_tokens_TenantId",
                table: "device_notification_tokens",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_device_notification_tokens_TenantUserId_DeviceId",
                table: "device_notification_tokens",
                columns: new[] { "TenantUserId", "DeviceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "app_notifications");

            migrationBuilder.DropTable(
                name: "device_notification_tokens");
        }
    }
}

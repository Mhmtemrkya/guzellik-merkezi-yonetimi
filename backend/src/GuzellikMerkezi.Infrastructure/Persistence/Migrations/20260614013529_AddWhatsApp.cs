using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWhatsApp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CustomerConfirmation",
                table: "appointments",
                type: "varchar(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastReminderAtUtc",
                table: "appointments",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "whatsapp_messages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    AppointmentId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: true),
                    Direction = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Phone = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    Body = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Intent = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    TemplateName = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: true),
                    ErrorMessage = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_whatsapp_messages", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "whatsapp_settings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Enabled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    PhoneNumberId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    AccessTokenEncrypted = table.Column<string>(type: "TEXT", nullable: true),
                    BusinessAccountId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    VerifyToken = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: true),
                    ReminderTemplate = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    Provider = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_whatsapp_settings", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_messages_TenantId_AppointmentId",
                table: "whatsapp_messages",
                columns: new[] { "TenantId", "AppointmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_messages_TenantId_Direction_CreatedAtUtc",
                table: "whatsapp_messages",
                columns: new[] { "TenantId", "Direction", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_settings_PhoneNumberId",
                table: "whatsapp_settings",
                column: "PhoneNumberId");

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_settings_TenantId",
                table: "whatsapp_settings",
                column: "TenantId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "whatsapp_messages");

            migrationBuilder.DropTable(
                name: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "CustomerConfirmation",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "LastReminderAtUtc",
                table: "appointments");
        }
    }
}

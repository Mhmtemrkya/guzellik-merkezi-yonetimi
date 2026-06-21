using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPlatformIntegrationSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "platform_integration_settings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    SmsEnabled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    SmsProvider = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: false),
                    SmsApiKeyEncrypted = table.Column<string>(type: "TEXT", nullable: true),
                    SmsApiSecretEncrypted = table.Column<string>(type: "TEXT", nullable: true),
                    SmsSender = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    SmsApiUrl = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    EmailEnabled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    EmailFromAddress = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    EmailFromName = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: true),
                    SmtpHost = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    SmtpPort = table.Column<int>(type: "int", nullable: false),
                    SmtpUsername = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    SmtpPasswordEncrypted = table.Column<string>(type: "TEXT", nullable: true),
                    SmtpUseSsl = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_platform_integration_settings", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "platform_integration_settings");
        }
    }
}

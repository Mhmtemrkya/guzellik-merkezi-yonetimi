using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceSecurity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DeviceControlEnabled",
                table: "tenants",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "MaxDeviceCount",
                table: "tenant_users",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeviceId",
                table: "audit_logs",
                type: "varchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeviceInfoJson",
                table: "audit_logs",
                type: "longtext",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "staff_devices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantUserId = table.Column<Guid>(type: "char(36)", nullable: false),
                    DeviceId = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false),
                    Name = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    DeviceType = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: true),
                    UserAgent = table.Column<string>(type: "varchar(512)", maxLength: 512, nullable: true),
                    NetworkInfoJson = table.Column<string>(type: "longtext", nullable: true),
                    LastIpAddress = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
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
                    table.PrimaryKey("PK_staff_devices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_staff_devices_tenant_users_TenantUserId",
                        column: x => x.TenantUserId,
                        principalTable: "tenant_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_TenantId_Action",
                table: "audit_logs",
                columns: new[] { "TenantId", "Action" });

            migrationBuilder.CreateIndex(
                name: "IX_staff_devices_TenantId",
                table: "staff_devices",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_staff_devices_TenantUserId_DeviceId",
                table: "staff_devices",
                columns: new[] { "TenantUserId", "DeviceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "staff_devices");

            migrationBuilder.DropIndex(
                name: "IX_audit_logs_TenantId_Action",
                table: "audit_logs");

            migrationBuilder.DropColumn(
                name: "DeviceControlEnabled",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "MaxDeviceCount",
                table: "tenant_users");

            migrationBuilder.DropColumn(
                name: "DeviceId",
                table: "audit_logs");

            migrationBuilder.DropColumn(
                name: "DeviceInfoJson",
                table: "audit_logs");
        }
    }
}

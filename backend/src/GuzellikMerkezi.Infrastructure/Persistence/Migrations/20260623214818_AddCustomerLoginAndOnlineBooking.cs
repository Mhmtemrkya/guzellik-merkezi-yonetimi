using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerLoginAndOnlineBooking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "TenantUserId",
                table: "refresh_tokens",
                type: "char(36)",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "char(36)");

            migrationBuilder.AddColumn<Guid>(
                name: "CustomerId",
                table: "refresh_tokens",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastLoginUtc",
                table: "customers",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "LoginEnabled",
                table: "customers",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "MustChangePassword",
                table: "customers",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NationalId",
                table: "customers",
                type: "longtext",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PasswordHash",
                table: "customers",
                type: "varchar(512)",
                maxLength: 512,
                nullable: true);

            // Mevcut şubeler için makul varsayılan çalışma penceresi (09:00–20:00). Yeni kayıtlarda
            // değer entity'den gelir; defaultValueSql yalnızca ALTER sırasında eski satırları doldurur.
            migrationBuilder.AddColumn<TimeSpan>(
                name: "CloseTime",
                table: "branches",
                type: "time",
                nullable: false,
                defaultValueSql: "'20:00:00'");

            migrationBuilder.AddColumn<TimeSpan>(
                name: "OpenTime",
                table: "branches",
                type: "time",
                nullable: false,
                defaultValueSql: "'09:00:00'");

            migrationBuilder.AddColumn<int>(
                name: "SlotMinutes",
                table: "branches",
                type: "int",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<bool>(
                name: "IsOnline",
                table: "appointments",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_refresh_tokens_CustomerId",
                table: "refresh_tokens",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_customers_Phone",
                table: "customers",
                column: "Phone");

            migrationBuilder.AddForeignKey(
                name: "FK_refresh_tokens_customers_CustomerId",
                table: "refresh_tokens",
                column: "CustomerId",
                principalTable: "customers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_refresh_tokens_customers_CustomerId",
                table: "refresh_tokens");

            migrationBuilder.DropIndex(
                name: "IX_refresh_tokens_CustomerId",
                table: "refresh_tokens");

            migrationBuilder.DropIndex(
                name: "IX_customers_Phone",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "CustomerId",
                table: "refresh_tokens");

            migrationBuilder.DropColumn(
                name: "LastLoginUtc",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "LoginEnabled",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "MustChangePassword",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "NationalId",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "PasswordHash",
                table: "customers");

            migrationBuilder.DropColumn(
                name: "CloseTime",
                table: "branches");

            migrationBuilder.DropColumn(
                name: "OpenTime",
                table: "branches");

            migrationBuilder.DropColumn(
                name: "SlotMinutes",
                table: "branches");

            migrationBuilder.DropColumn(
                name: "IsOnline",
                table: "appointments");

            migrationBuilder.AlterColumn<Guid>(
                name: "TenantUserId",
                table: "refresh_tokens",
                type: "char(36)",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "char(36)",
                oldNullable: true);
        }
    }
}

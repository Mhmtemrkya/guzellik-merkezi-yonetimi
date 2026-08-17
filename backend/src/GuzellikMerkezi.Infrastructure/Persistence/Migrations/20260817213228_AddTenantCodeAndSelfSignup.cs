using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantCodeAndSelfSignup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Code",
                table: "tenants",
                type: "varchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsSelfSignup",
                table: "tenants",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "PhoneIndex",
                table: "tenants",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenants_Code",
                table: "tenants",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenants_PhoneIndex",
                table: "tenants",
                column: "PhoneIndex");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_tenants_Code",
                table: "tenants");

            migrationBuilder.DropIndex(
                name: "IX_tenants_PhoneIndex",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "IsSelfSignup",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "PhoneIndex",
                table: "tenants");
        }
    }
}

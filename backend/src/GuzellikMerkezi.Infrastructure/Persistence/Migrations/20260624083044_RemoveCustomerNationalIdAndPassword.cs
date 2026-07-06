using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveCustomerNationalIdAndPassword : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_customers_Phone",
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

            migrationBuilder.CreateIndex(
                name: "IX_customers_BirthDate",
                table: "customers",
                column: "BirthDate");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_customers_BirthDate",
                table: "customers");

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

            migrationBuilder.CreateIndex(
                name: "IX_customers_Phone",
                table: "customers",
                column: "Phone");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLoyaltyPointCost : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LoyaltyPointCost",
                table: "service_packages",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LoyaltyPointCost",
                table: "service_definitions",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LoyaltyPointCost",
                table: "service_packages");

            migrationBuilder.DropColumn(
                name: "LoyaltyPointCost",
                table: "service_definitions");
        }
    }
}

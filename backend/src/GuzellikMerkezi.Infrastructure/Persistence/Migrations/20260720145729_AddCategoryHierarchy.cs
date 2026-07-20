using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCategoryHierarchy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SubCategory",
                table: "service_packages",
                type: "longtext",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SubCategory",
                table: "service_definitions",
                type: "longtext",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ParentId",
                table: "custom_service_categories",
                type: "char(36)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SubCategory",
                table: "service_packages");

            migrationBuilder.DropColumn(
                name: "SubCategory",
                table: "service_definitions");

            migrationBuilder.DropColumn(
                name: "ParentId",
                table: "custom_service_categories");
        }
    }
}

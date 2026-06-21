using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdisyonInstallmentPlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PlannedFirstDueDate",
                table: "adisyonlar",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PlannedInstallmentCount",
                table: "adisyonlar",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PlannedFirstDueDate",
                table: "adisyonlar");

            migrationBuilder.DropColumn(
                name: "PlannedInstallmentCount",
                table: "adisyonlar");
        }
    }
}

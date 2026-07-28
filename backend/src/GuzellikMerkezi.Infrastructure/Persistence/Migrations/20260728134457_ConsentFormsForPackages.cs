using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ConsentFormsForPackages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "ServiceDefinitionId",
                table: "service_consent_forms",
                type: "char(36)",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "char(36)");

            migrationBuilder.AddColumn<Guid>(
                name: "ServicePackageId",
                table: "service_consent_forms",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_consent_forms_ServicePackageId",
                table: "service_consent_forms",
                column: "ServicePackageId");

            migrationBuilder.CreateIndex(
                name: "IX_service_consent_forms_TenantId_ServicePackageId",
                table: "service_consent_forms",
                columns: new[] { "TenantId", "ServicePackageId" });

            migrationBuilder.AddForeignKey(
                name: "FK_service_consent_forms_service_packages_ServicePackageId",
                table: "service_consent_forms",
                column: "ServicePackageId",
                principalTable: "service_packages",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_service_consent_forms_service_packages_ServicePackageId",
                table: "service_consent_forms");

            migrationBuilder.DropIndex(
                name: "IX_service_consent_forms_ServicePackageId",
                table: "service_consent_forms");

            migrationBuilder.DropIndex(
                name: "IX_service_consent_forms_TenantId_ServicePackageId",
                table: "service_consent_forms");

            migrationBuilder.DropColumn(
                name: "ServicePackageId",
                table: "service_consent_forms");

            migrationBuilder.AlterColumn<Guid>(
                name: "ServiceDefinitionId",
                table: "service_consent_forms",
                type: "char(36)",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "char(36)",
                oldNullable: true);
        }
    }
}

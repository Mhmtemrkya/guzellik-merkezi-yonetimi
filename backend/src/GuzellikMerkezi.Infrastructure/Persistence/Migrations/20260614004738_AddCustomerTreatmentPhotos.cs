using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerTreatmentPhotos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "customer_treatment_photos",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    ServiceDefinitionId = table.Column<Guid>(type: "char(36)", nullable: true),
                    Kind = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    ImageUrl = table.Column<string>(type: "LONGTEXT", nullable: false),
                    TakenAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Note = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_customer_treatment_photos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_customer_treatment_photos_service_definitions_ServiceDefinit~",
                        column: x => x.ServiceDefinitionId,
                        principalTable: "service_definitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_customer_treatment_photos_ServiceDefinitionId",
                table: "customer_treatment_photos",
                column: "ServiceDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_customer_treatment_photos_TenantId_CustomerId_TakenAtUtc",
                table: "customer_treatment_photos",
                columns: new[] { "TenantId", "CustomerId", "TakenAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "customer_treatment_photos");
        }
    }
}

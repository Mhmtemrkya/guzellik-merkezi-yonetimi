using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddConsentForms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "consent_form_templates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Title = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "LONGTEXT", nullable: false),
                    CheckItemsJson = table.Column<string>(type: "LONGTEXT", nullable: true),
                    RequiresSignature = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    IsActive = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_consent_form_templates", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "customer_consent_forms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    AppointmentId = table.Column<Guid>(type: "char(36)", nullable: true),
                    ConsentFormTemplateId = table.Column<Guid>(type: "char(36)", nullable: true),
                    Title = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "LONGTEXT", nullable: false),
                    CheckItemsJson = table.Column<string>(type: "LONGTEXT", nullable: true),
                    RequiresSignature = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CustomerName = table.Column<string>(type: "longtext", nullable: true),
                    ServiceDefinitionId = table.Column<Guid>(type: "char(36)", nullable: true),
                    ServiceName = table.Column<string>(type: "varchar(200)", maxLength: 200, nullable: true),
                    StaffMemberId = table.Column<Guid>(type: "char(36)", nullable: true),
                    StaffName = table.Column<string>(type: "longtext", nullable: true),
                    StaffNotes = table.Column<string>(type: "longtext", nullable: true),
                    Status = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    SessionToken = table.Column<Guid>(type: "char(36)", nullable: true),
                    StationName = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: true),
                    SessionExpiresAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CheckedItemsJson = table.Column<string>(type: "LONGTEXT", nullable: true),
                    SignatureImage = table.Column<string>(type: "LONGTEXT", nullable: true),
                    SignedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    SignerName = table.Column<string>(type: "longtext", nullable: true),
                    SignerDevice = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: true),
                    SignerIp = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_customer_consent_forms", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "service_consent_forms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    ServiceDefinitionId = table.Column<Guid>(type: "char(36)", nullable: false),
                    ConsentFormTemplateId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_consent_forms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_service_consent_forms_consent_form_templates_ConsentFormTemp~",
                        column: x => x.ConsentFormTemplateId,
                        principalTable: "consent_form_templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_service_consent_forms_service_definitions_ServiceDefinitionId",
                        column: x => x.ServiceDefinitionId,
                        principalTable: "service_definitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_consent_form_templates_TenantId_SortOrder",
                table: "consent_form_templates",
                columns: new[] { "TenantId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_customer_consent_forms_SessionToken",
                table: "customer_consent_forms",
                column: "SessionToken");

            migrationBuilder.CreateIndex(
                name: "IX_customer_consent_forms_TenantId_CustomerId",
                table: "customer_consent_forms",
                columns: new[] { "TenantId", "CustomerId" });

            migrationBuilder.CreateIndex(
                name: "IX_customer_consent_forms_TenantId_Status_StationName",
                table: "customer_consent_forms",
                columns: new[] { "TenantId", "Status", "StationName" });

            migrationBuilder.CreateIndex(
                name: "IX_service_consent_forms_ConsentFormTemplateId",
                table: "service_consent_forms",
                column: "ConsentFormTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_service_consent_forms_ServiceDefinitionId",
                table: "service_consent_forms",
                column: "ServiceDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_service_consent_forms_TenantId_ConsentFormTemplateId",
                table: "service_consent_forms",
                columns: new[] { "TenantId", "ConsentFormTemplateId" });

            migrationBuilder.CreateIndex(
                name: "IX_service_consent_forms_TenantId_ServiceDefinitionId",
                table: "service_consent_forms",
                columns: new[] { "TenantId", "ServiceDefinitionId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "customer_consent_forms");

            migrationBuilder.DropTable(
                name: "service_consent_forms");

            migrationBuilder.DropTable(
                name: "consent_form_templates");
        }
    }
}

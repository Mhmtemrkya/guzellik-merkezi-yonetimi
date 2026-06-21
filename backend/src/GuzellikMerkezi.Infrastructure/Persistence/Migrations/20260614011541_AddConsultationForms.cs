using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddConsultationForms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "consultation_forms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    IsPregnant = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    IsBreastfeeding = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasPacemakerOrImplant = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasEpilepsy = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasDiabetes = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasCancerHistory = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    UsesBloodThinners = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    UsedIsotretinoin = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasKeloidTendency = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    HasActiveSkinIssue = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    RecentSunExposure = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    SkinType = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Allergies = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    Medications = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    ChronicConditions = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    Complaint = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true),
                    Notes = table.Column<string>(type: "varchar(2000)", maxLength: 2000, nullable: true),
                    ConsentGiven = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    ConsentAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    FilledByName = table.Column<string>(type: "varchar(160)", maxLength: 160, nullable: true),
                    TakenAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_consultation_forms", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_consultation_forms_TenantId_CustomerId",
                table: "consultation_forms",
                columns: new[] { "TenantId", "CustomerId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "consultation_forms");
        }
    }
}

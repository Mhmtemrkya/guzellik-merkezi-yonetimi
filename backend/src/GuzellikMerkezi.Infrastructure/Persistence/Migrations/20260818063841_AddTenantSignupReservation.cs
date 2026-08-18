using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantSignupReservation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tenant_signup_reservations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    EmailKey = table.Column<string>(type: "varchar(180)", maxLength: 180, nullable: false),
                    PhoneKey = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_signup_reservations", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_tenant_signup_reservations_EmailKey",
                table: "tenant_signup_reservations",
                column: "EmailKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenant_signup_reservations_PhoneKey",
                table: "tenant_signup_reservations",
                column: "PhoneKey",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tenant_signup_reservations");
        }
    }
}

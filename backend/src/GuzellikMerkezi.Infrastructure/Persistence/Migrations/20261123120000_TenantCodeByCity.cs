using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Kurum kodu BA-ŞEHİR-SIRA biçimine geçer (kullanıcı kararı 23 Kas 2026): "BA-AFYONKARAHISAR-001" 21 karakter olduğu için
    /// kolon 40'a genişler. Mevcut kurumların yeniden numaralanması açılıştaki backfill'dedir (şube şehri şifreli; SQL okuyamaz).
    /// </summary>
    [DbContext(typeof(GuzellikDbContext))]
    [Migration("20261123120000_TenantCodeByCity")]
    public partial class TenantCodeByCity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Code",
                table: "tenants",
                type: "varchar(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "varchar(20)",
                oldMaxLength: 20,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Code",
                table: "tenants",
                type: "varchar(20)",
                maxLength: 20,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "varchar(40)",
                oldMaxLength: 40,
                oldNullable: true);
        }
    }
}

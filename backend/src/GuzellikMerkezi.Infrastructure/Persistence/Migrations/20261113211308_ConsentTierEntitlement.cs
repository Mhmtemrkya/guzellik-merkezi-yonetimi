using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DİJİTAL ONAM HAKKI: faturanın ÖDENDİĞİNDE dönemi boyunca açtığı onam kademesi (eşik). İmza kapısı yalnız
    /// "Paid" ve bugünü kapsayan faturalardaki en yüksek değeri esas alır. Eski faturalar NULL kalır (yalnız
    /// ücretsiz bölüm) — 10.000 evrağı aşmış kurum bu sürümden sonra kademe ödenene kadar yeni onam imzalatamaz.
    /// </summary>
    public partial class ConsentTierEntitlement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ConsentTierAbove",
                table: "tenant_invoices",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ConsentTierAbove",
                table: "tenant_invoices");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// TÜM ÜCRETLİ LİMİTLER ÖDEMEDEN KULLANILAMAZ: (1) faturanın ÖDENDİĞİNDE açtığı MÜŞTERİ kademesi; (2) kartsız
    /// kurumun ödeme bekleyen şube talebi (şube fatura "Ödendi" yapılınca açılır). Eski faturalar NULL kalır —
    /// 10.000 müşteriyi aşmış kurum bu sürümden sonra kademe ödenene kadar yeni müşteri ekleyemez.
    /// </summary>
    public partial class CustomerTierAndBranchOnPayment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CustomerTierAbove",
                table: "tenant_invoices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PendingBranchJson",
                table: "tenant_invoices",
                type: "varchar(1000)",
                maxLength: 1000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CustomerTierAbove",
                table: "tenant_invoices");

            migrationBuilder.DropColumn(
                name: "PendingBranchJson",
                table: "tenant_invoices");
        }
    }
}

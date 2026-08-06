using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ApprovalStampExpenseReversalPaymentLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PayoutExpenseId",
                table: "staff_commissions",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RequesterSecurityStampUtc",
                table: "pending_operations",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ReversalOfExpenseId",
                table: "business_expenses",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceAppointmentId",
                table: "account_payments",
                type: "char(36)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_staff_commissions_PayoutExpenseId",
                table: "staff_commissions",
                column: "PayoutExpenseId");

            migrationBuilder.CreateIndex(
                name: "IX_business_expenses_ReversalOfExpenseId",
                table: "business_expenses",
                column: "ReversalOfExpenseId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_account_payments_SourceAppointmentId",
                table: "account_payments",
                column: "SourceAppointmentId");

            // ESKİ BEKLEYEN ONAYLARIN DAMGASI DOLDURULUR (fail-open penceresini kapatır).
            //
            // Kolon eklendiğinde kuyrukta zaten bekleyen istekler NULL damgalı kalırdı ve
            // karşılaştırma atlandığı için parola sıfırlama / zorunlu çıkış SONRASINDA bile
            // uygulanabilirlerdi — korumanın engellemesi gereken durumun ta kendisi.
            //
            // Yalnız KARARA BAĞLANMAMIŞ kayıtlar doldurulur (Pending/Processing): geçmiş kayıtların
            // damgası anlamsızdır. Değer, istek sahibinin O ANDAKİ damgasıdır; damgası olmayan
            // kullanıcı için sentinel ('0001-01-01') yazılır — böylece bu andan SONRA yapılan bir
            // iptal farklı olur ve yakalanır. Kullanıcısı silinmiş kayıtlar da sentinel alır;
            // zaten onlarda replay istek sahibi bulunamadığı için ayrıca durur.
            migrationBuilder.Sql(
                "UPDATE `pending_operations` p " +
                "LEFT JOIN `tenant_users` u ON u.`Id` = p.`RequestedByUserId` " +
                "SET p.`RequesterSecurityStampUtc` = COALESCE(u.`SecurityStampUtc`, '0001-01-01 00:00:00') " +
                "WHERE p.`RequesterSecurityStampUtc` IS NULL AND p.`Status` IN ('Pending', 'Processing');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_staff_commissions_PayoutExpenseId",
                table: "staff_commissions");

            migrationBuilder.DropIndex(
                name: "IX_business_expenses_ReversalOfExpenseId",
                table: "business_expenses");

            migrationBuilder.DropIndex(
                name: "IX_account_payments_SourceAppointmentId",
                table: "account_payments");

            migrationBuilder.DropColumn(
                name: "PayoutExpenseId",
                table: "staff_commissions");

            migrationBuilder.DropColumn(
                name: "RequesterSecurityStampUtc",
                table: "pending_operations");

            migrationBuilder.DropColumn(
                name: "ReversalOfExpenseId",
                table: "business_expenses");

            migrationBuilder.DropColumn(
                name: "SourceAppointmentId",
                table: "account_payments");
        }
    }
}

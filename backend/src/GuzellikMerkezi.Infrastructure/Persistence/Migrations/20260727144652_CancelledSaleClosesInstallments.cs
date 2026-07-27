using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Veri düzeltmesi (şema değişikliği yok): iptal edilen satışın ödenmemiş taksitleri kapatılır.
    /// CancelSale eskiden yalnızca IsActive/CancelledAtUtc yazıyordu; taksitler Planned kaldığı için
    /// iptal edilmiş satış Ön Muhasebe'de hâlâ açık borç/geciken taksit gösteriyordu.
    /// Ödenmiş taksitler ve tahsilat kayıtları KORUNUR — yalnızca alacak düşer.
    /// </summary>
    public partial class CancelledSaleClosesInstallments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE account_installments i
                JOIN customer_accounts a ON a.Id = i.CustomerAccountId
                SET i.Status = 'Cancelled', i.UpdatedAtUtc = UTC_TIMESTAMP()
                WHERE a.CancelledAtUtc IS NOT NULL
                  AND i.Status = 'Planned'
                  AND i.IsDeleted = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Geri alınamaz: hangi taksitin iptalden mi yoksa elle mi kapatıldığı ayırt edilemez.
        }
    }
}

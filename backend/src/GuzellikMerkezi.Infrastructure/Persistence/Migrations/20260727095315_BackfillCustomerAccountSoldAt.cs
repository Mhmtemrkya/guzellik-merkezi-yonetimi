using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Veri düzeltmesi (şema değişikliği yok): SoldAtUtc kolonu 20260725211801 ile eklendi ve
    /// mevcut cariler varsayılan 0001-01-01 ile kaldı. Pano > Paket Raporu > Satış Detayı dönemi
    /// (Gün/Hafta/Ay/Yıl) SoldAtUtc ile süzdüğü için bu kayıtlar HİÇBİR dönemde görünmüyordu.
    /// Satış tarihi için en iyi vekil kayıt tarihidir — Mapping.ToDto zaten aynı kurala düşüyor.
    /// </summary>
    public partial class BackfillCustomerAccountSoldAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE customer_accounts
                SET SoldAtUtc = CreatedAtUtc
                WHERE SoldAtUtc < '1900-01-01 00:00:00'
                  AND CreatedAtUtc >= '1900-01-01 00:00:00';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Geri alınamaz: doldurulmuş satış tarihiyle gerçek satış tarihi artık ayırt edilemez.
            // Kolonun kendisi 20260725211801'in Down'ında zaten düşürülüyor.
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// SATIŞ ANINDAKİ BİRİM FİYATI SEANS SATIRINA DONDURUR.
    ///
    /// <para>
    /// Karma satışın cirosu hizmetler arasında fiyat ağırlığıyla bölünür. Ağırlık GÜNCEL
    /// katalogdan okununca kataloğa yapılan bir düzenleme KAPANMIŞ dönemin cirosunu
    /// değiştiriyordu: ölçülen örnekte yalnız DİĞER hizmetin fiyatı değişince aynı satışın aynı
    /// dönemdeki cirosu 1.000 → 250'ye düştü.
    /// </para>
    /// <para>
    /// KOLON VE BACKFILL AYNI MIGRATION'DA: bu depoda "varsayılanlı kolon eklendi, backfill
    /// sonraya bırakıldı" hatası daha önce yaşandı ve eski kayıtlar raporlardan sessizce
    /// düşmüştü. Mevcut satırlar BUGÜNÜN katalog fiyatıyla doldurulur — geçmişi bundan sonrası
    /// için SABİTLER; tek seferlik bir yaklaşımdır, sonraki düzenlemeler artık etkilemez.
    /// </para>
    /// </summary>
    public partial class AddSessionUnitPriceAtSale : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "UnitPriceAtSale",
                table: "customer_package_sessions",
                type: "decimal(18,2)",
                nullable: true);

            // BACKFILL — kolonla AYNI migration'da. NULL bırakılırsa eski satışların dağıtımı
            // seans adedine düşer ve mevcut raporlanmış rakamlar bir anda değişirdi.
            // Fiyatı 0/negatif olan hizmet DOLDURULMAZ: null "bilinmiyor" demektir, 0 ise
            // "bedava satıldı" ile karışır ve ağırlığı bozar.
            migrationBuilder.Sql(@"
                UPDATE customer_package_sessions s
                JOIN service_definitions d ON d.Id = s.ServiceDefinitionId
                SET s.UnitPriceAtSale = d.Price
                WHERE s.UnitPriceAtSale IS NULL AND d.Price > 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UnitPriceAtSale",
                table: "customer_package_sessions");
        }
    }
}

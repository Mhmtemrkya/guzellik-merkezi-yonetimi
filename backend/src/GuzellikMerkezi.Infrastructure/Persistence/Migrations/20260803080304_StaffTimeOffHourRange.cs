using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Personel iznine SAAT ARALIĞI ekler: bir gün içinde yalnız belirli saatler kapatılabilir.
    /// Tüm gün kapalı = 0–1440 (mevcut kayıtların tamamı böyle backfill edilir).
    /// </summary>
    public partial class StaffTimeOffHourRange : Migration
    {
        // Eski (StaffMemberId, Date) UNIQUE index'i ortamdan ortama FARKLI ADLA duruyor: EF'in ürettiği
        // "IX_staff_time_offs_StaffMemberId_Date" ve ham-SQL bootstrap döneminden kalan
        // "IX_staff_time_offs_Staff_Date". Adı sabit yazan DROP INDEX diğer ortamda patlıyor, MySQL'de
        // "DROP INDEX IF EXISTS" de yok. Bu yüzden hatayı yutan bir yordamla iki adı da deniyoruz.
    // ESKİ BENZERSİZ İNDEKSİN DÜŞÜRÜLMESİ — SAKLI YORDAM KULLANILMAZ.
    //
    // Burada eskiden "hata yut" işleyicili bir CREATE PROCEDURE vardı: indeks var da olabilir yok
    // da (elle düzeltilmiş kurulumlar için). Gövdesi içinde noktalı virgül taşıdığı için
    // `dotnet ef migrations script` ile üretilen betik ÇALIŞMIYORDU: betik `;` ile bölündüğünden
    // yordam gövdesi parçalanıp MariaDB/MySQL 1064 veriyordu. Yani SIFIRDAN KURULUM betik yoluyla
    // yapılamıyordu (uygulama içi çalıştırıcı komutları tek tek yürüttüğü için hatayı gizliyordu).
    //
    // ARTIK GEREKSİZ: `IX_staff_time_offs_StaffMemberId_Date` zincirde InitialCreate tarafından
    // oluşturuluyor, yani bu migration'a gelen HER veritabanında vardır → koşulsuz düşürülebilir.
    // `IX_staff_time_offs_Staff_Date` ise hiçbir migration'da oluşturulmuyor; yalnız elle
    // düzeltilmiş eski kurulumlarda olabilirdi ve onların hepsi bu migration'ı ÇOKTAN uyguladı.
    // Bundan sonra bu migration yalnız yeni kurulumlarda çalışacağı için o indeks hiç var olmaz.
    // Sonuç: uygulanmış kurulumlarda son durum aynı, yeni kurulumlarda betik yolu artık çalışıyor.


        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // MEVCUT KAYITLAR TÜM GÜN İZİNDİR → 0–1440. EndMinute varsayılanı 0 bırakılsaydı
            // eski izinlerin hepsi "0–0" (boş aralık) olup hiçbir randevuyu engellemez hâle gelirdi.
            migrationBuilder.AddColumn<int>(
                name: "EndMinute",
                table: "staff_time_offs",
                type: "int",
                nullable: false,
                defaultValue: 1440);

            migrationBuilder.AddColumn<int>(
                name: "StartMinute",
                table: "staff_time_offs",
                type: "int",
                nullable: false,
                defaultValue: 0);

            // Kolon önceden (yarım kalmış bir uygulamayla) eklenmiş olabilir — backfill'i garantiye al.
            migrationBuilder.Sql("UPDATE staff_time_offs SET StartMinute = 0, EndMinute = 1440 WHERE EndMinute <= StartMinute;");

            // ÖNCE yeni index kurulur: StaffMemberId ile başladığı için FK'yi o destekler, böylece eskisi
            // "foreign key constraint için gerekli" hatası vermeden düşürülebilir.
            migrationBuilder.CreateIndex(
                name: "IX_staff_time_offs_StaffMemberId_Date_StartMinute",
                table: "staff_time_offs",
                columns: new[] { "StaffMemberId", "Date", "StartMinute" },
                unique: true);

            migrationBuilder.Sql("ALTER TABLE `staff_time_offs` DROP INDEX `IX_staff_time_offs_StaffMemberId_Date`;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Geri alırken aralık kaydı olan satırlar (StaffMemberId, Date) benzersizliğini bozar — önce onlar
            // temizlenir, sonra tüm gün kayıtları kalır.
            migrationBuilder.Sql("DELETE FROM staff_time_offs WHERE StartMinute > 0 OR EndMinute < 1440;");

            migrationBuilder.CreateIndex(
                name: "IX_staff_time_offs_StaffMemberId_Date",
                table: "staff_time_offs",
                columns: new[] { "StaffMemberId", "Date" },
                unique: true);

            migrationBuilder.DropIndex(
                name: "IX_staff_time_offs_StaffMemberId_Date_StartMinute",
                table: "staff_time_offs");

            migrationBuilder.DropColumn(
                name: "EndMinute",
                table: "staff_time_offs");

            migrationBuilder.DropColumn(
                name: "StartMinute",
                table: "staff_time_offs");
        }
    }
}

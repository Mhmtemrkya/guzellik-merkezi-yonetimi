using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AppointmentNumberUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ÖNCE MEVCUT MÜKERRERLERİ TEMİZLE, SONRA İNDEKSİ EKLE.
            //
            // Numara MAX(Number)+1 ile üretiliyordu ve kilit yoktu; eşzamanlı iki oluşturma aynı
            // numarayı alabiliyordu. Bu migration'ı çıplak CreateIndex olarak çalıştırmak, tek bir
            // mükerrer çift bulunan her veritabanında "Duplicate entry" ile PATLAR ve uygulama hiç
            // açılmaz (dev veritabanında bire bir yaşandı).
            //
            // Çakışan kayıtların EN ESKİSİ numarasını korur; sonrakiler o kurumun en büyük
            // numarasının üstünden yeniden numaralandırılır. Silinmiş (IsDeleted) satırlar da
            // kapsanır: benzersiz indeks tablodaki TÜM satırlara bakar, sorgu süzgecine değil.
            migrationBuilder.Sql(@"
UPDATE appointments a
JOIN (
    SELECT d.Id,
           m.mx + ROW_NUMBER() OVER (PARTITION BY d.TenantId ORDER BY d.Number, d.Id) AS NewNumber
    FROM (
        SELECT Id, TenantId, Number,
               ROW_NUMBER() OVER (PARTITION BY TenantId, Number ORDER BY CreatedAtUtc, Id) AS rn
        FROM appointments
        WHERE Number IS NOT NULL
    ) d
    JOIN (
        SELECT TenantId, MAX(Number) AS mx
        FROM appointments
        WHERE Number IS NOT NULL
        GROUP BY TenantId
    ) m ON m.TenantId = d.TenantId
    WHERE d.rn > 1
) x ON x.Id = a.Id
SET a.Number = x.NewNumber;");

            migrationBuilder.CreateIndex(
                name: "IX_appointments_TenantId_Number",
                table: "appointments",
                columns: new[] { "TenantId", "Number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_appointments_TenantId_Number",
                table: "appointments");
        }
    }
}

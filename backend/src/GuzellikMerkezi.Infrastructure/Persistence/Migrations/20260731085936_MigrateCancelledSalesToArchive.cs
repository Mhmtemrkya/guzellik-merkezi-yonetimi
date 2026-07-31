using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// VERİ TAŞIMA (şema değişikliği yok): eskiden yalnızca <c>CancelledAtUtc</c> damgasıyla
    /// işaretlenen iptal edilmiş satışlar <c>cancelled_sales</c> arşivine taşınır ve canlı
    /// tablolardan silinir.
    ///
    /// <para>Neden: damga modelinde satırlar yerinde kalıyordu ve her okuma yolunun kendi süzgecini
    /// koyması gerekiyordu; koymayanlar (kasa akışı, kâr-zarar, günlük adisyon kartı, müşteri
    /// harcaması) iptal edilmiş satışın parasını saymaya devam ediyordu. Satır yoksa sayılamaz.</para>
    ///
    /// <para>ŞİFRELİ KOLONLAR: Name / Notes / Method / Reference ciphertext olarak kopyalanır. Arşiv
    /// kolonları da aynı converter'a bağlı olduğu için okumada doğru çözülür; snapshot JSON'una giren
    /// ciphertext ise geri yüklemede <c>AesGcmEncryptionService.Encrypt</c>'in çift şifreleme
    /// koruması sayesinde olduğu gibi yazılır. Böylece eski kayıtların yedeği düz metin PII içermez.</para>
    ///
    /// <para>Idempotent: <c>NOT EXISTS</c> koruması sayesinde tekrar çalıştırılabilir.
    /// Down BOŞTUR — silinen satırlar yalnızca arşiv snapshot'ından, uygulamadaki
    /// "iptali geri al" akışıyla kurulabilir.</para>
    ///
    /// <para>
    /// MOTOR UYUMU: JSON boolean üretmek için <c>JSON_EXTRACT('true','$')</c> kullanılır.
    /// <c>CAST(x AS JSON)</c> MariaDB'de DESTEKLENMEZ (orada JSON, LONGTEXT takma adıdır) ve
    /// migration üretim sunucusunda patlardı. tinyint 1/0 doğrudan da yazılamaz: snapshot'ı okuyan
    /// System.Text.Json sayıyı bool'a çeviremez — gerçek JSON boolean şart. Okuma tarafında
    /// ayrıca toleranslı converter vardır (bkz. <c>SaleSnapshotReader.TolerantBoolConverter</c>).
    /// </para>
    /// </summary>
    public partial class MigrateCancelledSalesToArchive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) Arşive taşı. Snapshot, silinen satırların birebir JSON kopyasıdır ve
            //    CustomerAccountService'teki SaleSnapshot şemasıyla (PascalCase) uyumludur.
            //    IsActive/IsHistorical CAST(... AS JSON) ile gerçek JSON boolean'ı olur — tinyint 0/1
            //    doğrudan yazılsaydı System.Text.Json bunu bool'a çeviremez, geri alma patlardı.
            migrationBuilder.Sql(@"
                INSERT INTO cancelled_sales (
                    Id, TenantId, BranchId, OriginalAccountId, CustomerId, ServicePackageId, Name,
                    TotalAmount, DepositAmount, CollectedAmount, RefundedAmount,
                    SoldAtUtc, SoldByStaffMemberId, IsHistorical, SessionsTotal, SessionsUsed,
                    AdisyonId, CancelledAtUtc, CancellationReason, Snapshot, RestoredAtUtc,
                    CreatedAtUtc, UpdatedAtUtc, DeletedAtUtc, CreatedBy, UpdatedBy, IsDeleted)
                SELECT
                    UUID(),
                    a.TenantId,
                    a.BranchId,
                    a.Id,
                    a.CustomerId,
                    a.ServicePackageId,
                    a.Name,
                    a.TotalAmount,
                    a.DepositAmount,
                    a.DepositAmount + COALESCE((
                        SELECT SUM(p.Amount) FROM account_payments p
                        WHERE p.CustomerAccountId = a.Id AND p.IsDeleted = 0), 0),
                    0,
                    a.SoldAtUtc,
                    a.SoldByStaffMemberId,
                    a.IsHistorical,
                    COALESCE((SELECT SUM(s.TotalSessions) FROM customer_package_sessions s
                              WHERE s.CustomerAccountId = a.Id AND s.IsDeleted = 0), 0),
                    COALESCE((SELECT SUM(s.UsedSessions) FROM customer_package_sessions s
                              WHERE s.CustomerAccountId = a.Id AND s.IsDeleted = 0), 0),
                    (SELECT ad.Id FROM adisyonlar ad
                     WHERE ad.CustomerAccountId = a.Id AND ad.IsDeleted = 0 LIMIT 1),
                    a.CancelledAtUtc,
                    a.CancellationReason,
                    JSON_OBJECT(
                        'Version', 1,
                        'Account', JSON_OBJECT(
                            'Id', a.Id,
                            'TenantId', a.TenantId,
                            'BranchId', a.BranchId,
                            'CustomerId', a.CustomerId,
                            'ServicePackageId', a.ServicePackageId,
                            'Name', a.Name,
                            'TotalAmount', a.TotalAmount,
                            'DepositAmount', a.DepositAmount,
                            'Notes', a.Notes,
                            'IsActive', IF(a.IsActive = 1, JSON_EXTRACT('true', '$'), JSON_EXTRACT('false', '$')),
                            'SoldAtUtc', DATE_FORMAT(a.SoldAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ'),
                            'SoldByStaffMemberId', a.SoldByStaffMemberId,
                            'AppliedByStaffMemberId', a.AppliedByStaffMemberId,
                            'IsHistorical', IF(a.IsHistorical = 1, JSON_EXTRACT('true', '$'), JSON_EXTRACT('false', '$')),
                            'CreatedAtUtc', DATE_FORMAT(a.CreatedAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ'),
                            'CreatedBy', a.CreatedBy
                        ),
                        'Installments', COALESCE((
                            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                                'Id', i.Id,
                                'No', i.No,
                                'DueDate', DATE_FORMAT(i.DueDate, '%Y-%m-%d'),
                                'Amount', i.Amount,
                                'Status', i.Status,
                                'PaidAtUtc', DATE_FORMAT(i.PaidAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ'),
                                'CreatedAtUtc', DATE_FORMAT(i.CreatedAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ')))
                            FROM account_installments i
                            WHERE i.CustomerAccountId = a.Id AND i.IsDeleted = 0), JSON_ARRAY()),
                        'Payments', COALESCE((
                            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                                'Id', p.Id,
                                'Amount', p.Amount,
                                'Method', p.Method,
                                'Reference', p.Reference,
                                'OccurredAtUtc', DATE_FORMAT(p.OccurredAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ'),
                                'CreatedAtUtc', DATE_FORMAT(p.CreatedAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ')))
                            FROM account_payments p
                            WHERE p.CustomerAccountId = a.Id AND p.IsDeleted = 0), JSON_ARRAY()),
                        'Sessions', COALESCE((
                            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                                'Id', s.Id,
                                'ServicePackageId', s.ServicePackageId,
                                'ServiceDefinitionId', s.ServiceDefinitionId,
                                'TotalSessions', s.TotalSessions,
                                'UsedSessions', s.UsedSessions,
                                'SourceAdisyonId', s.SourceAdisyonId,
                                'CreatedAtUtc', DATE_FORMAT(s.CreatedAtUtc, '%Y-%m-%dT%H:%i:%s.%fZ')))
                            FROM customer_package_sessions s
                            WHERE s.CustomerAccountId = a.Id AND s.IsDeleted = 0), JSON_ARRAY()),
                        'AdisyonIds', COALESCE((
                            SELECT JSON_ARRAYAGG(ad.Id) FROM adisyonlar ad
                            WHERE ad.CustomerAccountId = a.Id AND ad.IsDeleted = 0), JSON_ARRAY())
                    ),
                    NULL,
                    UTC_TIMESTAMP(), NULL, NULL, NULL, NULL, 0
                FROM customer_accounts a
                WHERE a.CancelledAtUtc IS NOT NULL
                  AND a.IsDeleted = 0
                  AND NOT EXISTS (SELECT 1 FROM cancelled_sales c WHERE c.OriginalAccountId = a.Id);");

            // 2) Bu satışlardan doğan adisyonlar iptale çekilir — karşılığı kalmayan fiş ciroda durmasın.
            //    Cari bağı da koparılır; birazdan silinecek satıra referans kalmasın.
            migrationBuilder.Sql(@"
                UPDATE adisyonlar ad
                JOIN customer_accounts a ON a.Id = ad.CustomerAccountId
                SET ad.Status = 'Cancelled', ad.CustomerAccountId = NULL, ad.UpdatedAtUtc = UTC_TIMESTAMP()
                WHERE a.CancelledAtUtc IS NOT NULL AND a.IsDeleted = 0;");

            // 3) Canlı satırları sil. Sıra ÖNEMLİ: önce çocuklar, en sonda cari.
            migrationBuilder.Sql(@"
                DELETE s FROM customer_package_sessions s
                JOIN customer_accounts a ON a.Id = s.CustomerAccountId
                WHERE a.CancelledAtUtc IS NOT NULL AND a.IsDeleted = 0;");
            migrationBuilder.Sql(@"
                DELETE p FROM account_payments p
                JOIN customer_accounts a ON a.Id = p.CustomerAccountId
                WHERE a.CancelledAtUtc IS NOT NULL AND a.IsDeleted = 0;");
            migrationBuilder.Sql(@"
                DELETE i FROM account_installments i
                JOIN customer_accounts a ON a.Id = i.CustomerAccountId
                WHERE a.CancelledAtUtc IS NOT NULL AND a.IsDeleted = 0;");
            migrationBuilder.Sql(@"
                DELETE FROM customer_accounts
                WHERE CancelledAtUtc IS NOT NULL AND IsDeleted = 0;");
        }

        /// <summary>
        /// BU MIGRATION GERİ ALINAMAZ ve sessizce geçilmez.
        /// <para>
        /// Up() canlı satırları GERÇEKTEN sildi; tek kopyaları <c>cancelled_sales.Snapshot</c>
        /// içinde. Down boş bırakılırsa downgrade sorunsuz görünür, ardından bir önceki migration
        /// arşiv tablosunu düşürür ve iptal edilmiş TÜM satışlar geri dönülemez biçimde kaybolur.
        /// Bu yüzden burada yüksek sesle hata verilir: geri dönmek isteyen önce yedekten dönmeli.
        /// </para>
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder) =>
            throw new InvalidOperationException(
                "MigrateCancelledSalesToArchive geri alınamaz: iptal edilmiş satışların canlı satırları " +
                "silindi ve tek kopyaları cancelled_sales arşivindedir. Downgrade, bir sonraki adımda " +
                "arşiv tablosu düşürüldüğünde kalıcı veri kaybına yol açar. Geri dönmek için veritabanı " +
                "yedeğinden restore edin.");
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// İki iş yapar:
    /// <list type="number">
    ///   <item>
    ///     <c>archived_sale_payments</c> tablosunu kurar — iptal edilen satışın tahsilatlarının
    ///     kalıcı defteri. Cari silinince <c>account_payments</c> cascade ile gidiyor, geçmişte
    ///     kasaya giren para gelir raporlarından yok oluyordu; üstüne iade gider yazılınca net kasa
    ///     EKSİYE düşüyordu.
    ///   </item>
    ///   <item>
    ///     <c>refund_transactions</c> tablosu eklenmeden ÖNCE yapılmış iadeleri geriye dönük yazar.
    ///     Tablo oluşturulmuştu ama mevcut <c>cancelled_sales.RefundedAmount</c> kayıtları
    ///     taşınmamıştı: gerçekten ödenmiş iadeler yeni kasa/rapor hesabında hiç görünmüyordu.
    ///   </item>
    /// </list>
    /// <para>
    /// Mevcut arşivlerin tahsilat satırları burada üretilemez: yedek (Snapshot) şifreli olduğundan
    /// SQL ile okunamaz. Onu uygulama açılışındaki idempotent backfill yapar
    /// (<c>DatabaseBootstrap.BackfillArchivedSalePaymentsAsync</c>).
    /// </para>
    /// </summary>
    public partial class ArchivedSalePayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "archived_sale_payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CancelledSaleId = table.Column<Guid>(type: "char(36)", nullable: false),
                    OriginalAccountId = table.Column<Guid>(type: "char(36)", nullable: false),
                    OriginalPaymentId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    AccountName = table.Column<string>(type: "longtext", nullable: true),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Method = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    Reference = table.Column<string>(type: "longtext", nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archived_sale_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_archived_sale_payments_customers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_archived_sale_payments_CancelledSaleId",
                table: "archived_sale_payments",
                column: "CancelledSaleId");

            migrationBuilder.CreateIndex(
                name: "IX_archived_sale_payments_CustomerId",
                table: "archived_sale_payments",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_archived_sale_payments_OriginalAccountId",
                table: "archived_sale_payments",
                column: "OriginalAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_archived_sale_payments_TenantId_OccurredAtUtc",
                table: "archived_sale_payments",
                columns: new[] { "TenantId", "OccurredAtUtc" });

            // ---------------------------------------------------------------------------------
            // GERİYE DÖNÜK İADELER
            // refund_transactions tablosu 20260731135553 ile eklendi ama BOŞ bırakıldı; o tarihten
            // önce iptal edilip parası iade edilmiş satışlar yeni kasa/rapor hesabına hiç girmedi.
            //
            // İdempotent: aynı arşive ait AKTİF bir iade satırı varsa atlanır → migration yeniden
            // çalışsa da (ya da elle uygulansa da) mükerrer kayıt oluşmaz.
            //
            // Yöntem bilinmiyor: 'cash' YAZILMAZ. Eski kayıtta ödeme şekli hiç sorulmamıştı; nakit
            // varsaymak kasa kırılımını uydurma veriyle doldururdu → 'unknown'.
            //
            // Gerekçe metni (CancellationReason) ŞİFRELİ kolondan şifreli kolona kopyalanır: şifreleme
            // kolon/tabloya bağlı değil (AES-GCM, AAD yok), aynı anahtarla çözülür. Düz metne çevirip
            // yazmak veriyi açığa çıkarırdı.
            //
            // Tarih: iadenin ne zaman yapıldığı ayrıca tutulmuyordu → iptal anı kullanılır.
            // ---------------------------------------------------------------------------------
            migrationBuilder.Sql("""
                INSERT INTO `refund_transactions`
                    (`Id`, `TenantId`, `BranchId`, `CancelledSaleId`, `CustomerId`, `Amount`, `Method`,
                     `Reference`, `RefundedAtUtc`, `RefundedByUserId`, `Reason`,
                     `CreatedAtUtc`, `UpdatedAtUtc`, `DeletedAtUtc`, `CreatedBy`, `UpdatedBy`, `IsDeleted`)
                SELECT
                    UUID(), c.`TenantId`, c.`BranchId`, c.`Id`, c.`CustomerId`, c.`RefundedAmount`, 'unknown',
                    NULL, c.`CancelledAtUtc`, NULL, c.`CancellationReason`,
                    UTC_TIMESTAMP(6), NULL, NULL, NULL, NULL, 0
                FROM `cancelled_sales` c
                LEFT JOIN `refund_transactions` r
                       ON r.`CancelledSaleId` = c.`Id` AND r.`IsDeleted` = 0
                WHERE c.`IsDeleted` = 0
                  AND c.`RestoredAtUtc` IS NULL
                  AND c.`RefundedAmount` > 0
                  AND r.`Id` IS NULL;
                """);
        }

        /// <summary>
        /// Tabloyu düşürür. Backfill edilen iade satırları GERİ ALINMAZ: bu migration'dan sonra elle
        /// girilmiş gerçek iadelerle ayırt edilemezler ve silinmeleri veri kaybı olurdu.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "archived_sale_payments");
        }
    }
}

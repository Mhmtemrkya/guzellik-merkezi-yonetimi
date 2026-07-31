using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Satış iptali/geri alma sertleştirmesi — üç yapısal düzeltme:
    /// <list type="number">
    ///   <item>
    ///     <c>customer_accounts.RefundedAmount</c>: iptal geri alınırken KORUNAN iade. Tahsilatlar
    ///     aynen geri kurulduğu için cari "ödendi" görünüyor ve satış tekrar iptal edilirse AYNI para
    ///     bir daha iade edilebiliyordu (1.000 tahsilata karşı 2.000 iade).
    ///   </item>
    ///   <item>
    ///     <c>package_session_usages</c>: adisyon kaleminin HANGİ paket seansından kaç adet
    ///     tükettiğinin kalıcı bağı. İptal ters kaydı "aynı hizmetin en son kullanılan seansı"
    ///     tahminiyle çalışıyor, aynı hizmeti içeren ikinci bir pakete yanlış kredi yazabiliyordu.
    ///   </item>
    ///   <item>
    ///     <c>archived_sale_payments</c> üzerinde (CancelledSaleId, OriginalPaymentId) UNIQUE:
    ///     açılıştaki backfill "eksikse ekle" mantığıyla çalışıyor; iki backend aynı anda açılırsa
    ///     aynı tahsilat iki kez yazılıp gelir çift sayılabilirdi.
    ///   </item>
    /// </list>
    /// <para>
    /// Mevcut peşinatların gerçek tahsilat hareketine taşınması burada YAPILMAZ: <c>Reference</c>
    /// kolonu şifreli olduğu için mükerrer kontrolü SQL'de yapılamaz →
    /// <c>DatabaseBootstrap.BackfillDepositPaymentsAsync</c> açılışta (idempotent) hallediyor.
    /// </para>
    /// </summary>
    public partial class SaleCancellationHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "RefundedAmount",
                table: "customer_accounts",
                type: "decimal(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "package_session_usages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    AdisyonId = table.Column<Guid>(type: "char(36)", nullable: false),
                    AdisyonItemId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CustomerPackageSessionId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CustomerId = table.Column<Guid>(type: "char(36)", nullable: false),
                    ServiceDefinitionId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    ConsumedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_package_session_usages", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_archived_sale_payments_CancelledSaleId_OriginalPaymentId",
                table: "archived_sale_payments",
                columns: new[] { "CancelledSaleId", "OriginalPaymentId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_package_session_usages_CustomerPackageSessionId",
                table: "package_session_usages",
                column: "CustomerPackageSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_package_session_usages_TenantId_AdisyonId",
                table: "package_session_usages",
                columns: new[] { "TenantId", "AdisyonId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "package_session_usages");

            migrationBuilder.DropIndex(
                name: "IX_archived_sale_payments_CancelledSaleId_OriginalPaymentId",
                table: "archived_sale_payments");

            migrationBuilder.DropColumn(
                name: "RefundedAmount",
                table: "customer_accounts");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// TEK PAKET (13 Kas 2026) — satıştaki paket yalnız "BeautyAsist" (şube başı 1.000 / yıllık 10.000 TL + KDV,
    /// müşteri / imzalı onam kademeli). Şema değişmez; yalnız veri:
    /// <list type="number">
    /// <item>Tek paket yoksa eklenir (canlıda plan seed'i opt-in — migration kendisi garanti eder); silinmiş /
    /// pasifse canlandırılır.</item>
    /// <item>Diğer paketlere bağlı (ya da paketsiz) kurumlar tek pakete taşınır. Eski bağ YEDEK tabloya yazılır.</item>
    /// <item>Diğer paketler YUMUŞAK silinir (satır kalır: geçmiş ödeme / fatura bağları ve PlanKey benzersizliği korunur).</item>
    /// </list>
    /// <para>
    /// FİYAT ETKİSİ: taşınan kurumun yürüyen dönemi değişmez; BİR SONRAKİ yenilemesi tek paketin fiyatıyla
    /// (şube × birim + kademeler + KDV) yapılır.
    /// </para>
    /// <para>
    /// GERİ ALMA (Down): yedekten kurumların eski paket bağları ve silinen paketler geri yüklenir, yedek tablo
    /// kaldırılır. Yedek tablo karşılaştırmaları açık <c>COLLATE</c> taşır: canlı tablo collation'ı farklı olsa da
    /// "Illegal mix of collations" alınmaz.
    /// </para>
    /// </summary>
    public partial class SingleSubscriptionPlan : Migration
    {
        private const string Backup = "plan_consolidation_backup_20261113";

        /// <summary>Tek paketin özellikleri: migration anındaki tam katalog (sonradan eklenen özellik paneldan eklenir).</summary>
        private const string AllFeatures =
            "excel.customers,excel.appointments,excel.services,excel.staff,excel.branches,excel.reports,pdf.reports,pdf.credentials," +
            "reports.finance,reports.customer,reports.staff,reports.services,notifications.sms,notifications.whatsapp,notifications.email," +
            "notifications.bulk,notifications.templates,notifications.automation,accounting.installments,accounting.payments,billing.adisyon," +
            "stock.products,stock.movements,categories.expense.custom,categories.service.custom,audit.logs,clinical.consultation," +
            "clinical.beforeafter,clinical.customfields,clinical.consentforms,customers.blacklist,customers.passive,staff.commission," +
            "staff.schedule,marketing.campaigns,loyalty.points,marketing.giftcards,finance.cashclosing,appointments.waitlist," +
            "appointments.onlinebooking,staff.permissions,approval.workflow,multiBranch,api.access,ai.insights,security.devicecontrol";

        private const string Tiers =
            "[{\"above\":10000,\"monthlyFee\":250},{\"above\":15000,\"monthlyFee\":500},{\"above\":20000,\"monthlyFee\":1000}]";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) Tek paket: yoksa ekle, varsa canlı ve satışta tut.
            migrationBuilder.Sql($@"
INSERT INTO subscription_plans
  (Id, PlanKey, Name, Description, MonthlyPriceTRY, YearlyPriceTRY,
   MaxBranches, MaxStaff, MaxCustomers, MaxMonthlyAppointments,
   MaxMonthlySmsCount, MaxMonthlyWhatsAppCount, MaxMonthlyEmailCount,
   MaxMonthlyWhatsAppMarketing, MaxMonthlyWhatsAppUtility, DefaultWhatsAppSpendCapTry, DefaultSpendCapCredits,
   Features, DisplayOrder, IsActive, ChargePerBranch, CustomerTiersJson, ConsentTiersJson, YearlyTierMultiplier,
   CreatedAtUtc, IsDeleted)
SELECT UUID(), 'BeautyAsist', 'BeautyAsist', 'Tüm özellikler dahil · şube başına ücretlendirme', 1000.00, 10000.00,
   -1, -1, -1, -1,
   2500, 1500, 10000,
   0, 1500, 0.00, 0.00,
   '{AllFeatures}', 0, 1, 1, '{Tiers}', '{Tiers}', 10.00,
   UTC_TIMESTAMP(6), 0
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE PlanKey = 'BeautyAsist');");

            migrationBuilder.Sql(@"
UPDATE subscription_plans
SET IsDeleted = 0, DeletedAtUtc = NULL, IsActive = 1
WHERE PlanKey = 'BeautyAsist' AND (IsDeleted = 1 OR IsActive = 0);");

            // 2) Yedek: kurumların eski bağı + kaldırılacak paketlerin eski durumu (Down bunlardan geri yükler).
            migrationBuilder.Sql($@"
CREATE TABLE IF NOT EXISTS `{Backup}` (
  `Kind` varchar(10) NOT NULL,
  `EntityId` char(36) NOT NULL,
  `OldPlanId` char(36) NULL,
  `OldPlan` varchar(80) NULL,
  `OldIsActive` tinyint(1) NULL,
  `CreatedAtUtc` datetime(6) NOT NULL,
  PRIMARY KEY (`Kind`, `EntityId`)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");

            migrationBuilder.Sql($@"
INSERT IGNORE INTO `{Backup}` (Kind, EntityId, OldPlanId, OldPlan, OldIsActive, CreatedAtUtc)
SELECT 'tenant', t.Id, t.SubscriptionPlanId, t.Plan, NULL, UTC_TIMESTAMP(6)
FROM tenants t
JOIN subscription_plans s ON s.PlanKey = 'BeautyAsist'
WHERE t.SubscriptionPlanId IS NULL OR t.SubscriptionPlanId <> s.Id;");

            migrationBuilder.Sql($@"
INSERT IGNORE INTO `{Backup}` (Kind, EntityId, OldPlanId, OldPlan, OldIsActive, CreatedAtUtc)
SELECT 'plan', p.Id, NULL, NULL, p.IsActive, UTC_TIMESTAMP(6)
FROM subscription_plans p
WHERE p.PlanKey <> 'BeautyAsist' AND p.IsDeleted = 0;");

            // 3) Kurumları tek pakete taşı.
            migrationBuilder.Sql(@"
UPDATE tenants t
JOIN subscription_plans s ON s.PlanKey = 'BeautyAsist'
SET t.SubscriptionPlanId = s.Id, t.Plan = s.Name
WHERE t.SubscriptionPlanId IS NULL OR t.SubscriptionPlanId <> s.Id;");

            // 4) Diğer paketleri kaldır (yumuşak silme).
            migrationBuilder.Sql(@"
UPDATE subscription_plans
SET IsDeleted = 1, IsActive = 0, DeletedAtUtc = UTC_TIMESTAMP(6)
WHERE PlanKey <> 'BeautyAsist' AND IsDeleted = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql($@"
UPDATE subscription_plans p
JOIN `{Backup}` b ON b.Kind = 'plan' AND b.EntityId COLLATE utf8mb4_unicode_ci = p.Id
SET p.IsDeleted = 0, p.DeletedAtUtc = NULL, p.IsActive = COALESCE(b.OldIsActive, 1);");

            migrationBuilder.Sql($@"
UPDATE tenants t
JOIN `{Backup}` b ON b.Kind = 'tenant' AND b.EntityId COLLATE utf8mb4_unicode_ci = t.Id
SET t.SubscriptionPlanId = b.OldPlanId, t.Plan = COALESCE(b.OldPlan, t.Plan);");

            migrationBuilder.Sql($"DROP TABLE IF EXISTS `{Backup}`;");
        }
    }
}

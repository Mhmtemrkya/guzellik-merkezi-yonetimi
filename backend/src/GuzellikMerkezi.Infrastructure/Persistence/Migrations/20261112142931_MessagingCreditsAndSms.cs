using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MessagingCreditsAndSms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "ReservedAfterTry",
                table: "wallet_transactions",
                newName: "ReservedAfter");

            migrationBuilder.RenameColumn(
                name: "BalanceAfterTry",
                table: "wallet_transactions",
                newName: "BalanceAfter");

            migrationBuilder.RenameColumn(
                name: "AmountTry",
                table: "wallet_transactions",
                newName: "Amount");

            migrationBuilder.AddColumn<string>(
                name: "KvkkChannel",
                table: "whatsapp_settings",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "WhatsApp");

            migrationBuilder.AddColumn<decimal>(
                name: "MonthlySpendCapCredits",
                table: "whatsapp_settings",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RatingLinkChannel",
                table: "whatsapp_settings",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "WhatsApp");

            migrationBuilder.AddColumn<string>(
                name: "WaitlistActivatedChannel",
                table: "whatsapp_settings",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "WhatsApp");

            migrationBuilder.AddColumn<decimal>(
                name: "CreditCost",
                table: "whatsapp_pricing_rules",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ChargedCredits",
                table: "whatsapp_messages",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "GrantsCredits",
                table: "whatsapp_credit_purchases",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "GrantsCredits",
                table: "whatsapp_credit_packages",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "CreditUnitPriceTry",
                table: "whatsapp_billing_settings",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "DefaultMonthlySpendCapCredits",
                table: "whatsapp_billing_settings",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "LowBalanceThresholdCredits",
                table: "whatsapp_billing_settings",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "SmsCreditsPerPart",
                table: "whatsapp_billing_settings",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "Channel",
                table: "wallet_transactions",
                type: "varchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "NotificationLogId",
                table: "wallet_transactions",
                type: "char(36)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "wallet_transactions",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Try");

            migrationBuilder.AddColumn<decimal>(
                name: "BalanceCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "LifetimeSpentCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "LifetimeTopUpCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ReservedCredits",
                table: "tenant_messaging_wallets",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "DefaultSpendCapCredits",
                table: "subscription_plans",
                type: "decimal(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "BillingSource",
                table: "notification_logs",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<DateTime>(
                name: "ChargeCapturedAtUtc",
                table: "notification_logs",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ChargedCredits",
                table: "notification_logs",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "Purpose",
                table: "notification_logs",
                type: "varchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SmsParts",
                table: "notification_logs",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_notification_logs_BillingSource_ChargeCapturedAtUtc",
                table: "notification_logs",
                columns: new[] { "BillingSource", "ChargeCapturedAtUtc" });

            // ================================================================================
            // ₺ KONTÖR → MESAJ KREDİSİ DÖNÜŞÜMÜ (tek seferlik, 12 Kas 2026)
            //
            // Kural: 1 kredi = 1 WhatsApp hatırlatma (Utility). Kur P, CANLIDA o an geçerli Utility
            // ₺ satış fiyatıdır (seed sabiti DEĞİL); kural yoksa 0,15. Her ₺ değer P'ye bölünür;
            // bakiye/hak dönüşümünde yukarı yuvarlanır (kesir kurumun lehine).
            //
            // Para kaydında ₺ kolonlarına DOKUNULMAZ — donmuş geçmiş olarak kalır. Defterin eski
            // satırları 'Try' birimiyle olduğu gibi kalır; her cüzdana bir 'Conversion' satırı eklenir.
            //
            // SIRA ÖNEMLİ: mesajların kredi karşılığı, cüzdan rezervinden ÖNCE hesaplanır — askıdaki
            // rezervasyon, bu mesajların sonradan kesinleşecek/iade edilecek kredilerinin toplamıdır.
            // Ayrı yuvarlanmış bir ReservedTry/P kullanılsaydı rezerv ile mesajlar birbirini tutmaz,
            // kesinleşme/iade rezervi sıfırın altına ya da üstüne kaydırırdı.
            //
            // MySql.Data oturum değişkenini (@p) parametre sanar; kur bu yüzden her ifadede alt
            // sorgu olarak hesaplanır. LIMIT'li türetilmiş tablo, aynı tabloyu güncelleyen ifadede
            // (fiyat kuralları) "target table in FROM" hatasını önler.
            // ================================================================================
            const string rate =
                "COALESCE((SELECT r.SellPriceTry FROM (SELECT SellPriceTry FROM whatsapp_pricing_rules " +
                "WHERE IsDeleted = 0 AND IsActive = 1 AND Category = 'Utility' AND SellPriceTry > 0 " +
                "AND EffectiveFromUtc <= UTC_TIMESTAMP(6) ORDER BY EffectiveFromUtc DESC LIMIT 1) AS r), 0.15)";

            // 1) Mesajların ücreti (aylık tavan sayımı + askıdaki rezervasyonların karşılığı).
            migrationBuilder.Sql(
                $"UPDATE whatsapp_messages SET ChargedCredits = ROUND(ChargedAmountTry / {rate}, 4) " +
                "WHERE ChargedAmountTry > 0;");

            // 2) Satın alma talepleri — bekleyen talep onaylanınca bu kredi yüklenir.
            migrationBuilder.Sql(
                $"UPDATE whatsapp_credit_purchases SET GrantsCredits = CEIL(GrantsTry / {rate}) WHERE GrantsTry > 0;");

            // 3) Paketler (katalog) + ad: "Kontör" → "Kredi".
            migrationBuilder.Sql(
                $"UPDATE whatsapp_credit_packages SET GrantsCredits = CEIL(GrantsTry / {rate}) WHERE GrantsTry > 0;");
            migrationBuilder.Sql(
                "UPDATE whatsapp_credit_packages SET Name = REPLACE(REPLACE(Name, 'Kontör', 'Kredi'), 'kontör', 'kredi') " +
                "WHERE Name LIKE '%ontör%';");

            // 4) WhatsApp kategori maliyetleri: ₺ fiyat / P, tam krediye yuvarlanır (ücretli
            //    kategori en az 1 kredi; ücretsiz kategori 0 kalır).
            migrationBuilder.Sql(
                $"UPDATE whatsapp_pricing_rules SET CreditCost = CASE WHEN SellPriceTry <= 0 THEN 0 " +
                $"ELSE GREATEST(1, ROUND(SellPriceTry / {rate}, 0)) END;");

            // 5) Cüzdanlar: rezerv = askıdaki mesajların kredisi; bakiye = kullanılabilir ₺'nin
            //    kredisi (yukarı yuvarlı) + rezerv.
            //    Hedef tabloya TAKMA AD VERİLMEZ: canlı MariaDB "UPDATE t AS x" biçimini reddediyor
            //    (bkz. BackgroundJobMaintenance); ilişki tablo adıyla kurulur.
            migrationBuilder.Sql(
                "UPDATE tenant_messaging_wallets SET ReservedCredits = (" +
                "SELECT COALESCE(SUM(m.ChargedCredits), 0) FROM whatsapp_messages m " +
                "WHERE m.TenantId = tenant_messaging_wallets.TenantId AND m.IsDeleted = 0 AND m.BillingSource = 'Wallet' " +
                "AND m.ChargedCredits > 0 AND m.DeliveredAtUtc IS NULL AND m.Status <> 'Failed');");
            migrationBuilder.Sql(
                $"UPDATE tenant_messaging_wallets SET " +
                $"BalanceCredits = CEIL(GREATEST(BalanceTry - ReservedTry, 0) / {rate}) + ReservedCredits, " +
                $"LifetimeTopUpCredits = ROUND(LifetimeTopUpTry / {rate}, 2), " +
                $"LifetimeSpentCredits = ROUND(LifetimeSpentTry / {rate}, 2);");

            // 6) Denetim izi: dönüşüm her cüzdanın defterine tek satır olarak yazılır.
            migrationBuilder.Sql(
                "INSERT INTO wallet_transactions (Id, TenantId, Type, Unit, Amount, BalanceAfter, ReservedAfter, " +
                "Description, Category, WhatsAppMessageId, CreditPackageId, PerformedByUserId, Channel, NotificationLogId, " +
                "CreatedAtUtc, UpdatedAtUtc, DeletedAtUtc, CreatedBy, UpdatedBy, IsDeleted) " +
                "SELECT UUID(), w.TenantId, 'Conversion', 'Credit', w.BalanceCredits, w.BalanceCredits, w.ReservedCredits, " +
                $"CONCAT('Kontör → kredi dönüşümü: ₺', FORMAT(w.BalanceTry, 2, 'tr_TR'), ' bakiye (1 kredi = ₺', FORMAT({rate}, 4, 'tr_TR'), ')'), " +
                "NULL, NULL, NULL, NULL, NULL, NULL, UTC_TIMESTAMP(6), NULL, NULL, NULL, NULL, 0 " +
                "FROM tenant_messaging_wallets w WHERE w.IsDeleted = 0 AND (w.BalanceTry > 0 OR w.ReservedTry > 0);");

            // 7) Platform ayarları: eşik/tavan krediye; SMS parça maliyeti 2 kredi; kredi birim
            //    fiyatı = P (paket dışı alım bu fiyattan).
            migrationBuilder.Sql(
                $"UPDATE whatsapp_billing_settings SET " +
                $"LowBalanceThresholdCredits = CEIL(LowBalanceThresholdTry / {rate}), " +
                $"DefaultMonthlySpendCapCredits = CASE WHEN DefaultMonthlySpendCapTry IS NULL THEN NULL " +
                $"ELSE CEIL(DefaultMonthlySpendCapTry / {rate}) END, " +
                $"SmsCreditsPerPart = 2, " +
                $"CreditUnitPriceTry = {rate};");

            // 8) Kurum ve paket tavanları.
            migrationBuilder.Sql(
                $"UPDATE whatsapp_settings SET MonthlySpendCapCredits = CEIL(MonthlySpendCapTry / {rate}) " +
                "WHERE MonthlySpendCapTry IS NOT NULL;");
            migrationBuilder.Sql(
                $"UPDATE subscription_plans SET DefaultSpendCapCredits = CEIL(DefaultWhatsAppSpendCapTry / {rate}) " +
                "WHERE DefaultWhatsAppSpendCapTry > 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // YALNIZ ŞEMA GERİ ALINIR. Dönüşüm sonrası kredi hareketleri (yükleme/harcama) ₺'ye
            // otomatik ÇEVRİLMEZ: eski ₺ kolonları dönüşüm anındaki değerleri taşır. 'Credit'
            // birimli defter satırları Unit kolonu düşünce ₺ gibi okunur — geri alma yapılırsa
            // bu satırlar ve cüzdan bakiyeleri ELLE mutabık kılınmalıdır.
            migrationBuilder.DropIndex(
                name: "IX_notification_logs_BillingSource_ChargeCapturedAtUtc",
                table: "notification_logs");

            migrationBuilder.DropColumn(
                name: "KvkkChannel",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "MonthlySpendCapCredits",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "RatingLinkChannel",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "WaitlistActivatedChannel",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "CreditCost",
                table: "whatsapp_pricing_rules");

            migrationBuilder.DropColumn(
                name: "ChargedCredits",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "GrantsCredits",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropColumn(
                name: "GrantsCredits",
                table: "whatsapp_credit_packages");

            migrationBuilder.DropColumn(
                name: "CreditUnitPriceTry",
                table: "whatsapp_billing_settings");

            migrationBuilder.DropColumn(
                name: "DefaultMonthlySpendCapCredits",
                table: "whatsapp_billing_settings");

            migrationBuilder.DropColumn(
                name: "LowBalanceThresholdCredits",
                table: "whatsapp_billing_settings");

            migrationBuilder.DropColumn(
                name: "SmsCreditsPerPart",
                table: "whatsapp_billing_settings");

            migrationBuilder.DropColumn(
                name: "Channel",
                table: "wallet_transactions");

            migrationBuilder.DropColumn(
                name: "NotificationLogId",
                table: "wallet_transactions");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "wallet_transactions");

            migrationBuilder.DropColumn(
                name: "BalanceCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "LifetimeSpentCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "LifetimeTopUpCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "ReservedCredits",
                table: "tenant_messaging_wallets");

            migrationBuilder.DropColumn(
                name: "DefaultSpendCapCredits",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "BillingSource",
                table: "notification_logs");

            migrationBuilder.DropColumn(
                name: "ChargeCapturedAtUtc",
                table: "notification_logs");

            migrationBuilder.DropColumn(
                name: "ChargedCredits",
                table: "notification_logs");

            migrationBuilder.DropColumn(
                name: "Purpose",
                table: "notification_logs");

            migrationBuilder.DropColumn(
                name: "SmsParts",
                table: "notification_logs");

            migrationBuilder.RenameColumn(
                name: "ReservedAfter",
                table: "wallet_transactions",
                newName: "ReservedAfterTry");

            migrationBuilder.RenameColumn(
                name: "BalanceAfter",
                table: "wallet_transactions",
                newName: "BalanceAfterTry");

            migrationBuilder.RenameColumn(
                name: "Amount",
                table: "wallet_transactions",
                newName: "AmountTry");
        }
    }
}

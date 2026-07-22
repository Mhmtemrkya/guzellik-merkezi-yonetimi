using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWhatsAppBillingAndConnection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllowWalletOverage",
                table: "whatsapp_settings",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ConnectionStatus",
                table: "whatsapp_settings",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "NotConnected");

            migrationBuilder.AddColumn<string>(
                name: "DisplayPhoneNumber",
                table: "whatsapp_settings",
                type: "varchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "MarketingEnabled",
                table: "whatsapp_settings",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "MonthlySpendCapTry",
                table: "whatsapp_settings",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BillingSource",
                table: "whatsapp_messages",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "whatsapp_messages",
                type: "varchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Utility");

            migrationBuilder.AddColumn<decimal>(
                name: "ChargedAmountTry",
                table: "whatsapp_messages",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeliveredAtUtc",
                table: "whatsapp_messages",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DefaultWhatsAppSpendCapTry",
                table: "subscription_plans",
                type: "decimal(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "MaxMonthlyWhatsAppMarketing",
                table: "subscription_plans",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxMonthlyWhatsAppUtility",
                table: "subscription_plans",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AlterColumn<string>(
                name: "WhatsAppPhoneNumberId",
                table: "platform_integration_settings",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "longtext",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "WhatsAppBusinessAccountId",
                table: "platform_integration_settings",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "longtext",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "WhatsAppAccessTokenEncrypted",
                table: "platform_integration_settings",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "longtext",
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhatsAppAppSecretEncrypted",
                table: "platform_integration_settings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhatsAppVerifyToken",
                table: "platform_integration_settings",
                type: "varchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "tenant_messaging_wallets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BalanceTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    ReservedTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    LifetimeTopUpTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    LifetimeSpentTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_messaging_wallets", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "wallet_transactions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Type = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    AmountTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    BalanceAfterTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    ReservedAfterTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    Description = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    Category = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: true),
                    WhatsAppMessageId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CreditPackageId = table.Column<Guid>(type: "char(36)", nullable: true),
                    PerformedByUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_wallet_transactions", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "whatsapp_billing_settings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    BillingEnabled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    ChargeSimulated = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    UsdTryRate = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    LowBalanceThresholdTry = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    DefaultMonthlySpendCapTry = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    AutoApproveTopUps = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_whatsapp_billing_settings", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "whatsapp_credit_packages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    Name = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    PriceTry = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GrantsTry = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    DisplayOrder = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_whatsapp_credit_packages", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "whatsapp_credit_purchases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    CreditPackageId = table.Column<Guid>(type: "char(36)", nullable: true),
                    PackageName = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false),
                    PriceTry = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GrantsTry = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    ProcessedByUserId = table.Column<Guid>(type: "char(36)", nullable: true),
                    ProcessedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    Note = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_whatsapp_credit_purchases", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "whatsapp_pricing_rules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    Category = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    MetaUsdPrice = table.Column<decimal>(type: "decimal(18,6)", precision: 18, scale: 6, nullable: false),
                    SellPriceTry = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    EffectiveFromUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Note = table.Column<string>(type: "varchar(256)", maxLength: 256, nullable: true),
                    IsActive = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_whatsapp_pricing_rules", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_messages_ProviderMessageId",
                table: "whatsapp_messages",
                column: "ProviderMessageId");

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_messages_TenantId_Category_BillingSource_CreatedAtU~",
                table: "whatsapp_messages",
                columns: new[] { "TenantId", "Category", "BillingSource", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_tenant_messaging_wallets_TenantId",
                table: "tenant_messaging_wallets",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_wallet_transactions_TenantId_CreatedAtUtc",
                table: "wallet_transactions",
                columns: new[] { "TenantId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_credit_purchases_Status_CreatedAtUtc",
                table: "whatsapp_credit_purchases",
                columns: new[] { "Status", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_credit_purchases_TenantId_CreatedAtUtc",
                table: "whatsapp_credit_purchases",
                columns: new[] { "TenantId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_pricing_rules_Category_EffectiveFromUtc",
                table: "whatsapp_pricing_rules",
                columns: new[] { "Category", "EffectiveFromUtc" });

            // Veri taşıma: mevcut planların eski tek WhatsApp kotasını (MaxMonthlyWhatsAppCount) yeni Utility
            // kotasına kopyala. Aksi halde Utility 0 kalır ve faturalama açıkken mevcut kurumların hatırlatmaları
            // kotasız (engelli) olur.
            migrationBuilder.Sql(
                "UPDATE subscription_plans SET MaxMonthlyWhatsAppUtility = MaxMonthlyWhatsAppCount WHERE MaxMonthlyWhatsAppUtility = 0;");

            // KRİTİK: eski (per-tenant token'la CANLI çalışan) WhatsApp bağlantılarını yeni ConnectionStatus
            // modeline taşı. Aksi halde bu kurumlar NotConnected'a düşer ve canlı gönderim SESSİZCE simülasyona
            // dönerdi (mevcut müşterilerin hatırlatmaları durur). Prod'da elle uygulanan migration bunu garanti eder.
            migrationBuilder.Sql(
                "UPDATE whatsapp_settings SET ConnectionStatus = 'Connected' " +
                "WHERE Enabled = 1 AND PhoneNumberId IS NOT NULL AND AccessTokenEncrypted IS NOT NULL AND ConnectionStatus = 'NotConnected';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tenant_messaging_wallets");

            migrationBuilder.DropTable(
                name: "wallet_transactions");

            migrationBuilder.DropTable(
                name: "whatsapp_billing_settings");

            migrationBuilder.DropTable(
                name: "whatsapp_credit_packages");

            migrationBuilder.DropTable(
                name: "whatsapp_credit_purchases");

            migrationBuilder.DropTable(
                name: "whatsapp_pricing_rules");

            migrationBuilder.DropIndex(
                name: "IX_whatsapp_messages_ProviderMessageId",
                table: "whatsapp_messages");

            migrationBuilder.DropIndex(
                name: "IX_whatsapp_messages_TenantId_Category_BillingSource_CreatedAtU~",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "AllowWalletOverage",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "ConnectionStatus",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "DisplayPhoneNumber",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "MarketingEnabled",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "MonthlySpendCapTry",
                table: "whatsapp_settings");

            migrationBuilder.DropColumn(
                name: "BillingSource",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "ChargedAmountTry",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "DeliveredAtUtc",
                table: "whatsapp_messages");

            migrationBuilder.DropColumn(
                name: "DefaultWhatsAppSpendCapTry",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "MaxMonthlyWhatsAppMarketing",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "MaxMonthlyWhatsAppUtility",
                table: "subscription_plans");

            migrationBuilder.DropColumn(
                name: "WhatsAppAppSecretEncrypted",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "WhatsAppVerifyToken",
                table: "platform_integration_settings");

            migrationBuilder.AlterColumn<string>(
                name: "WhatsAppPhoneNumberId",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "varchar(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "WhatsAppBusinessAccountId",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "varchar(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "WhatsAppAccessTokenEncrypted",
                table: "platform_integration_settings",
                type: "longtext",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);
        }
    }
}

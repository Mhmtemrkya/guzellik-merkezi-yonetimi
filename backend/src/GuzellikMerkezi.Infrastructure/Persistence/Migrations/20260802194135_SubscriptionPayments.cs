using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SubscriptionPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PaymentReference",
                table: "tenant_invoices",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "VatRate",
                table: "tenant_invoices",
                type: "decimal(5,4)",
                precision: 5,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "IyzicoApiKeyEncrypted",
                table: "platform_integration_settings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IyzicoBaseUrl",
                table: "platform_integration_settings",
                type: "varchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IyzicoSecretKeyEncrypted",
                table: "platform_integration_settings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentProvider",
                table: "platform_integration_settings",
                type: "varchar(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "PaymentsEnabled",
                table: "platform_integration_settings",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "PaymentsReturnUrl",
                table: "platform_integration_settings",
                type: "varchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "subscription_payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantInvoiceId = table.Column<Guid>(type: "char(36)", nullable: true),
                    TenantPaymentMethodId = table.Column<Guid>(type: "char(36)", nullable: true),
                    SubscriptionPlanId = table.Column<Guid>(type: "char(36)", nullable: true),
                    Period = table.Column<int>(type: "int", nullable: false),
                    AmountTRY = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Provider = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    ConversationId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false),
                    ProviderPaymentId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    Status = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    AttemptNumber = table.Column<int>(type: "int", nullable: false),
                    ErrorCode = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    ErrorMessage = table.Column<string>(type: "varchar(512)", maxLength: 512, nullable: true),
                    CompletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_subscription_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_subscription_payments_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "tenant_payment_methods",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Provider = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    CardUserKeyEncrypted = table.Column<string>(type: "TEXT", nullable: false),
                    CardTokenEncrypted = table.Column<string>(type: "TEXT", nullable: false),
                    MaskedNumber = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: true),
                    Association = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: true),
                    Family = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: true),
                    BankName = table.Column<string>(type: "varchar(128)", maxLength: 128, nullable: true),
                    IsActive = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    LastChargedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    ConsecutiveFailureCount = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CreatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "char(36)", nullable: true),
                    IsDeleted = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_payment_methods", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tenant_payment_methods_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_subscription_payments_ConversationId",
                table: "subscription_payments",
                column: "ConversationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_subscription_payments_TenantId_CreatedAtUtc",
                table: "subscription_payments",
                columns: new[] { "TenantId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_tenant_payment_methods_TenantId_IsActive",
                table: "tenant_payment_methods",
                columns: new[] { "TenantId", "IsActive" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "subscription_payments");

            migrationBuilder.DropTable(
                name: "tenant_payment_methods");

            migrationBuilder.DropColumn(
                name: "PaymentReference",
                table: "tenant_invoices");

            migrationBuilder.DropColumn(
                name: "VatRate",
                table: "tenant_invoices");

            migrationBuilder.DropColumn(
                name: "IyzicoApiKeyEncrypted",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "IyzicoBaseUrl",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "IyzicoSecretKeyEncrypted",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "PaymentProvider",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "PaymentsEnabled",
                table: "platform_integration_settings");

            migrationBuilder.DropColumn(
                name: "PaymentsReturnUrl",
                table: "platform_integration_settings");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionPeriodAndYearlyPrice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SubscriptionEndsAtUtc",
                table: "tenants",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SubscriptionPeriod",
                table: "tenants",
                type: "varchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "YearlyPriceTRY",
                table: "subscription_plans",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            // Mevcut planlar için makul varsayılan: yıllık = aylık × 12 (platform admin sonradan düzenleyebilir).
            migrationBuilder.Sql("UPDATE subscription_plans SET YearlyPriceTRY = MonthlyPriceTRY * 12 WHERE YearlyPriceTRY = 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SubscriptionEndsAtUtc",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "SubscriptionPeriod",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "YearlyPriceTRY",
                table: "subscription_plans");
        }
    }
}

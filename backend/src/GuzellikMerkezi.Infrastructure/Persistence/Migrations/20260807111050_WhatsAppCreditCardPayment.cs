using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class WhatsAppCreditCardPayment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ConversationId",
                table: "whatsapp_credit_purchases",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaidAtUtc",
                table: "whatsapp_credit_purchases",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Provider",
                table: "whatsapp_credit_purchases",
                type: "varchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderPaymentId",
                table: "whatsapp_credit_purchases",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_credit_purchases_ConversationId",
                table: "whatsapp_credit_purchases",
                column: "ConversationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_whatsapp_credit_purchases_ProviderPaymentId",
                table: "whatsapp_credit_purchases",
                column: "ProviderPaymentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_whatsapp_credit_purchases_ConversationId",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropIndex(
                name: "IX_whatsapp_credit_purchases_ProviderPaymentId",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropColumn(
                name: "ConversationId",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropColumn(
                name: "PaidAtUtc",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropColumn(
                name: "Provider",
                table: "whatsapp_credit_purchases");

            migrationBuilder.DropColumn(
                name: "ProviderPaymentId",
                table: "whatsapp_credit_purchases");
        }
    }
}

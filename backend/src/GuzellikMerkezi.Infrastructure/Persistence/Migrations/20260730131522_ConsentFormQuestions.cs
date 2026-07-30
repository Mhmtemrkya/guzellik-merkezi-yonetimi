using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ConsentFormQuestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AnswersJson",
                table: "customer_consent_forms",
                type: "LONGTEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QuestionsJson",
                table: "customer_consent_forms",
                type: "LONGTEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QuestionsJson",
                table: "consent_form_templates",
                type: "LONGTEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnswersJson",
                table: "customer_consent_forms");

            migrationBuilder.DropColumn(
                name: "QuestionsJson",
                table: "customer_consent_forms");

            migrationBuilder.DropColumn(
                name: "QuestionsJson",
                table: "consent_form_templates");
        }
    }
}

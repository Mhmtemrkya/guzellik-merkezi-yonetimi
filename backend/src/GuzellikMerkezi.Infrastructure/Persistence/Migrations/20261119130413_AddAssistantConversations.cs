using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Maydi asistanı: sohbet ve mesaj tabloları + paket özelliği "ai.assistant".
    /// <para>
    /// VERİ: satıştaki tek paket ("BeautyAsist") tüm özellikleri içerir; yeni özellik bu pakete eklenir
    /// (FIND_IN_SET ile tekrar eklenmez, yeniden çalıştırılabilir). Yeni kurulumlar zaten FeatureCatalog.All'dan
    /// tohumlanır. Diğer (yumuşak silinmiş) paketlere dokunulmaz. Özellik önbelleği uygulama yeniden başlayınca tazelenir.
    /// </para>
    /// </summary>
    public partial class AddAssistantConversations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "assistant_conversations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    UserId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Portal = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    Title = table.Column<string>(type: "varchar(120)", maxLength: 120, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    LastMessageAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    IsArchived = table.Column<bool>(type: "tinyint(1)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assistant_conversations", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "assistant_messages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    TenantId = table.Column<Guid>(type: "char(36)", nullable: false),
                    BranchId = table.Column<Guid>(type: "char(36)", nullable: true),
                    ConversationId = table.Column<Guid>(type: "char(36)", nullable: false),
                    UserId = table.Column<Guid>(type: "char(36)", nullable: false),
                    Sender = table.Column<string>(type: "varchar(12)", maxLength: 12, nullable: false),
                    Text = table.Column<string>(type: "varchar(4000)", maxLength: 4000, nullable: false),
                    Intent = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false),
                    Outcome = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false),
                    MatchedBy = table.Column<string>(type: "varchar(16)", maxLength: 16, nullable: false),
                    ArticleId = table.Column<string>(type: "varchar(60)", maxLength: 60, nullable: true),
                    Kind = table.Column<string>(type: "varchar(20)", maxLength: 20, nullable: false),
                    PayloadJson = table.Column<string>(type: "longtext", nullable: false),
                    Feedback = table.Column<short>(type: "smallint", nullable: true),
                    ClientMessageId = table.Column<Guid>(type: "char(36)", nullable: true),
                    DurationMs = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assistant_messages", x => x.Id);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_assistant_conversations_TenantId_UserId_LastMessageAtUtc",
                table: "assistant_conversations",
                columns: new[] { "TenantId", "UserId", "LastMessageAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_assistant_messages_ConversationId_CreatedAtUtc",
                table: "assistant_messages",
                columns: new[] { "ConversationId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_assistant_messages_TenantId_Outcome_CreatedAtUtc",
                table: "assistant_messages",
                columns: new[] { "TenantId", "Outcome", "CreatedAtUtc" });

            migrationBuilder.Sql(@"
UPDATE subscription_plans
SET Features = CASE WHEN Features IS NULL OR Features = '' THEN 'ai.assistant' ELSE CONCAT(Features, ',ai.assistant') END
WHERE PlanKey = 'BeautyAsist' AND IsDeleted = 0 AND FIND_IN_SET('ai.assistant', COALESCE(Features, '')) = 0;");

            migrationBuilder.CreateIndex(
                name: "IX_assistant_messages_UserId_ClientMessageId",
                table: "assistant_messages",
                columns: new[] { "UserId", "ClientMessageId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
UPDATE subscription_plans
SET Features = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', Features, ','), ',ai.assistant,', ','))
WHERE PlanKey = 'BeautyAsist' AND FIND_IN_SET('ai.assistant', COALESCE(Features, '')) > 0;");

            migrationBuilder.DropTable(
                name: "assistant_conversations");

            migrationBuilder.DropTable(
                name: "assistant_messages");
        }
    }
}

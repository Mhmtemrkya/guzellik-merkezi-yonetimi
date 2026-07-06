using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Infrastructure.Persistence;

public static class DatabaseBootstrap
{
    /// <summary>
    /// MySQL kullanılıyorsa, connection string'de belirtilen database yoksa
    /// önce sunucuya database-less bağlanıp CREATE DATABASE IF NOT EXISTS çalıştırır.
    /// InMemory kullanılıyorsa hiçbir şey yapmaz.
    /// </summary>
    public static async Task EnsureDatabaseAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var builder = new MySqlConnectionStringBuilder(connectionString);
        var databaseName = builder.Database;
        if (string.IsNullOrWhiteSpace(databaseName)) return;

        // Sunucuya bağlanmak için database adını boşalt
        builder.Database = string.Empty;

        try
        {
            await using var connection = new MySqlConnection(builder.ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE IF NOT EXISTS `{databaseName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
            await command.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");
            logger.LogWarning(
                ex,
                "Database '{Database}' otomatik oluşturulamadı. MySQL sunucusunun çalıştığından ve connection string'in doğru olduğundan emin ol.",
                databaseName);
        }
    }

    /// <summary>
    /// EF Core migration'larını uygular. Daha önce EnsureCreated / SQL bootstrap ile kurulmuş
    /// mevcut bir veritabanı tespit edilirse (tablolar var ama migration geçmişi yok) ilk migration
    /// baseline olarak işaretlenir — şema yeniden oluşturulmaz, veri kaybolmaz. Sonraki tüm şema
    /// değişiklikleri yalnızca yeni migration'larla gelir (dotnet ef migrations add ...).
    /// </summary>
    public static async Task MigrateDatabaseAsync(GuzellikDbContext db, ILogger? logger = null)
    {
        if (db.Database.IsInMemory())
        {
            await db.Database.EnsureCreatedAsync();
            return;
        }

        var pending = (await db.Database.GetPendingMigrationsAsync()).OrderBy(x => x, StringComparer.Ordinal).ToArray();
        if (pending.Length == 0) return;

        var applied = (await db.Database.GetAppliedMigrationsAsync()).Any();
        var legacySchemaExists = !applied && await TableExistsAsync(db, "tenants");
        if (legacySchemaExists)
        {
            // Baseline: ilk migration mevcut şemayı temsil ediyor; çalıştırmadan geçmişe yaz.
            var initialMigration = pending[0];
            var productVersion = typeof(DbContext).Assembly.GetName().Version?.ToString(3) ?? "10.0.0";
            await db.Database.ExecuteSqlRawAsync(
                "CREATE TABLE IF NOT EXISTS `__EFMigrationsHistory` (" +
                "`MigrationId` VARCHAR(150) NOT NULL, `ProductVersion` VARCHAR(32) NOT NULL, " +
                "PRIMARY KEY (`MigrationId`)) CHARACTER SET utf8mb4;");
            await db.Database.ExecuteSqlAsync(
                $"INSERT IGNORE INTO `__EFMigrationsHistory` (`MigrationId`, `ProductVersion`) VALUES ({initialMigration}, {productVersion});");
            logger?.LogInformation("Mevcut veritabanı baseline alındı: {Migration} uygulanmış sayıldı.", initialMigration);
        }

        await db.Database.MigrateAsync();
    }

    private static async Task<bool> TableExistsAsync(GuzellikDbContext db, string tableName)
    {
        var conn = db.Database.GetDbConnection();
        var shouldClose = conn.State != System.Data.ConnectionState.Open;
        if (shouldClose) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t;";
            var p = cmd.CreateParameter();
            p.ParameterName = "@t";
            p.Value = tableName;
            cmd.Parameters.Add(p);
            var result = await cmd.ExecuteScalarAsync();
            return Convert.ToInt64(result) > 0;
        }
        finally
        {
            if (shouldClose) await conn.CloseAsync();
        }
    }

    /// <summary>
    /// Şema dışı referans verileri: eski kurulumlarda collation hizalama + varsayılan abonelik planları.
    /// Şema değişiklikleri artık burada DEĞİL, EF migration'larında yapılır.
    /// </summary>
    public static async Task EnsureReferenceDataAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");

        // Yeni feature tablolarının collation'ını çekirdek tablolarla (customers) HİZALA.
        // MySQL'de farklı collation'lı CHAR(36) kolonları JOIN'lemek "Illegal mix of collations"
        // hatası verir (adisyon/seans/prim/sadakat sorguları çekirdek tablolarla JOIN yapıyor).
        // Bu adım, tablo nasıl oluşturulmuş olursa olsun (bootstrap CREATE = utf8mb4_unicode_ci,
        // EnsureCreated = sunucu varsayılanı) tutarlılığı garanti eder. Idempotent + koşullu:
        // yalnızca collation'ı uyuşmayan tabloyu çevirir, gereksiz rebuild yapmaz.
        await AlignFeatureTableCollationsAsync(db, logger);

        await SeedSubscriptionPlansAsync(db, logger);
    }

    /// <summary>
    /// Yalnızca varsayılan abonelik planlarını ekler (key bazlı, idempotent). Collation/DDL veya demo verisi
    /// YAPMAZ. Her ortamda güvenle çağrılabilir; production'da opsiyonel (Database:SeedReferenceData=true) olarak
    /// kullanılır. Şema henüz yoksa hata loglanır ve sessizce geçilir.
    /// </summary>
    public static async Task EnsureDefaultSubscriptionPlansAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");
        await SeedSubscriptionPlansAsync(db, logger);
    }

    private static readonly string[] CollationSensitiveTables =
    {
        "customer_package_sessions", "adisyonlar", "adisyon_items",
        "staff_commissions", "staff_time_offs", "campaigns", "loyalty_transactions",
    };

    private static async Task AlignFeatureTableCollationsAsync(GuzellikDbContext db, ILogger logger)
    {
        try
        {
            // Referans: çekirdek 'customers' tablosunun collation'ı (JOIN'lerin diğer ucu).
            var reference = await GetTableCollationAsync(db, "customers");
            if (string.IsNullOrWhiteSpace(reference) || !IsSafeIdentifier(reference)) return;
            var charset = reference.Split('_')[0]; // utf8mb4_0900_ai_ci → utf8mb4
            if (!IsSafeIdentifier(charset)) return;

            foreach (var table in CollationSensitiveTables)
            {
                var current = await GetTableCollationAsync(db, table);
                if (current is null) continue; // tablo yoksa atla
                if (string.Equals(current, reference, StringComparison.OrdinalIgnoreCase)) continue; // zaten uyumlu

                try
                {
                    // reference/charset bilgisi information_schema'dan gelir (sistem değeri) ve IsSafeIdentifier ile
                    // doğrulanır; tablo adı sabit listeden gelir. DDL'de identifier/charset/collation parametre
                    // edilemediğinden interpolasyon zorunlu ve güvenlidir → EF1002 bilinçli olarak bastırılıyor.
#pragma warning disable EF1002
                    await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE `{table}` CONVERT TO CHARACTER SET {charset} COLLATE {reference};");
#pragma warning restore EF1002
                    logger.LogInformation("Collation hizalandı: {Table} → {Collation}", table, reference);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Collation hizalama hatası: {Table}", table);
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Collation hizalama taraması atlandı.");
        }
    }

    private static async Task<string?> GetTableCollationAsync(GuzellikDbContext db, string tableName)
    {
        var conn = db.Database.GetDbConnection();
        var shouldClose = conn.State != System.Data.ConnectionState.Open;
        if (shouldClose) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t LIMIT 1;";
            var p = cmd.CreateParameter();
            p.ParameterName = "@t";
            p.Value = tableName;
            cmd.Parameters.Add(p);
            var result = await cmd.ExecuteScalarAsync();
            return result as string;
        }
        finally
        {
            if (shouldClose) await conn.CloseAsync();
        }
    }

    private static bool IsSafeIdentifier(string value) =>
        System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9_]+$");

    private static async Task SeedSubscriptionPlansAsync(GuzellikDbContext db, ILogger logger)
    {
        // 5 default plan — sadece PlanKey yoksa eklenir, idempotent.
        // (Name LONGTEXT şifreli, ham SQL yok; EF üzerinden insert ediyoruz.)
        // Feature CSV'leri FeatureCatalog sabitlerini referans alır.

        var starter = string.Join(',', new[]
        {
            FeatureCatalog.ExcelCustomers,
            FeatureCatalog.NotificationsEmail,
            FeatureCatalog.NotificationsTemplates,
        });

        var pro = string.Join(',', new[]
        {
            FeatureCatalog.ExcelCustomers, FeatureCatalog.ExcelAppointments,
            FeatureCatalog.ExcelServices, FeatureCatalog.ExcelStaff,
            FeatureCatalog.PdfReports, FeatureCatalog.PdfCredentials,
            FeatureCatalog.ReportsFinance, FeatureCatalog.ReportsCustomer,
            FeatureCatalog.NotificationsEmail, FeatureCatalog.NotificationsSms,
            FeatureCatalog.NotificationsTemplates, FeatureCatalog.NotificationsAutomation,
            FeatureCatalog.AccountingInstallments, FeatureCatalog.AccountingPayments,
            FeatureCatalog.BillingAdisyon,
            FeatureCatalog.MultiBranch, FeatureCatalog.StaffPermissions,
            FeatureCatalog.StaffCommission, FeatureCatalog.StaffSchedule,
            FeatureCatalog.MarketingCampaigns, FeatureCatalog.LoyaltyPoints,
            FeatureCatalog.MarketingGiftCards, FeatureCatalog.FinanceCashClosing, FeatureCatalog.AppointmentsWaitlist,
            FeatureCatalog.AppointmentsOnlineBooking,
            FeatureCatalog.AuditLogs,
            FeatureCatalog.ClinicalConsultation, FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalCustomFields,
            FeatureCatalog.CustomersBlacklist, FeatureCatalog.CustomersPassive,
            FeatureCatalog.StockProducts,
        });

        var premium = string.Join(',', new[]
        {
            FeatureCatalog.ExcelCustomers, FeatureCatalog.ExcelAppointments,
            FeatureCatalog.ExcelServices, FeatureCatalog.ExcelStaff,
            FeatureCatalog.ExcelBranches, FeatureCatalog.ExcelReports,
            FeatureCatalog.PdfReports, FeatureCatalog.PdfCredentials,
            FeatureCatalog.ReportsFinance, FeatureCatalog.ReportsCustomer,
            FeatureCatalog.ReportsStaff, FeatureCatalog.ReportsServices,
            FeatureCatalog.NotificationsSms, FeatureCatalog.NotificationsWhatsApp,
            FeatureCatalog.NotificationsEmail, FeatureCatalog.NotificationsBulk,
            FeatureCatalog.NotificationsTemplates, FeatureCatalog.NotificationsAutomation,
            FeatureCatalog.AccountingInstallments, FeatureCatalog.AccountingPayments,
            FeatureCatalog.BillingAdisyon,
            FeatureCatalog.StockProducts, FeatureCatalog.StockMovements,
            FeatureCatalog.CategoriesExpenseCustom, FeatureCatalog.CategoriesServiceCustom,
            FeatureCatalog.AuditLogs,
            FeatureCatalog.StaffPermissions, FeatureCatalog.ApprovalWorkflow,
            FeatureCatalog.StaffCommission, FeatureCatalog.StaffSchedule,
            FeatureCatalog.MarketingCampaigns, FeatureCatalog.LoyaltyPoints,
            FeatureCatalog.MarketingGiftCards, FeatureCatalog.FinanceCashClosing, FeatureCatalog.AppointmentsWaitlist,
            FeatureCatalog.AppointmentsOnlineBooking,
            FeatureCatalog.ClinicalConsultation, FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalCustomFields,
            FeatureCatalog.CustomersBlacklist, FeatureCatalog.CustomersPassive,
            FeatureCatalog.MultiBranch,
            FeatureCatalog.SecurityDeviceControl,
        });

        var aiKlinik = string.Join(',', new[]
        {
            premium, FeatureCatalog.ApiAccess, FeatureCatalog.AiInsights,
        });

        var enterprise = string.Join(',', FeatureCatalog.All.Select(f => f.Key));

        var defaults = new (string Key, string Name, string Desc, decimal Price, int Branches, int Staff, int Customers, int Appts, int Sms, int WhatsApp, int Email, string Features, int Order)[]
        {
            ("Starter",   "Başlangıç",   "Tek şube, küçük ekipler için temel plan",
                599m,  1, 3, 300, 200, 0, 0, 300,
                starter, 1),
            ("Pro",       "Profesyonel", "Çok şubeli işletmeler için tam paket",
                1499m, 3, 10, 2000, 1500, 500, 300, 3000,
                pro, 2),
            ("Premium",   "Premium",     "Yüksek hacimli güzellik merkezleri için",
                2990m, 6, 25, 8000, 5000, 2500, 1500, 10000,
                premium, 3),
            ("AIKlinik",  "AI Klinik",   "AI öneriler ve müşteri segmentasyonu dahil",
                4990m, 10, 50, 20000, 12000, 8000, 5000, -1,
                aiKlinik, 4),
            ("Enterprise","Enterprise",  "Özel limitler ve dedicated destek",
                0m,    -1, -1, -1, -1, -1, -1, -1,
                enterprise, 5),
        };

        try
        {
            var existingKeys = (await db.SubscriptionPlans.AsNoTracking().Select(p => p.PlanKey).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var toAdd = defaults.Where(d => !existingKeys.Contains(d.Key))
                .Select(d => new GuzellikMerkezi.Domain.Entities.SubscriptionPlan(
                    d.Key, d.Name, d.Price,
                    d.Branches, d.Staff, d.Customers, d.Appts, d.Sms,
                    d.Features, d.Desc, d.Order, d.WhatsApp, d.Email,
                    d.Price * 12)) // varsayılan yıllık fiyat = aylık × 12 (platform admin elle düzenleyebilir)
                .ToList();

            if (toAdd.Count > 0)
            {
                db.SubscriptionPlans.AddRange(toAdd);
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} default plan seed edildi.", toAdd.Count);
            }

            // Legacy feature key migration: eski 8 generic key'in herhangi birini içeren plan'ı
            // yeni granular default set'e taşı. Sadece varsayılan plan key'lerinde (Starter/Pro/...)
            // çalışır; özel plan'lar dokunulmaz.
            var legacyKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "BasicReports", "Reports", "Notifications", "MultiBranch",
                "AdvancedAnalytics", "APIAccess", "AIInsights", "SLA",
            };
            // 'MultiBranch' yeni key set'inde de var (case-sensitive 'multiBranch'),
            // o yüzden tanılamada yeni ile karşılaştırırken FeatureCatalog.Exists kullanıyoruz.

            var defaultByKey = defaults.ToDictionary(d => d.Key, d => d.Features, StringComparer.OrdinalIgnoreCase);
            var existingPlans = await db.SubscriptionPlans.ToListAsync();
            var migratedCount = 0;

            foreach (var plan in existingPlans)
            {
                if (!defaultByKey.TryGetValue(plan.PlanKey, out var newFeatures)) continue;
                if (string.IsNullOrWhiteSpace(plan.Features)) continue;

                var parts = plan.Features.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var hasLegacy = parts.Any(p => legacyKeys.Contains(p) && !FeatureCatalog.Exists(p));
                if (!hasLegacy) continue;

                plan.SetFeatures(newFeatures);
                migratedCount++;
            }
            if (migratedCount > 0)
            {
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} plan legacy feature CSV'sinden yeni granular feature set'ine taşındı.", migratedCount);
            }

            // Geriye dönük: mevcut default plan'lara yeni mesajlaşma limitlerini + klinik feature'ları uygula
            // (mevcut feature'lar silinmez, yalnızca eklenir; limitler kolon default'u 0 ise doldurulur).
            var defaultFull = defaults.ToDictionary(d => d.Key, d => d, StringComparer.OrdinalIgnoreCase);
            var newFeatureKeys = new[]
            {
                FeatureCatalog.ClinicalConsultation, FeatureCatalog.ClinicalBeforeAfter, FeatureCatalog.ClinicalCustomFields,
                FeatureCatalog.CustomersBlacklist, FeatureCatalog.CustomersPassive,
                FeatureCatalog.MarketingGiftCards, FeatureCatalog.FinanceCashClosing, FeatureCatalog.AppointmentsWaitlist,
                FeatureCatalog.SecurityDeviceControl,
            };
            var backfilled = 0;
            foreach (var plan in existingPlans)
            {
                if (!defaultFull.TryGetValue(plan.PlanKey, out var def)) continue;
                var changed = false;

                if (plan.MaxMonthlyWhatsAppCount == 0 && plan.MaxMonthlyEmailCount == 0 && (def.WhatsApp != 0 || def.Email != 0))
                {
                    plan.SetMessagingLimits(def.WhatsApp, def.Email);
                    changed = true;
                }

                var current = (plan.Features ?? string.Empty)
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
                foreach (var key in newFeatureKeys)
                {
                    if (def.Features.Contains(key) && !current.Any(c => string.Equals(c, key, StringComparison.OrdinalIgnoreCase)))
                    {
                        current.Add(key);
                        changed = true;
                    }
                }
                if (changed)
                {
                    plan.SetFeatures(string.Join(',', current));
                    backfilled++;
                }
            }
            if (backfilled > 0)
            {
                await db.SaveChangesAsync();
                logger.LogInformation("{Count} plan yeni mesajlaşma limiti/klinik feature ile güncellendi.", backfilled);
            }

            // Mevcut Tenant.Plan string'lerini eşleştirilebilen plana otomatik bağla.
            var allPlans = await db.SubscriptionPlans.AsNoTracking().ToListAsync();
            var byKey = allPlans.ToDictionary(p => p.PlanKey, StringComparer.OrdinalIgnoreCase);
            var byName = allPlans.GroupBy(p => p.Name).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            var unbound = await db.Tenants.Where(t => t.SubscriptionPlanId == null).ToListAsync();
            foreach (var t in unbound)
            {
                var match = byKey.TryGetValue(t.Plan, out var p) ? p
                          : byName.TryGetValue(t.Plan, out var p2) ? p2
                          : byKey.TryGetValue("Pro", out var p3) ? p3 : null;
                if (match is not null) t.AssignSubscriptionPlan(match);
            }
            if (unbound.Count > 0) await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Plan seed/eşleme sırasında hata.");
        }
    }

    /// <summary>
    /// Mevcut plaintext kayıtları AES-GCM ile şifreler. Idempotent: <c>ENC:v1:</c> ile
    /// başlayan satırlar atlanır. Her tablo kendi bağlantısında işlenir, hata olursa
    /// log'a yazılır ve diğer tablolarla devam edilir.
    /// </summary>
    public static async Task EncryptExistingDataAsync(IServiceProvider services, IConfiguration configuration)
    {
        var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
            || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);
        if (useInMemory) return;

        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");

        // Encryption servisi singleton, scope dışı erişim sorun değil.
        var encryption = services.GetService<IEncryptionService>();
        if (encryption is null)
        {
            logger.LogWarning("IEncryptionService kayıtlı değil, mevcut veri şifrelemesi atlanıyor.");
            return;
        }

        // Tablo + şifrelenecek kolonlar haritası
        var spec = new (string Table, string[] Columns)[]
        {
            ("tenants", new[] { "Name", "OwnerName", "Domain", "Phone", "TaxNumber" }),
            ("branches", new[] { "Name", "City" }),
            ("tenant_users", new[] { "FullName", "Permissions" }),
            ("customers", new[] { "FullName", "Phone", "Email", "Notes" }),
            ("staff_members", new[] { "FullName", "Title", "Phone", "Specialties" }),
            ("service_definitions", new[] { "Name", "Category" }),
            ("service_packages", new[] { "Name", "Description" }),
            ("appointments", new[] { "Notes", "CancellationReason" }),
            ("customer_accounts", new[] { "Name", "Notes" }),
            ("account_payments", new[] { "Method", "Reference" }),
            ("business_expenses", new[] { "Description", "Reference", "PeriodLabel" }),
            ("custom_expense_categories", new[] { "Name" }),
            ("custom_service_categories", new[] { "Name" }),
            ("products", new[] { "Name", "Unit", "Supplier", "Location" }),
            ("stock_movements", new[] { "Reference", "Notes" }),
            ("pending_operations", new[] { "RequestedByName", "Title", "Summary", "PayloadJson", "RejectionReason" }),
            ("notification_templates", new[] { "Name", "Body" }),
            ("notification_logs", new[] { "Recipient", "Body", "ErrorMessage" }),
            ("audit_logs", new[] { "ActorName", "Summary", "DataJson" }),
        };

        await using var connection = new MySqlConnection(connectionString);
        try
        {
            await connection.OpenAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Şifreleme migration'ı için DB bağlantısı açılamadı.");
            return;
        }

        foreach (var (table, columns) in spec)
        {
            try
            {
                await EncryptTableAsync(connection, encryption, logger, table, columns);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Tablo '{Table}' şifreleme migration'ı sırasında hata.", table);
            }
        }
    }

    private static async Task EncryptTableAsync(
        MySqlConnection connection,
        IEncryptionService encryption,
        ILogger logger,
        string table,
        string[] columns)
    {
        // Önce tablo var mı kontrol et — yoksa sessizce atla.
        await using (var existsCmd = connection.CreateCommand())
        {
            existsCmd.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t";
            var p = existsCmd.CreateParameter(); p.ParameterName = "@t"; p.Value = table; existsCmd.Parameters.Add(p);
            var result = await existsCmd.ExecuteScalarAsync();
            if (result is null || Convert.ToInt32(result) == 0) return;
        }

        var colList = string.Join(", ", columns.Select(c => $"`{c}`"));
        var rows = new List<(object Id, string?[] Values)>();
        await using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = $"SELECT `Id`, {colList} FROM `{table}`";
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                // MySQL driver Id'yi CHAR(36) -> Guid olarak verir; ToString ile normalize ediyoruz.
                var idValue = reader.GetValue(0);
                var values = new string?[columns.Length];
                for (var i = 0; i < columns.Length; i++)
                {
                    if (reader.IsDBNull(i + 1)) { values[i] = null; continue; }
                    var v = reader.GetValue(i + 1);
                    values[i] = v is null ? null : v.ToString();
                }
                rows.Add((idValue, values));
            }
        }

        var updated = 0;
        foreach (var (id, values) in rows)
        {
            // Sadece henüz şifrelenmemiş ve null/empty olmayan kolonları seç
            var changes = new List<(int Index, string Encrypted)>();
            for (var i = 0; i < columns.Length; i++)
            {
                var v = values[i];
                if (string.IsNullOrEmpty(v)) continue;
                if (encryption.IsEncrypted(v)) continue;
                var enc = encryption.Encrypt(v);
                if (enc is not null) changes.Add((i, enc));
            }
            if (changes.Count == 0) continue;

            var setClauses = string.Join(", ", changes.Select((c, idx) => $"`{columns[c.Index]}` = @v{idx}"));
            await using var upd = connection.CreateCommand();
            upd.CommandText = $"UPDATE `{table}` SET {setClauses} WHERE `Id` = @id";
            for (var i = 0; i < changes.Count; i++)
            {
                var p = upd.CreateParameter();
                p.ParameterName = $"@v{i}";
                p.Value = changes[i].Encrypted;
                upd.Parameters.Add(p);
            }
            var idParam = upd.CreateParameter();
            idParam.ParameterName = "@id";
            idParam.Value = id;
            upd.Parameters.Add(idParam);
            await upd.ExecuteNonQueryAsync();
            updated++;
        }

        if (updated > 0) logger.LogInformation("'{Table}' tablosunda {Count} satır şifrelendi.", table, updated);
    }
}

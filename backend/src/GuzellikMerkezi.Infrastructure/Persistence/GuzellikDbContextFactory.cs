using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// Design-time (dotnet ef) DbContext fabrikası. Uygulama host'unu (Program.cs) ÇALIŞTIRMADAN context oluşturur;
/// böylece <c>dotnet ef migrations add</c> sırasında otomatik migrate/seed/encryption yan etkileri OLUŞMAZ.
/// Encryption servisi verilmez (null) — kolon TİPLERİ (longtext/varchar) encryption'dan bağımsız ayarlandığından
/// migration yine de doğru üretilir; converter'lar yalnızca runtime'da bağlanır.
/// Bağlantı dizesi yalnızca provider'ı kurmak için gerekir; <c>migrations add</c> DB'ye bağlanmaz.
/// </summary>
public sealed class GuzellikDbContextFactory : IDesignTimeDbContextFactory<GuzellikDbContext>
{
    public GuzellikDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
            ?? "server=localhost;port=3306;database=guzellik_merkezi_dev;user=root;password=change-me;";

        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseMySQL(connectionString)
            .Options;

        return new GuzellikDbContext(options);
    }
}

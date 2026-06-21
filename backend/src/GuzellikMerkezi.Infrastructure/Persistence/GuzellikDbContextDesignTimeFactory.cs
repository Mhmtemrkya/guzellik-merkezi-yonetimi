using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// dotnet-ef CLI için design-time context fabrikası. Migration scaffold ederken
/// Program.cs çalıştırılmaz (seed/bootstrap yan etkileri tetiklenmez); model
/// bilgisi yeterli olduğundan bağlantı dizesinin gerçek bir sunucuya gitmesi gerekmez.
/// Gerekirse GM_CONNECTIONSTRING ortam değişkeniyle override edilir.
/// Kullanım (backend kökünden):
///   dotnet ef migrations add MigrationAdi -p src/GuzellikMerkezi.Infrastructure -s src/GuzellikMerkezi.Infrastructure -o Persistence/Migrations
/// </summary>
public sealed class GuzellikDbContextDesignTimeFactory : IDesignTimeDbContextFactory<GuzellikDbContext>
{
    public GuzellikDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("GM_CONNECTIONSTRING")
            ?? "server=localhost;port=3306;database=guzellik_merkezi_dev;user=root;password=change-me;";
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseMySQL(connectionString)
            .Options;
        return new GuzellikDbContext(options);
    }
}

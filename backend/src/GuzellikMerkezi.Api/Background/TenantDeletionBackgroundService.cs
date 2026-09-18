using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// BEKLEME SÜRESİ DOLAN KURUMLARI GERÇEKTEN SİLER.
///
/// <para>
/// Kurum yöneticisi "hesabımı sil" dediğinde veri anında yok edilmez; talep tarihlenir ve
/// bekleme süresi işler (bkz. <c>AccountDeletionService</c>). Süre dolunca silmeyi YAPAN
/// buradır — insan müdahalesi gerekmez. Silmeyi yalnız bir yönetici düğmesine bağlamak,
/// kullanıcıya verilen "verileriniz X tarihinde silinecek" sözünü birinin hatırlamasına
/// bırakırdı.
/// </para>
///
/// <para>
/// <b>Silme TEK İŞLEMDE yapılır.</b> <see cref="TenantPurge"/> 50'den fazla tabloyu sırayla
/// boşaltır; yarıda kalan bir silme, kurumu yetim satırlarla dolu ve girilemez bir hâlde
/// bırakırdı — hiç silinmemiş olmasından kötüdür. Bu yüzden transaction çağıran tarafta
/// (burada) açılır ve hata hâlinde her şey geri alınır.
/// </para>
///
/// <para>
/// <b>Denetim kaydı silmeden ÖNCE yazılır ve AYRI kaydedilir.</b> <c>audit_logs</c>
/// TenantPurge'ün koruduğu tablodur ama kayıt, silme transaction'ının içinde yazılıp
/// transaction geri alınırsa o da kaybolurdu. Ayrıca kurum adı ve kodu özet metnine yazılır:
/// kurum satırı artık olmayacağı için kaydı okuyan kişinin tek dayanağı o metindir.
/// </para>
/// </summary>
public sealed class TenantDeletionBackgroundService : BackgroundService
{
    /// <summary>
    /// Tarama sıklığı. Silme günü SAATİ değil GÜNÜ belirler; saatte bir yeterlidir ve
    /// dakikada bir taramanın veritabanına bindireceği yükü doğurmaz.
    /// </summary>
    private static readonly TimeSpan PollInterval = TimeSpan.FromHours(1);

    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);

    private readonly IServiceProvider _services;
    private readonly ILogger<TenantDeletionBackgroundService> _logger;

    public TenantDeletionBackgroundService(IServiceProvider services, ILogger<TenantDeletionBackgroundService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Migration/seed bitmiş olsun diye kısa bir bekleme (diğer tarayıcılarla aynı desen).
        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Kurum silme taraması hata verdi.");
            }

            try { await Task.Delay(PollInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditLogger>();
        var now = DateTime.UtcNow;

        // IgnoreQueryFilters: bu servisin oturumu yok, dolayısıyla kiracı kapsamı da yok.
        var due = await db.Tenants.IgnoreQueryFilters()
            .Where(t => t.DeletionScheduledAtUtc != null && t.DeletionScheduledAtUtc <= now)
            .ToListAsync(ct);

        foreach (var tenant in due)
        {
            // TEK TEK: biri patlarsa diğerleri yine silinsin. Hepsini tek transaction'a almak,
            // tek bir bozuk kurumun tüm kuyruğu kilitlemesi demekti.
            await PurgeOneAsync(db, audit, tenant, now, ct);
        }
    }

    private async Task PurgeOneAsync(
        GuzellikDbContext db, IAuditLogger audit, Tenant tenant, DateTime now, CancellationToken ct)
    {
        var name = tenant.Name;
        var code = tenant.Code ?? "kodsuz";
        var requestedAt = tenant.DeletionRequestedAtUtc;

        try
        {
            // ÖNCE DENETİM KAYDI, AYRI KAYDETME. Silme transaction'ının içinde yazılsaydı ve
            // transaction geri alınsaydı, "silmeye çalıştık" izi de kaybolurdu.
            await audit.LogAsync(tenant.Id, null, "TenantDeletionExecuted", "Tenant", tenant.Id,
                $"Bekleme süresi doldu; kurum ve tüm verisi kalıcı olarak silindi. Kurum: {name} ({code}).",
                new { tenantId = tenant.Id, tenantName = name, tenantCode = code, requestedAtUtc = requestedAt, executedAtUtc = now },
                ct);
            await db.SaveChangesAsync(ct);

            // InMemory sağlayıcı (birim testleri) transaction desteklemez; orada doğrudan sil.
            if (!db.Database.IsRelational())
            {
                await TenantPurge.PurgeAsync(db, tenant.Id, _logger, ct);
                await db.SaveChangesAsync(ct);
                _logger.LogWarning("Kurum silindi: {Name} ({Code}).", name, code);
                return;
            }

            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var deleted = await TenantPurge.PurgeAsync(db, tenant.Id, _logger, ct);
            await tx.CommitAsync(ct);

            _logger.LogWarning(
                "Kurum silindi: {Name} ({Code}). Silinen satır: {Rows}.",
                name, code, deleted.Values.Sum());
        }
        catch (Exception ex)
        {
            // Bir sonraki turda yeniden denenir: DeletionScheduledAtUtc yerinde durduğu için
            // kurum kuyrukta kalır. Sessizce geçmek, kullanıcıya verilen silme sözünü sessizce
            // yememek demekti — bu yüzden hata seviyesinde loglanır.
            _logger.LogError(ex, "Kurum silinemedi: {Name} ({Code}). Sonraki turda yeniden denenecek.", name, code);
            db.ChangeTracker.Clear();
        }
    }
}

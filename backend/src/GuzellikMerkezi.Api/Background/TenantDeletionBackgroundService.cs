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
/// <b>Silmeden hemen önce KİLİT ALTINDA yeniden doğrulanır.</b> Tarama ile silme arasında
/// kurum yöneticisi vazgeçebilir (<c>CancelDeletion</c>). Tarama sonucuna güvenip silmek,
/// "vazgeçtim" düğmesine basmış bir kurumun verisini yine de yok etmek demekti — geri
/// alınamaz bir hata. Bu yüzden satır, purge transaction'ının içinde
/// <c>SELECT … FOR UPDATE</c> ile yeniden okunur ve <c>DeletionScheduledAtUtc</c> koşulu
/// bir kez daha aranır. Kilit aynı zamanda ÇOK ÖRNEKLİ kurulumu da kurtarır: ikinci sunucu
/// aynı kurumu seçmişse kilidi bekler, sonra satırı bulamaz ve hiçbir şey yapmaz.
/// </para>
///
/// <para>
/// <b>DENETİM KAYDI YOKSA SİLME DE YOK (fail-closed).</b> <see cref="IAuditLogger"/> hatayı
/// YUTAR: çağrının dönmüş olması satırın yazıldığı anlamına gelmez. Geri dönülemez bir silme
/// için "kanıtsız silme" kabul edilemez — kurumun verisi yok edilmişken KVKK'nın ve iç
/// denetimin dayanacağı tek kayıt da yoksa, yapılan şey açıklanamaz hâle gelir. Bu yüzden
/// kayıt, commit'ten önce aynı transaction içinde OKUNARAK doğrulanır; yoksa silme geri alınır
/// ve kurum kuyrukta kalıp bir sonraki turda yeniden denenir.
/// </para>
///
/// <para>
/// <b>Denetim kaydı silmeyle AYNI transaction'da yazılır.</b> Önce yazılsaydı — eski hâli
/// buydu — vazgeçme yüzünden iptal edilen bir silme için "kalıcı olarak silindi" diyen bir
/// kayıt kalırdı: denetim izinin YALAN söylemesi, hiç kayıt olmamasından kötüdür.
/// <c>audit_logs</c> <see cref="TenantPurge"/>'ün koruduğu tablo olduğu ve
/// <c>tenants</c>'a yabancı anahtarı bulunmadığı için satır, kurum silindikten SONRA aynı
/// transaction'da yazılabilir. Kurum adı ve kodu özet metnine geçer: kurum satırı artık
/// olmayacağı için kaydı okuyan kişinin tek dayanağı o metindir.
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

    /// <summary>
    /// Silme denetim kaydının eylem adı. Yazan ve DOĞRULAYAN aynı sabiti kullanmalı: ikisi
    /// ayrı yazılsaydı, adı değiştiren biri doğrulamayı sessizce her zaman "yok" hâline
    /// getirir ve hiçbir kurum silinemez olurdu.
    /// </summary>
    private const string DeletionAuditAction = "TenantDeletionExecuted";

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

    /// <summary>
    /// TEK TURLUK TARAMA. Testten tetiklenebilmesi icin disa aciktir.
    /// </summary>
    /// <remarks>
    /// Iptal/silme yarisi YALNIZ gercek bir veritabaninda dogrulanabilir (InMemory saglayici ne
    /// transaction ne de satir kilidi tanir). Dogrulamanin yolu taramayi disaridan, kontrollu bir
    /// anda calistirabilmekten geciyordu; saatlik dongunun rastgele anini beklemek test degil
    /// kumar olurdu. Bkz. TenantDeletionRaceMySqlTests.
    /// </remarks>
    public async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditLogger>();
        var now = DateTime.UtcNow;

        // IgnoreQueryFilters: bu servisin oturumu yok, dolayısıyla kiracı kapsamı da yok.
        //
        // YALNIZ KİMLİK OKUNUR. İki sebebi var: (1) buradan gelen satır silme anına kadar
        // ESKİMİŞ olabilir — asıl karar birazdan kilit altında verilecek, dolayısıyla taranan
        // nesneyi taşımak yanlış bir güven duygusu verir; (2) kurum adı şifreli bir kolondur ve
        // tek bir bozuk şifre metni, tarama sırasında TÜM kuyruğu düşürürdü.
        var dueIds = await db.Tenants.IgnoreQueryFilters()
            .AsNoTracking()
            .Where(t => t.DeletionScheduledAtUtc != null && t.DeletionScheduledAtUtc <= now)
            .Select(t => t.Id)
            .ToListAsync(ct);

        foreach (var tenantId in dueIds)
        {
            // TEK TEK: biri patlarsa diğerleri yine silinsin. Hepsini tek transaction'a almak,
            // tek bir bozuk kurumun tüm kuyruğu kilitlemesi demekti.
            await PurgeOneAsync(db, audit, tenantId, now, ct);
        }
    }

    /// <summary>
    /// Silme HÂLÂ geçerli mi? (Kilit altında sorulur.)
    /// </summary>
    /// <remarks>
    /// Üç "hayır" hâli de aynı kapıya çıkar ve hiçbiri hata değildir: satır başka bir örnek
    /// tarafından silinmiş olabilir (<c>null</c>), yönetici vazgeçmiş olabilir (alan boşaltıldı)
    /// ya da tarih ileri alınmış olabilir.
    /// </remarks>
    private static bool StillDue(Tenant? tenant, DateTime now) =>
        tenant is { DeletionScheduledAtUtc: not null } && tenant.DeletionScheduledAtUtc <= now;

    private async Task PurgeOneAsync(
        GuzellikDbContext db, IAuditLogger audit, Guid tenantId, DateTime now, CancellationToken ct)
    {
        try
        {
            // InMemory sağlayıcı (birim testleri) ne transaction ne satır kilidi tanır; orada
            // doğrudan silinir. DOĞRULAMA YİNE YAPILIR: koruma iki koldan yalnız birinde
            // dursaydı, birim testleri korumasız yoldan geçip kapıyı yeşil gösterirdi.
            if (!db.Database.IsRelational())
            {
                var memory = await db.Tenants.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
                if (!StillDue(memory, now)) return;

                // SIRA BURADA TERS: transaction olmadığı için "yaz, doğrula, gerekirse geri al"
                // yapılamaz; fail-closed'ın tek aracı SIRADIR. Önce kanıt yazılır ve doğrulanır,
                // silme ancak ondan sonra yapılır.
                await WriteDeletedAuditAsync(audit, memory!, now, ct);
                if (!await DeletionAuditExistsAsync(db, tenantId, ct))
                {
                    db.ChangeTracker.Clear();
                    _logger.LogError(
                        "Kurum silinmedi: denetim kaydı yazılamadı. Kurum: {TenantId}. Sonraki turda yeniden denenecek.",
                        tenantId);
                    return;
                }

                await TenantPurge.PurgeAsync(db, tenantId, _logger, ct);
                _logger.LogWarning("Kurum silindi: {Name} ({Code}).", memory!.Name, memory.Code ?? "kodsuz");
                return;
            }

            await using var tx = await db.Database.BeginTransactionAsync(ct);

            // SATIR KİLİDİ + YENİDEN DOĞRULAMA — bu metodun en kritik yeri.
            //
            // Tarama ile buranın arası saniyeler sürebilir; o aralıkta yönetici "vazgeç"e basmış
            // olabilir. FOR UPDATE, kaydı transaction boyunca kilitler: vazgeçme isteği ya bizden
            // ÖNCE işlenip burada görünür (silmeyiz), ya da commit'imizi bekler ve satırı bulamaz.
            // Kilitsiz bir "tekrar oku", tam da okumayla silme arasına düşen vazgeçmeyi kaçırırdı.
            //
            // FromSqlRaw'ın üstüne LINQ operatörü EKLENMEZ: eklenseydi EF sorguyu türetilmiş bir
            // tabloya sarar ve FOR UPDATE'in etkisi kaybolurdu. AsNoTracking/IgnoreQueryFilters
            // sarmalama üretmez. SELECT * şart: kurum adı (şifreli) denetim kaydına yazılacak.
            var locked = await db.Tenants
#pragma warning disable EF1002
                .FromSqlRaw("SELECT * FROM `tenants` WHERE `Id` = {0} FOR UPDATE", tenantId)
#pragma warning restore EF1002
                .IgnoreQueryFilters()
                .AsNoTracking()
                .ToListAsync(ct);

            var tenant = locked.FirstOrDefault();
            if (!StillDue(tenant, now))
            {
                // VAZGEÇME KAZANDI. Ne silme ne de "silindi" kaydı olur; bu bir hata değildir,
                // sistemin doğru çalıştığının kanıtıdır — yine de sessiz geçmesin diye yazılır.
                await tx.RollbackAsync(ct);
                _logger.LogInformation(
                    "Kurum silinmedi: silme kaydı kilit altında artık geçerli değildi (vazgeçildi ya da başka bir örnek işledi). Kurum: {TenantId}.",
                    tenantId);
                return;
            }

            var name = tenant!.Name;
            var code = tenant.Code ?? "kodsuz";

            var deleted = await TenantPurge.PurgeAsync(db, tenantId, _logger, ct);

            // DENETİM KAYDI SİLMEYLE AYNI TRANSACTION'DA. audit_logs korunan tablodur ve
            // tenants'a yabancı anahtarı yoktur; sıra bu yüzden serbest. Aynı transaction
            // olması şart: "silindi" kaydıyla silmenin kaderi ayrılamaz.
            await WriteDeletedAuditAsync(audit, tenant, now, ct);

            // KANIT ARANIR — commit'ten ÖNCE, aynı transaction içinde.
            //
            // AuditLogger kendi içinde hata yutar (her yerde böyle: denetim yazımı iş akışını
            // bloklamasın diye). O davranış sıradan bir işlem için doğru, GERİ DÖNÜLEMEZ bir
            // silme için değil: yutulmuş tek bir hata, kurumun tüm verisi silinmişken hiçbir
            // kaydın kalmaması demekti. Bu yüzden satır okunarak doğrulanır; yoksa silme de
            // geri alınır. Kurum kuyrukta kalır ve bir sonraki turda yeniden denenir.
            if (!await DeletionAuditExistsAsync(db, tenantId, ct))
            {
                await tx.RollbackAsync(ct);
                // Yazılamayan audit satırı hâlâ Added durumunda takılı olabilir; temizlenmezse
                // döngüdeki BİR SONRAKİ kurumun kaydıyla birlikte yeniden yazılmaya çalışılır.
                db.ChangeTracker.Clear();
                _logger.LogError(
                    "Kurum silinmedi: denetim kaydı yazılamadı, silme geri alındı. Kurum: {TenantId}. Sonraki turda yeniden denenecek.",
                    tenantId);
                return;
            }

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
            _logger.LogError(ex, "Kurum silinemedi: {TenantId}. Sonraki turda yeniden denenecek.", tenantId);
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>
    /// Silme denetim kaydı GERÇEKTEN yazıldı mı? (Veritabanından okunur, ChangeTracker'dan değil.)
    /// </summary>
    /// <remarks>
    /// Sorgu açık transaction içinde çalıştığı için henüz commit edilmemiş kendi satırımızı
    /// görür — aradığımız da tam olarak budur: "bu transaction commit edilirse ortada bir kanıt
    /// kalacak mı?" Takip edilen varlığa bakmak yanıltıcı olurdu; <c>Added</c> durumda takılı
    /// kalmış bir nesne, veritabanına hiç yazılmamışken "yazıldı" gibi görünürdü.
    /// </remarks>
    private static Task<bool> DeletionAuditExistsAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct) =>
        db.AuditLogs.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(a => a.TenantId == tenantId && a.Action == DeletionAuditAction, ct);

    /// <summary>
    /// "Kurum silindi" denetim kaydı. YALNIZ silme gerçekten yapıldıktan sonra çağrılır.
    /// </summary>
    /// <remarks>
    /// <see cref="IAuditLogger"/> kendi <c>SaveChangesAsync</c>'ini çağırır ve scope'taki
    /// DbContext'i paylaşır; dolayısıyla açık bir transaction varsa kayıt ONUN içine düşer —
    /// istenen de budur. Not: audit yazımı kendi içinde hata yutar, bu yüzden çağıran taraftaki
    /// <c>LogWarning</c> satırı işletme kaydının ikinci kopyasıdır.
    /// </remarks>
    private static Task WriteDeletedAuditAsync(IAuditLogger audit, Tenant tenant, DateTime now, CancellationToken ct) =>
        audit.LogAsync(tenant.Id, null, DeletionAuditAction, "Tenant", tenant.Id,
            $"Bekleme süresi doldu; kurum ve tüm verisi kalıcı olarak silindi. Kurum: {tenant.Name} ({tenant.Code ?? "kodsuz"}).",
            new
            {
                tenantId = tenant.Id,
                tenantName = tenant.Name,
                tenantCode = tenant.Code,
                requestedAtUtc = tenant.DeletionRequestedAtUtc,
                executedAtUtc = now,
            },
            ct);
}

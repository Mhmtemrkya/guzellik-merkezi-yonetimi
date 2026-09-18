using GuzellikMerkezi.Api.Background;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Bu sınıfın TÜM testleri TEK bir geçici şemayı paylaşır.
/// </summary>
/// <remarks>
/// Her test kendi şemasını kurup düşürseydi (diğer <c>MySqlFact</c> sınıflarının deseni),
/// <c>DROP DATABASE</c> ile hemen ardından gelen <c>CREATE DATABASE</c> arasında havuzdan gelen
/// bağlantı ölü çıkıyor ve sıradaki test kurulum aşamasında "Reading from the stream has failed"
/// ile düşüyordu — testin ölçtüğü kuralla hiç ilgisi olmayan, sırayla değişen bir kırılma.
/// Bu sınıfın testleri hızlı olduğu için o pencere burada özellikle dar. Tek şema hem kırılmayı
/// bitirir hem koşuyu kısaltır; testler zaten kurum bazında yalıtılmış (her biri kendi kurumunu
/// açar ve yalnız onu sorar).
/// </remarks>
public sealed class TenantDeletionSchemaFixture : IAsyncLifetime
{
    public MySqlTestDatabase? Database { get; private set; }

    public async Task InitializeAsync()
    {
        // Sunucu yoksa ve ZORUNLU da değilse şema kurulmaz; testler [MySqlFact] ile zaten atlanır.
        // Zorunlu moddaysa CreateAsync bilerek patlar (sebebini taşıyan hatayla).
        if (MySqlTestDatabase.Available || MySqlTestDatabase.Required)
            Database = await MySqlTestDatabase.CreateAsync();
    }

    public async Task DisposeAsync()
    {
        if (Database is not null) await Database.DisposeAsync();
    }
}

/// <summary>
/// VAZGEÇME ↔ SİLME YARIŞI.
///
/// <para>
/// Kurum yöneticisi "hesabımı sil" dedikten sonra bekleme süresi boyunca vazgeçebilir. Süre
/// dolunca silmeyi <see cref="TenantDeletionBackgroundService"/> yapar. İki iş AYNI ANDA
/// çalışabilir: tarayıcı kuyruğu okurken kullanıcı "vazgeç"e basabilir. Eski kod kuyruktan
/// okuduğu satıra güvenip siliyordu — vazgeçmiş bir kurumun verisi GERİ ALINAMAZ biçimde yok
/// ediliyordu. Üstelik "kalıcı olarak silindi" denetim kaydı silmeden ÖNCE ve AYRI kaydediliyordu,
/// yani silme yapılmasa bile denetim izi yalan söylüyordu.
/// </para>
///
/// <para>
/// <b>Neden gerçek MySQL/MariaDB şart?</b> Düzeltmenin tamamı ilişkisel davranışa dayanıyor:
/// <c>SELECT … FOR UPDATE</c> satır kilidi, kilitli okumanın transaction anlık görüntüsünü
/// değil SON COMMIT'lenmiş hâli görmesi, ve denetim kaydının silmeyle aynı transaction'da
/// commit edilmesi. InMemory sağlayıcı bunların HİÇBİRİNİ taklit etmez; orada bu testler
/// "geçer" ama tek bir şeyi kanıtlamaz.
/// </para>
/// </summary>
public sealed class TenantDeletionRaceMySqlTests : IClassFixture<TenantDeletionSchemaFixture>
{
    private const string ExecutedAction = "TenantDeletionExecuted";

    private readonly TenantDeletionSchemaFixture _fixture;

    public TenantDeletionRaceMySqlTests(TenantDeletionSchemaFixture fixture) => _fixture = fixture;

    private MySqlTestDatabase Db => _fixture.Database!;

    /// <summary>
    /// Tarayıcının çalışacağı kapsam: HER scope ayrı DbContext (ve ayrı bağlantı) alır — testin
    /// kendi transaction'ı ile tarayıcınınki gerçekten farklı oturumlar olsun.
    /// </summary>
    /// <remarks>
    /// Denetim kaydı için SAHTE değil GERÇEK <see cref="AuditLogger"/> kullanılır: bu testin
    /// yarısı "hangi durumda denetim satırı YAZILMAZ" sorusudur ve hiçbir şey yazmayan bir
    /// sahte, o soruyu sormadan cevaplamış olurdu.
    /// </remarks>
    private ServiceProvider NewProvider() =>
        new ServiceCollection()
            .AddLogging()
            .AddScoped(_ => Db.NewContext())
            .AddScoped<ICurrentUser>(_ => new TestCurrentUser())
            .AddScoped<IAuditLogger, AuditLogger>()
            .BuildServiceProvider();

    private static TenantDeletionBackgroundService NewSweeper(ServiceProvider provider) =>
        new(provider, NullLogger<TenantDeletionBackgroundService>.Instance);

    /// <summary>Şema paylaşıldığı için kurum kodu da benzersiz olmalı (tekil dizin var).</summary>
    private static string NewCode() => $"BA-{Guid.NewGuid():N}"[..12].ToUpperInvariant();

    /// <summary>Verilen gün sayısı kadar ÖNCE istenmiş, 30 günlük beklemesi olan kurum.</summary>
    private async Task<Guid> SeedTenantAsync(int requestedDaysAgo)
    {
        await using var db = Db.NewContext();

        var tenant = new Tenant("Silinecek Kurum", $"yaris-{Guid.NewGuid():N}"[..16], "Premium", TenantStatus.Active);
        tenant.AssignCode(NewCode());
        tenant.RequestDeletion(DateTime.UtcNow.AddDays(-requestedDaysAgo), 30, null, "Test");
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        return tenant.Id;
    }

    private async Task<bool> TenantExistsAsync(Guid tenantId)
    {
        await using var db = Db.NewContext();
        return await db.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Id == tenantId);
    }

    private async Task<int> ExecutedAuditCountAsync(Guid tenantId)
    {
        await using var db = Db.NewContext();
        return await db.AuditLogs.IgnoreQueryFilters()
            .CountAsync(a => a.Action == ExecutedAction && a.TenantId == tenantId);
    }

    /// <summary>
    /// TARAMA SIRASINDA GELEN VAZGEÇME SİLMEYİ DURDURUR.
    /// </summary>
    /// <remarks>
    /// Yarış PENCERESİ deterministik olarak kurulur:
    /// <list type="number">
    /// <item>Vazgeçme transaction'ı satırı kilitler, <c>DeletionScheduledAtUtc</c>'yi temizler ve
    /// COMMIT ETMEDEN bekler.</item>
    /// <item>Tarayıcı başlar. Kuyruk sorgusu kilitsizdir (MVCC): commit edilmemiş vazgeçmeyi
    /// GÖRMEZ, kurumu hâlâ "silinecek" sanır — eski kodun sildiği durum tam da budur. Ardından
    /// <c>FOR UPDATE</c> satırına gelir ve BEKLER.</item>
    /// <item>Tarayıcının gerçekten beklediği ÖLÇÜLÜR. Bu adım testin belkemiğidir: kilit
    /// alınmasaydı tarayıcı çoktan bitmiş olurdu ve test, yarışı hiç kurmadan "geçti" derdi.</item>
    /// <item>Vazgeçme commit edilir. Kilitli okuma anlık görüntüyü DEĞİL son commit'lenmiş hâli
    /// gördüğü için tarayıcı artık boş bir <c>DeletionScheduledAtUtc</c> görür ve vazgeçer.</item>
    /// </list>
    /// </remarks>
    [MySqlFact]
    public async Task VazgecmeTaramaninOrtasindaGelirse_KurumSilinmez()
    {
        var tenantId = await SeedTenantAsync(requestedDaysAgo: 40);

        // 1) Vazgeçme: satır kilitlendi, HENÜZ commit edilmedi.
        await using var cancelDb = Db.NewContext();
        await using var cancelTx = await cancelDb.Database.BeginTransactionAsync();
        var cancelling = await cancelDb.Tenants.IgnoreQueryFilters().FirstAsync(t => t.Id == tenantId);
        cancelling.CancelDeletion(null);
        await cancelDb.SaveChangesAsync();

        // 2) Tarayıcı ayrı bir oturumda başlar.
        await using var provider = NewProvider();
        var sweep = NewSweeper(provider).SweepAsync(CancellationToken.None);

        // 3) Tarayıcı KİLİTTE BEKLİYOR olmalı. (Kilit olmasaydı silme çoktan bitmişti.)
        var finishedEarly = await Task.WhenAny(sweep, Task.Delay(TimeSpan.FromSeconds(2))) == sweep;
        Assert.False(finishedEarly,
            "Tarayıcı satır kilidinde beklemeliydi; beklemeden bitmesi FOR UPDATE'in etkisiz olduğunu gösterir.");

        // 4) Vazgeçme commit edilir; tarayıcı güncel satırı görür.
        await cancelTx.CommitAsync();
        await sweep.WaitAsync(TimeSpan.FromSeconds(30));

        // KURUM DURUYOR.
        Assert.True(await TenantExistsAsync(tenantId),
            "Vazgeçen kurum silindi: geri alınamaz veri kaybı.");

        // VE DENETİM İZİ YALAN SÖYLEMİYOR: silinmediği için "silindi" kaydı da yok.
        Assert.Equal(0, await ExecutedAuditCountAsync(tenantId));
    }

    /// <summary>
    /// Vazgeçme YOKSA kurum gerçekten silinir ve "silindi" kaydı YAZILIR.
    /// </summary>
    /// <remarks>
    /// Yarış düzeltmesinin bedeli olmamalı: kilit ve yeniden doğrulama eklenirken normal yolun
    /// çalışmaya devam ettiği ayrıca sabitlenir. Denetim kaydı artık silmeyle AYNI transaction'da
    /// yazıldığı için, "kurum yok ama kayıt da yok" ya da tersi bir sonuç bu testi düşürür.
    /// </remarks>
    [MySqlFact]
    public async Task SuresiDolanKurum_SilinirVeDenetimKaydiYazilir()
    {
        var tenantId = await SeedTenantAsync(requestedDaysAgo: 40);

        await using var provider = NewProvider();
        await NewSweeper(provider).SweepAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(30));

        Assert.False(await TenantExistsAsync(tenantId));
        Assert.Equal(1, await ExecutedAuditCountAsync(tenantId));
    }

    /// <summary>
    /// DENETİM KAYDI YAZILAMAZSA KURUM SİLİNMEZ (fail-closed).
    /// </summary>
    /// <remarks>
    /// <see cref="IAuditLogger"/> hatayı YUTAR; bu yüzden "çağrı döndü" ile "satır yazıldı"
    /// aynı şey değildir. Burada hiçbir şey yazmayan bir logger takılarak tam olarak o durum
    /// kurulur: kurum silinmeye HAZIR, silme koşulu geçerli, ama kanıt üretilemiyor. Beklenen
    /// davranış silmeyi geri almaktır — kurumun tüm verisi yok edilmişken hiçbir kaydın
    /// kalmaması, KVKK ve iç denetim açısından açıklanamaz bir sonuçtur.
    /// </remarks>
    [MySqlFact]
    public async Task DenetimKaydiYazilamazsa_KurumSilinmez()
    {
        var tenantId = await SeedTenantAsync(requestedDaysAgo: 40);

        // Hiçbir satır yazmayan logger = sessizce başarısız olmuş audit yazımı.
        await using var provider = new ServiceCollection()
            .AddLogging()
            .AddScoped(_ => Db.NewContext())
            .AddScoped<ICurrentUser>(_ => new TestCurrentUser())
            .AddScoped<IAuditLogger, NoopAuditLogger>()
            .BuildServiceProvider();

        await NewSweeper(provider).SweepAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(30));

        Assert.True(await TenantExistsAsync(tenantId),
            "Denetim kaydı olmadan silme yapıldı: geri dönülemez silme kanıtsız kaldı.");
        Assert.Equal(0, await ExecutedAuditCountAsync(tenantId));
    }

    /// <summary>
    /// Bekleme süresi DOLMAMIŞ kuruma dokunulmaz (kuyruk ölçütünün kendisi).
    /// </summary>
    [MySqlFact]
    public async Task SuresiDolmayanKurum_Silinmez()
    {
        var tenantId = await SeedTenantAsync(requestedDaysAgo: 0); // 30 gün sonra silinecek

        await using var provider = NewProvider();
        await NewSweeper(provider).SweepAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(30));

        Assert.True(await TenantExistsAsync(tenantId));
        Assert.Equal(0, await ExecutedAuditCountAsync(tenantId));
    }
}

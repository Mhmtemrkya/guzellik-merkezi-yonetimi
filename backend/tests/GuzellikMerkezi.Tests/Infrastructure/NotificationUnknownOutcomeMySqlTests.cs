using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MySql.Data.MySqlClient;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>Bu sınıfın testleri TEK bir geçici şemayı paylaşır (bkz. TenantDeletionSchemaFixture).</summary>
public sealed class NotificationSchemaFixture : IAsyncLifetime
{
    public MySqlTestDatabase? Database { get; private set; }

    public async Task InitializeAsync()
    {
        if (MySqlTestDatabase.Available || MySqlTestDatabase.Required)
            Database = await MySqlTestDatabase.CreateAsync();
    }

    public async Task DisposeAsync()
    {
        if (Database is not null) await Database.DisposeAsync();
    }
}

/// <summary>
/// SONUCU BİLİNMEYEN GÖNDERİM İKİNCİ KEZ GÖNDERİLMEZ.
///
/// <para>
/// Otomatik bildirim satırı sağlayıcıya gitmeden ÖNCE <c>Queued</c> olarak yazılır. Sağlayıcı
/// mesajı kabul ettikten SONRA süreç çökerse satır <c>Queued</c> kalıyordu ve bayat rezervasyon
/// kurtarması onu "hiç gönderilmemiş" sayıp AYNI mesajı müşteriye TEKRAR gönderiyordu. Hatırlatma
/// ya da ödeme bildiriminin iki kez gitmesi kuruma doğrudan şikâyet olarak döner; WhatsApp'ta
/// ayrıca kontör yakar.
/// </para>
///
/// <para>
/// Çözüm, iki hâli AYIRT EDİLEBİLİR kılmaktır: sağlayıcı çağrısından hemen önce bir damga
/// (<c>UpdatedAtUtc</c>) commit edilir. Damgalı bayat satır = "sonuç bilinmiyor" → tekrarlanmaz,
/// terminal hâle getirilir. Damgasız bayat satır = "sağlayıcıya hiç gidilmedi" → devralınır ve
/// gönderilir. İkinci davranış önceki denetim turunun kazanımıdır ve KORUNMALIDIR: bu sınıf
/// ikisini birden sabitler, çünkü yalnız birini test etmek diğerini sessizce kırmaya davettir.
/// </para>
///
/// <para>
/// <b>Neden gerçek MariaDB?</b> Kurtarma yolu benzersiz indeks ihlaline (<c>DbUpdateException</c>)
/// ve koşulu WHERE'inde taşıyan ham <c>UPDATE</c>'lere dayanır. InMemory sağlayıcı ne benzersiz
/// indeks zorlar ne de bu SQL'i çalıştırır.
/// </para>
/// </summary>
public sealed class NotificationUnknownOutcomeMySqlTests : IClassFixture<NotificationSchemaFixture>
{
    private const string Bucket = "20260918";

    private readonly NotificationSchemaFixture _fixture;

    public NotificationUnknownOutcomeMySqlTests(NotificationSchemaFixture fixture) => _fixture = fixture;

    private MySqlTestDatabase Db => _fixture.Database!;

    private sealed record Seed(Guid TenantId, Guid TemplateId, Guid CustomerId, string DedupeKey);

    /// <summary>Kurum + şube + aktif SMS şablonu + telefonu olan müşteri.</summary>
    private async Task<Seed> SeedAsync()
    {
        await using var db = Db.NewContext();

        var tenant = new Tenant("Bildirim Kurumu", $"bild-{Guid.NewGuid():N}"[..16], "Premium", TenantStatus.Active);
        tenant.AssignCode($"BA-{Guid.NewGuid():N}"[..12].ToUpperInvariant());
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var template = new NotificationTemplate(tenant.Id, branch.Id, "Randevu Hatırlatma",
            NotificationChannel.Sms, NotificationTrigger.AppointmentReminder,
            "Merhaba, randevunuzu hatırlatırız.", NotificationTemplateStatus.Active);
        var customer = new Customer(tenant.Id, branch.Id, "Ayşe Yılmaz", "+90 555 111 22 33", "ayse@ornek.com");
        db.NotificationTemplates.Add(template);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        // Anahtar servisin ürettiğiyle AYNI biçimde kurulur (NotificationService.SendAsync).
        return new Seed(tenant.Id, template.Id, customer.Id, $"{template.Id:N}:{customer.Id:N}:{Bucket}");
    }

    /// <summary>
    /// Bayat bir rezervasyon satırı bırakır: çökmüş bir gönderimin geride kalanı.
    /// </summary>
    /// <param name="dispatchStamped">
    /// <c>true</c> → sağlayıcıya GİDİLMİŞTİ (damga var). <c>false</c> → hiç gidilmemişti.
    /// </param>
    private async Task<Guid> SeedStaleReservationAsync(Seed seed, bool dispatchStamped)
    {
        Guid logId;
        await using (var db = Db.NewContext())
        {
            var log = new NotificationLog(seed.TenantId, null, seed.TemplateId, seed.CustomerId,
                NotificationChannel.Sms, "+90 555 111 22 33", "Merhaba, randevunuzu hatırlatırız.",
                NotificationLogStatus.Queued, null, seed.DedupeKey);
            db.NotificationLogs.Add(log);
            await db.SaveChangesAsync();
            logId = log.Id;
        }

        // BAYATLATMA HAM SQL'LE: CreatedAtUtc/UpdatedAtUtc varlık üzerinden yazılamaz (korumalı) ve
        // zaten gerçekte de onları veritabanındaki eski satır taşır.
        var stale = DateTime.UtcNow - NotificationService.StaleReservationTimeout - TimeSpan.FromMinutes(5);
        await using var conn = new MySqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            "UPDATE `notification_logs` SET `CreatedAtUtc` = @stale, `UpdatedAtUtc` = @stamp WHERE `Id` = @id";
        cmd.Parameters.AddWithValue("@stale", stale);
        cmd.Parameters.AddWithValue("@stamp", dispatchStamped ? stale : (object)DBNull.Value);
        cmd.Parameters.AddWithValue("@id", logId.ToString());
        await cmd.ExecuteNonQueryAsync();

        return logId;
    }

    private (NotificationService Service, IPlatformMessagingService Messaging) NewService(GuzellikDbContext db)
    {
        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "provider-1", null));

        var service = new NotificationService(
            db,
            new AlwaysAllowUsageService(),
            new AllowAllFeatureService(),
            messaging,
            new ServiceCollection().BuildServiceProvider());

        return (service, messaging);
    }

    private async Task<NotificationLog> ReadLogAsync(Guid logId)
    {
        await using var db = Db.NewContext();
        return await db.NotificationLogs.IgnoreQueryFilters().AsNoTracking().FirstAsync(l => l.Id == logId);
    }

    /// <summary>
    /// DAMGALI bayat satır: sağlayıcıya gidilmişti → mesaj TEKRAR GÖNDERİLMEZ.
    /// </summary>
    /// <remarks>
    /// Eski davranışta bu satır devralınır ve SMS ikinci kez giderdi. Test hem sağlayıcının
    /// çağrılmadığını hem de satırın artık belirsizlikte ASILI KALMADIĞINI (terminal duruma
    /// geçtiğini) sabitler: Queued bırakmak aynı kararı her turda yeniden verdirirdi.
    /// </remarks>
    [MySqlFact]
    public async Task SonucuBilinmeyenBayatRezervasyon_TekrarGonderilmez()
    {
        var seed = await SeedAsync();
        var logId = await SeedStaleReservationAsync(seed, dispatchStamped: true);

        await using var db = Db.NewContext();
        var (service, messaging) = NewService(db);

        var result = await service.SendAsync(seed.TenantId,
            new SendNotificationRequest(seed.TemplateId, new[] { seed.CustomerId }, null, Bucket));

        Assert.True(result.IsSuccess);

        // SAĞLAYICIYA HİÇ GİDİLMEDİ — müşteriye ikinci mesaj yok.
        await messaging.DidNotReceive().SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        // Satır terminal ve SEBEBİ yazılı; "Sent" değil, çünkü teslimat doğrulanamadı (kota da saymaz).
        var log = await ReadLogAsync(logId);
        Assert.Equal(NotificationLogStatus.Failed, log.Status);
        Assert.Contains("doğrulanamadı", log.ErrorMessage);

        // İkinci bir satır AÇILMADI: tekilleştirme anahtarı hâlâ tek satır.
        await using var check = Db.NewContext();
        Assert.Equal(1, await check.NotificationLogs.IgnoreQueryFilters()
            .CountAsync(l => l.DedupeKey == seed.DedupeKey));
    }

    /// <summary>
    /// DAMGASIZ bayat satır: sağlayıcıya hiç gidilmemişti → devralınır ve GÖNDERİLİR.
    /// </summary>
    /// <remarks>
    /// Önceki denetim turunun kazanımı budur ve korunmalıdır: rezervasyonunu yazıp çöken bir
    /// süreç yüzünden müşteri hatırlatmasını HİÇ almamalı, üstelik bu hiçbir yerde görünmeden
    /// olmamalıydı. Yeni fren yalnız "sonucu bilinmeyen" satırlara uygulanır.
    /// </remarks>
    [MySqlFact]
    public async Task HicGonderilmemisBayatRezervasyon_DevralinirVeGonderilir()
    {
        var seed = await SeedAsync();
        var logId = await SeedStaleReservationAsync(seed, dispatchStamped: false);

        await using var db = Db.NewContext();
        var (service, messaging) = NewService(db);

        var result = await service.SendAsync(seed.TenantId,
            new SendNotificationRequest(seed.TemplateId, new[] { seed.CustomerId }, null, Bucket));

        Assert.True(result.IsSuccess);

        await messaging.Received(1).SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        var log = await ReadLogAsync(logId);
        Assert.Equal(NotificationLogStatus.Sent, log.Status);
    }

    /// <summary>
    /// YAŞAYAN rezervasyona dokunulmaz: bayatlamamış satır ne tekrarlanır ne kapatılır.
    /// </summary>
    /// <remarks>
    /// Birkaç saniye önce başlamış bir gönderim hâlâ sürüyor olabilir. Onu "sonucu bilinmiyor"
    /// diye kapatmak, gerçekten başarıyla giden mesajı geçmişte BAŞARISIZ göstermek olurdu.
    /// </remarks>
    [MySqlFact]
    public async Task YasayanRezervasyon_DokunulmadanBirakilir()
    {
        var seed = await SeedAsync();

        Guid logId;
        await using (var setup = Db.NewContext())
        {
            var log = new NotificationLog(seed.TenantId, null, seed.TemplateId, seed.CustomerId,
                NotificationChannel.Sms, "+90 555 111 22 33", "Merhaba, randevunuzu hatırlatırız.",
                NotificationLogStatus.Queued, null, seed.DedupeKey);
            setup.NotificationLogs.Add(log);
            await setup.SaveChangesAsync();
            logId = log.Id;
        }

        await using var db = Db.NewContext();
        var (service, messaging) = NewService(db);

        await service.SendAsync(seed.TenantId,
            new SendNotificationRequest(seed.TemplateId, new[] { seed.CustomerId }, null, Bucket));

        await messaging.DidNotReceive().SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        var stillQueued = await ReadLogAsync(logId);
        Assert.Equal(NotificationLogStatus.Queued, stillQueued.Status);
    }
}

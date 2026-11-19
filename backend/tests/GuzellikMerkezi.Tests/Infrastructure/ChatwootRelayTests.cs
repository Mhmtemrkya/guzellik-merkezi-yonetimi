using System.Net;
using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// OLAYLAR ÖNCE BEAUTYASIST'E (20 Kas 2026) — Meta webhook'u BeautyAsist'e gelir; imzası doğrulanan HER olay
/// (gövde + <c>X-Hub-Signature-256</c>) AYNEN Chatwoot'a iletilir, BeautyAsist de kendi işlemesini yapar.
///
/// <para>
/// Sınanan sözleşme: (1) iletilen gövde BAYT BAYT aynıdır ve imza başlığı değişmez (Chatwoot imzayı ham gövde
/// üzerinde doğrular); (2) kuruma bağlı olmayan numaralar ve durum olayları da iletilir; (3) imzası tutmayan olay
/// ne işlenir ne iletilir; (4) doğrudan iletim başarısızsa olay uzun yeniden denemeli kalıcı kuyruğa düşer,
/// kuyruğa da yazılamazsa istisna yukarı çıkar (Meta 200 almaz, yeniden gönderir); (5) paylaşımlı numarada
/// yalnız yanıtlar kurum kaydına yazılır.
/// </para>
/// </summary>
public sealed class ChatwootRelayTests
{
    private const string AppSecret = "relay-test-app-secret";
    private const string PhoneNumberId = "148354043150891";
    private const string CustomerPhone = "905306480225";
    // IP literali: testler DNS'e bağımlı olmasın (global adres → koruma kapısından geçer).
    private const string RelayUrl = "https://93.184.216.34/webhooks/whatsapp/+908502428425";

    // ==================== YARDIMCILAR ====================

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public List<(string Url, byte[] Body, string? Signature, string? MediaType)> Requests { get; } = [];
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public bool Fail { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            var signature = request.Headers.TryGetValues("X-Hub-Signature-256", out var values) ? values.Single() : null;
            Requests.Add((request.RequestUri!.ToString(), body, signature, request.Content?.Headers.ContentType?.MediaType));
            if (Fail) throw new HttpRequestException("bağlantı reddedildi");
            return new HttpResponseMessage(Status);
        }
    }

    private sealed class ThrowingQueue : IDurableJobQueue
    {
        public Task EnqueueAsync(string jobType, object payload, CancellationToken ct = default) =>
            throw new InvalidOperationException("veritabanı yok");
    }

    private static IHttpClientFactory Factory(CapturingHandler handler)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient(ChatwootEventRelay.HttpClientName).Returns(_ => new HttpClient(handler, disposeHandler: false));
        return factory;
    }

    private static ChatwootEventRelay Relay(GuzellikDbContext db, CapturingHandler handler, IDurableJobQueue? queue = null) =>
        new(db, Factory(handler), queue ?? new DurableJobQueue(db, new NoopJobSignalPublisher()), NullLogger<ChatwootEventRelay>.Instance);

    private static WhatsAppService NewService(GuzellikDbContext db, IWhatsAppEventRelay? relay)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["WhatsApp:AppSecret"] = AppSecret })
            .Build();
        var billing = Substitute.For<IWhatsAppBillingService>();
        billing.ReserveAsync(Arg.Any<Guid>(), Arg.Any<WhatsAppMessageCategory>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(call => BillingDecision.Free(call.ArgAt<WhatsAppMessageCategory>(1), WhatsAppBillingSource.Quota));
        return new WhatsAppService(
            db,
            Substitute.For<IEncryptionService>(),
            Substitute.For<IHttpClientFactory>(),
            config,
            NullLogger<WhatsAppService>.Instance,
            new AllowAllFeatureService(),
            billing,
            new TestCurrentUser(UserRole.InstitutionOwner),
            Substitute.For<IWaitlistService>(),
            Substitute.For<IAppNotificationService>(),
            Substitute.For<IKvkkDocumentService>(),
            Substitute.For<IServiceProvider>(),
            relay);
    }

    private sealed record Seed(Guid TenantId, Guid AppointmentId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database, string? relayUrl = RelayUrl, bool repliesOnly = false)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Iletim Salonu", $"rl-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "Erzurum", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "AYSE YILMAZ", CustomerPhone, null);
        db.Customers.Add(customer);
        var settings = new WhatsAppSettings(tenant.Id);
        settings.BindConnection(PhoneNumberId, "waba-rl", "+90 850 242 84 25", WhatsAppConnectionStatus.NotConnected);
        if (repliesOnly) settings.SetRecordRepliesOnly(true);
        db.WhatsAppSettings.Add(settings);
        var platform = new PlatformIntegrationSettings();
        if (relayUrl is not null) platform.UpdateChatwootRelay(relayUrl);
        db.PlatformIntegrationSettings.Add(platform);

        var staff = new StaffMember(tenant.Id, branch.Id, "UZMAN", "Uzman");
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m);
        db.StaffMembers.Add(staff);
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var start = DateTime.UtcNow.AddHours(20);
        var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, start, start.AddHours(1), 0m);
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, appointment.Id);
    }

    /// <summary>Meta'nın gerçek biçimine yakın gelen mesaj olayı (Türkçe harfler: bayt eşliği sınansın).</summary>
    private static string MessageEvent(string wamid, string text, string phoneNumberId = PhoneNumberId) =>
        "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1844734790001832\",\"changes\":[{\"value\":{" +
        "\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"908502428425\",\"phone_number_id\":\"" + phoneNumberId + "\"}," +
        "\"contacts\":[{\"profile\":{\"name\":\"Ayşe Yılmaz\"},\"wa_id\":\"" + CustomerPhone + "\"}]," +
        "\"messages\":[{\"from\":\"" + CustomerPhone + "\",\"id\":\"" + wamid + "\",\"timestamp\":\"1795200000\",\"type\":\"text\"," +
        "\"text\":{\"body\":\"" + text + "\"}}]},\"field\":\"messages\"}]}]}";

    /// <summary>Teslim durumu olayı (temsilcinin Chatwoot'tan gönderdiği mesajınki de böyle gelir).</summary>
    private static string StatusEvent(string phoneNumberId) =>
        "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1844734790001832\",\"changes\":[{\"value\":{" +
        "\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"908502428425\",\"phone_number_id\":\"" + phoneNumberId + "\"}," +
        "\"statuses\":[{\"id\":\"wamid.AGENT-REPLY\",\"status\":\"delivered\",\"timestamp\":\"1795200000\",\"recipient_id\":\"" + CustomerPhone + "\"}]}," +
        "\"field\":\"messages\"}]}]}";

    private static string Sign(string payload) =>
        "sha256=" + Convert.ToHexString(
            HMACSHA256.HashData(Encoding.UTF8.GetBytes(AppSecret), Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

    private static async Task<List<WhatsAppMessage>> InboundAsync(MySqlTestDatabase database, Guid tenantId)
    {
        await using var check = database.NewContext();
        return await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == tenantId && m.Direction == WhatsAppMessageDirection.Inbound)
            .ToListAsync();
    }

    private static async Task<List<BackgroundJob>> RelayJobsAsync(MySqlTestDatabase database)
    {
        await using var check = database.NewContext();
        return await check.BackgroundJobs.AsNoTracking().Where(j => j.Type == DurableJobTypes.ChatwootRelay).ToListAsync();
    }

    // ==================== 1) İLETİM SÖZLEŞMESİ ====================

    /// <summary>İmzası doğrulanan olay Chatwoot'a BAYT BAYT aynı gider; BeautyAsist kendi işlemesini de yapar.</summary>
    [MySqlFact]
    public async Task VerifiedEvent_IsRelayedByteForByte_AndStillProcessed()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var payload = MessageEvent("wamid.RELAY-1", "Evet, geliyorum — teşekkürler ğüşıöç");
        var signature = Sign(payload);
        var handler = new CapturingHandler();

        await using (var db = database.NewContext())
            await NewService(db, Relay(db, handler)).HandleInboundAsync(payload, signature);

        var sent = Assert.Single(handler.Requests);
        Assert.Equal(RelayUrl, sent.Url);
        Assert.Equal(Encoding.UTF8.GetBytes(payload), sent.Body);
        Assert.Equal(signature, sent.Signature);
        Assert.Equal("application/json", sent.MediaType);
        Assert.Empty(await RelayJobsAsync(database));

        var inbound = Assert.Single(await InboundAsync(database, seed.TenantId));
        Assert.Equal("wamid.RELAY-1", inbound.ProviderMessageId);
    }

    /// <summary>
    /// Chatwoot HER olayı ister: hiçbir kuruma bağlı olmayan numara ve temsilci yanıtlarının teslim durumları da
    /// iletilir (yoksa Chatwoot'taki başka numaralar ve "iletildi" tikleri dururdu).
    /// </summary>
    [MySqlFact]
    public async Task UnboundNumber_AndStatusEvents_AreStillRelayed()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        await SeedAsync(database);
        var handler = new CapturingHandler();
        var unbound = MessageEvent("wamid.OTHER-NUMBER", "Merhaba", phoneNumberId: "999888777666555");
        var status = StatusEvent(PhoneNumberId);

        await using (var db = database.NewContext())
        {
            var service = NewService(db, Relay(db, handler));
            await service.HandleInboundAsync(unbound, Sign(unbound));
            await service.HandleInboundAsync(status, Sign(status));
        }

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(Encoding.UTF8.GetBytes(unbound), handler.Requests[0].Body);
        Assert.Equal(Encoding.UTF8.GetBytes(status), handler.Requests[1].Body);
    }

    /// <summary>İmzası tutmayan olay ne işlenir ne iletilir (sahte olayla Chatwoot'a gönderim yaptırılamaz).</summary>
    [MySqlFact]
    public async Task InvalidSignature_IsNeitherProcessedNorRelayed()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var handler = new CapturingHandler();
        var payload = MessageEvent("wamid.FORGED", "EVET");

        await using (var db = database.NewContext())
        {
            var service = NewService(db, Relay(db, handler));
            await service.HandleInboundAsync(payload, "sha256=" + new string('0', 64));
            await service.HandleInboundAsync(payload, null);
        }

        Assert.Empty(handler.Requests);
        Assert.Empty(await RelayJobsAsync(database));
        Assert.Empty(await InboundAsync(database, seed.TenantId));
    }

    /// <summary>İletim adresi tanımlı değilse hiçbir şey gönderilmez, kuyruğa yazılmaz; işleme yine olur.</summary>
    [MySqlFact]
    public async Task NoRelayUrl_SendsNothing()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, relayUrl: null);
        var handler = new CapturingHandler();
        var payload = MessageEvent("wamid.NO-RELAY", "EVET");

        await using (var db = database.NewContext())
            await NewService(db, Relay(db, handler)).HandleInboundAsync(payload, Sign(payload));

        Assert.Empty(handler.Requests);
        Assert.Empty(await RelayJobsAsync(database));
        Assert.Single(await InboundAsync(database, seed.TenantId));
    }

    // ==================== 2) DAYANIKLILIK ====================

    /// <summary>
    /// Chatwoot hata dönerse ya da ulaşılamazsa olay UZUN yeniden denemeli kalıcı kuyruğa düşer; kuyruktaki iş
    /// aynı baytları aynı imzayla gönderir, yine başarısızsa istisna fırlatır (kuyruk yeniden dener).
    /// </summary>
    [MySqlFact]
    public async Task RelayFailure_FallsBackToDurableQueue_AndJobReplaysSameBytes()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var handler = new CapturingHandler { Status = HttpStatusCode.ServiceUnavailable };
        var first = MessageEvent("wamid.QUEUE-1", "EVET");
        var second = MessageEvent("wamid.QUEUE-2", "HAYIR");

        await using (var db = database.NewContext())
        {
            var service = NewService(db, Relay(db, handler));
            await service.HandleInboundAsync(first, Sign(first));      // Chatwoot 503
            handler.Fail = true;
            await service.HandleInboundAsync(second, Sign(second));    // bağlantı hatası
        }

        var jobs = await RelayJobsAsync(database);
        Assert.Equal(2, jobs.Count);
        Assert.All(jobs, j => Assert.Equal(ChatwootEventRelay.MaxAttempts, j.MaxAttempts));
        Assert.Equal(2, (await InboundAsync(database, seed.TenantId)).Count); // BeautyAsist işlemesi etkilenmedi

        // Kuyruktan yeniden deneme: Chatwoot hâlâ kapalıysa istisna (kuyruk tekrar dener) ...
        var job = jobs.Single(j => j.PayloadJson.Contains("wamid.QUEUE-1"));
        handler.Fail = false;
        handler.Status = HttpStatusCode.BadGateway;
        await using (var db = database.NewContext())
            await Assert.ThrowsAsync<HttpRequestException>(() => new ChatwootRelayJobHandler(Relay(db, handler)).ExecuteAsync(job.PayloadJson, default));

        // ... açıldığında AYNI baytlar AYNI imzayla gider.
        handler.Requests.Clear();
        handler.Status = HttpStatusCode.OK;
        await using (var db = database.NewContext())
            await new ChatwootRelayJobHandler(Relay(db, handler)).ExecuteAsync(job.PayloadJson, default);
        var replay = Assert.Single(handler.Requests);
        Assert.Equal(Encoding.UTF8.GetBytes(first), replay.Body);
        Assert.Equal(Sign(first), replay.Signature);
    }

    /// <summary>
    /// Doğrudan iletim de kuyruk da başarısızsa istisna YUKARI çıkar: uç 500 döner, Meta olayı yeniden gönderir.
    /// Yutulsaydı olay Chatwoot için sessizce kaybolurdu.
    /// </summary>
    [MySqlFact]
    public async Task RelayAndQueueBothFail_Throws_SoMetaRetries()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        await SeedAsync(database);
        var handler = new CapturingHandler { Fail = true };
        var payload = MessageEvent("wamid.LOST", "EVET");

        await using var db = database.NewContext();
        var service = NewService(db, Relay(db, handler, new ThrowingQueue()));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.HandleInboundAsync(payload, Sign(payload)));
    }

    /// <summary>Kuyruktaki iş çalıştığında iletim adresi kaldırılmışsa olay gönderilmeden kapanır (hata değil).</summary>
    [MySqlFact]
    public async Task QueuedJob_IsClosed_WhenRelayUrlWasRemoved()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        await SeedAsync(database, relayUrl: null);
        var handler = new CapturingHandler();
        var payload = new ChatwootRelayJob(MessageEvent("wamid.LATE", "EVET"), "sha256=00");

        await using var db = database.NewContext();
        await new ChatwootRelayJobHandler(Relay(db, handler)).ExecuteAsync(System.Text.Json.JsonSerializer.Serialize(payload), default);
        Assert.Empty(handler.Requests);
    }

    // ==================== 3) PAYLAŞIMLI NUMARA ====================

    /// <summary>
    /// Numara aynı zamanda destek hattıysa (yalnız yanıtları kaydet): BeautyAsist mesajı olmayan kişinin yazdığı
    /// kurum kaydına girmez ama Chatwoot'a yine iletilir; hatırlatmaya verilen EVET randevuyu onaylar.
    /// </summary>
    [MySqlFact]
    public async Task SharedNumber_RecordsOnlyReplies_ButRelaysEverything()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, repliesOnly: true);
        var handler = new CapturingHandler();
        var support = MessageEvent("wamid.SUPPORT", "Fiyat bilgisi alabilir miyim?");

        await using (var db = database.NewContext())
            await NewService(db, Relay(db, handler)).HandleInboundAsync(support, Sign(support));
        Assert.Empty(await InboundAsync(database, seed.TenantId));
        Assert.Single(handler.Requests);

        await using (var db = database.NewContext())
            Assert.True((await NewService(db, null).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId)).IsSuccess);
        var reply = MessageEvent("wamid.REPLY", "EVET");
        await using (var db = database.NewContext())
            await NewService(db, Relay(db, handler)).HandleInboundAsync(reply, Sign(reply));

        Assert.Single(await InboundAsync(database, seed.TenantId));
        await using var check = database.NewContext();
        var appointment = await check.Appointments.IgnoreQueryFilters().AsNoTracking().FirstAsync(a => a.Id == seed.AppointmentId);
        Assert.Equal(WhatsAppConfirmationStatus.Confirmed, appointment.CustomerConfirmation);
    }

    /// <summary>Bağlamada "yalnız yanıtlar": null = koru (alanı bilmeyen istemci), true/false = yaz.</summary>
    [MySqlFact]
    public async Task RecordRepliesOnly_Binding_KeepsAndSets()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, repliesOnly: true);
        BindWhatsAppConnectionRequest Request(bool? repliesOnly) =>
            new(PhoneNumberId, "waba-rl", "+90 850 242 84 25", "NotConnected", null, null, RecordRepliesOnly: repliesOnly);

        await using (var db = database.NewContext())
            Assert.True((await NewService(db, null).BindConnectionAsync(seed.TenantId, Request(null))).Value!.RecordRepliesOnly);
        await using (var db = database.NewContext())
            Assert.False((await NewService(db, null).BindConnectionAsync(seed.TenantId, Request(false))).Value!.RecordRepliesOnly);
        await using (var db = database.NewContext())
            Assert.True((await NewService(db, null).BindConnectionAsync(seed.TenantId, Request(true))).Value!.RecordRepliesOnly);
    }

    // ==================== 4) ADRES DOĞRULAMASI VE AYAR ====================

    [Theory]
    [InlineData("http://93.184.216.34/webhooks/whatsapp/+90", false)]          // HTTPS değil
    [InlineData("https://kullanici:parola@93.184.216.34/x", false)]           // kullanıcı bilgisi
    [InlineData("https://93.184.216.34:8443/x", false)]                       // varsayılan dışı port
    [InlineData("https://127.0.0.1/webhooks/whatsapp/+90", false)]            // loopback
    [InlineData("https://10.0.0.5/webhooks/whatsapp/+90", false)]             // özel ağ
    [InlineData("https://169.254.169.254/latest/meta-data", false)]           // bulut metadata ucu
    [InlineData("bozuk adres", false)]
    [InlineData("https://93.184.216.34/webhooks/whatsapp/+908502428425", true)]
    [InlineData("", true)]                                                    // boş = iletim kapalı
    public void RelayUrl_IsValidated(string url, bool valid)
    {
        var error = OutboundEndpointGuard.ValidateRelayUrl(url);
        Assert.Equal(valid, error is null);
    }

    /// <summary>
    /// Kayıt kuralı: null = KORU (Maydanoz köprüsünün tam değiştirmeli kaydı iletimi kapatamasın), boş = kapat,
    /// geçersiz adres = doğrulama hatası.
    /// </summary>
    [Fact]
    public async Task RelayUrl_Save_KeepsClearsAndValidates()
    {
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        static SavePlatformMessagingRequest Save(string? relayUrl) => new(
            false, null, null, null, null, null, false, null, null, null, 587, null, null, true, ChatwootRelayUrl: relayUrl);

        await using var db = new GuzellikDbContext(options, null, new TestCurrentUser(UserRole.PlatformAdmin), null, null, TestSearchIndex.Create());
        var service = new PlatformMessagingService(db, Substitute.For<IEncryptionService>(), Substitute.For<IHttpClientFactory>(), NullLogger<PlatformMessagingService>.Instance);

        Assert.Equal(RelayUrl, (await service.SaveSettingsAsync(Save("  " + RelayUrl + " "))).Value!.ChatwootRelayUrl);
        Assert.Equal(RelayUrl, (await service.SaveSettingsAsync(Save(null))).Value!.ChatwootRelayUrl);
        Assert.False((await service.SaveSettingsAsync(Save("http://93.184.216.34/x"))).IsSuccess);
        Assert.Null((await service.SaveSettingsAsync(Save(string.Empty))).Value!.ChatwootRelayUrl);
    }
}

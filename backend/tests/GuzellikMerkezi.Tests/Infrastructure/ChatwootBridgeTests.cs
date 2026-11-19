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
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// CHATWOOT KÖPRÜSÜ (20 Kas 2026) — Meta webhook'u Chatwoot'tayken müşteri yanıtları Chatwoot'un "message_created"
/// webhook'uyla gelir ve Meta'dan gelmiş gibi AYNI yoldan işlenir.
///
/// <para>
/// Üç katman sınanır: (1) kimlik doğrulama — imza (HMAC, zaman damgası) ve adres anahtarı; (2) olay ayrıştırma —
/// yalnız WhatsApp'tan GELEN, herkese açık METİN; (3) uçtan uca — EVET randevuyu onaylar, ONAYLIYORUM KVKK
/// rızasını işler, aynı olay iki kez gelirse bir kez işlenir, bilinmeyen gelen kutusu ve geçersiz imza hiçbir
/// şey yazmaz. Uçtan uca testler GERÇEK MySQL ister (tekilleştirme benzersiz indeksle yapılır).
/// </para>
/// </summary>
public sealed class ChatwootBridgeTests
{
    private const string Secret = "chatwoot-kopru-anahtari-0123456789";
    private const string PhoneNumberId = "148354043150891";
    private const int InboxId = 82;
    private const string CustomerPhone = "905306480225";

    // ==================== 1) KİMLİK DOĞRULAMA ====================

    private static readonly DateTimeOffset Now = DateTimeOffset.FromUnixTimeSeconds(1_795_200_000);

    private static string Sign(string secret, string timestamp, string body) =>
        "sha256=" + Convert.ToHexString(
            HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{timestamp}.{body}"))).ToLowerInvariant();

    [Fact]
    public void ValidSignature_WithinWindow_IsAccepted()
    {
        const string body = "{\"event\":\"message_created\"}";
        var ts = Now.ToUnixTimeSeconds().ToString();
        Assert.True(ChatwootWebhook.IsAuthorized(Secret, body, null, Sign(Secret, ts, body), ts, Now));
        // Büyük harfli hex de kabul (Convert.FromHexString harf duyarsız).
        Assert.True(ChatwootWebhook.IsAuthorized(Secret, body, null, Sign(Secret, ts, body).ToUpperInvariant().Replace("SHA256=", "sha256="), ts, Now));
    }

    [Fact]
    public void Signature_IsRejected_WhenBodySecretOrTimestampDiffer()
    {
        const string body = "{\"event\":\"message_created\"}";
        var ts = Now.ToUnixTimeSeconds().ToString();
        var signature = Sign(Secret, ts, body);

        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body + " ", null, signature, ts, Now));          // gövde değişti
        Assert.False(ChatwootWebhook.IsAuthorized("baska-anahtar", body, null, signature, ts, Now));       // anahtar farklı
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, signature, (Now.ToUnixTimeSeconds() + 1).ToString(), Now)); // damga imzayla uyuşmuyor
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, null, ts, Now));                    // imza yok
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, signature, null, Now));             // damga yok
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, "sha256=zz-not-hex", ts, Now));     // hex değil
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, signature.Replace("sha256=", "md5="), ts, Now));
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, signature, "99999999999999999", Now)); // aralık dışı damga patlatmaz
        Assert.False(ChatwootWebhook.IsAuthorized(string.Empty, body, null, signature, ts, Now));         // anahtar tanımsız
    }

    [Fact]
    public void StaleOrFutureTimestamp_IsRejected_EvenWithCorrectSignature()
    {
        const string body = "{}";
        var old = (Now - ChatwootWebhook.MaxSignatureAge - TimeSpan.FromSeconds(1)).ToUnixTimeSeconds().ToString();
        var future = (Now + ChatwootWebhook.MaxSignatureAge + TimeSpan.FromSeconds(1)).ToUnixTimeSeconds().ToString();
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, Sign(Secret, old, body), old, Now));
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, body, null, Sign(Secret, future, body), future, Now));
    }

    [Fact]
    public void PathToken_IsComparedExactly_AndIgnoresHeaders()
    {
        Assert.True(ChatwootWebhook.IsAuthorized(Secret, "{}", Secret, null, null, Now));
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, "{}", Secret + "x", null, null, Now));
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, "{}", string.Empty, null, null, Now));
        // Adres anahtarı yanlışsa doğru imza da kurtarmaz: yol seçildiyse YALNIZ o geçerli.
        var ts = Now.ToUnixTimeSeconds().ToString();
        Assert.False(ChatwootWebhook.IsAuthorized(Secret, "{}", "yanlis", Sign(Secret, ts, "{}"), ts, Now));
    }

    // ==================== 2) OLAY AYRIŞTIRMA ====================

    private static string Event(
        string text = "EVET", string messageType = "\"incoming\"", bool isPrivate = false, string contentType = "text",
        string channel = "Channel::Whatsapp", int? inboxId = InboxId, string? sourceId = "wamid.CW1",
        string? contactSource = CustomerPhone, string? senderPhone = "+" + CustomerPhone, string @event = "message_created")
    {
        var inbox = inboxId is { } id ? $"\"inbox\":{{\"id\":{id},\"name\":\"Maydanoz Asist WhatsApp\"}}," : string.Empty;
        var source = sourceId is null ? string.Empty : $"\"source_id\":\"{sourceId}\",";
        var contactInbox = contactSource is null ? string.Empty : $",\"contact_inbox\":{{\"source_id\":\"{contactSource}\"}}";
        var sender = senderPhone is null ? "{\"type\":\"contact\"}" : $"{{\"type\":\"contact\",\"phone_number\":\"{senderPhone}\"}}";
        var conversation = $"\"conversation\":{{\"id\":9,\"inbox_id\":{inboxId ?? 0},\"channel\":\"{channel}\"{contactInbox}}},";
        return "{" +
            $"\"event\":\"{@event}\",\"id\":555,\"content\":\"{text}\",\"message_type\":{messageType},\"private\":{(isPrivate ? "true" : "false")}," +
            $"\"content_type\":\"{contentType}\",{source}{inbox}{conversation}" +
            $"\"sender\":{sender},\"account\":{{\"id\":19,\"name\":\"Maydanoz Asist\"}}" +
            "}";
    }

    [Fact]
    public void IncomingWhatsAppText_IsParsed()
    {
        var inbound = ChatwootWebhook.Parse(Event());
        Assert.NotNull(inbound);
        Assert.Equal(InboxId, inbound!.InboxId);
        Assert.Equal(CustomerPhone, inbound.FromPhone);
        Assert.Equal("EVET", inbound.Text);
        Assert.Equal("wamid.CW1", inbound.MessageId);
    }

    [Fact]
    public void NumericIncomingType_AndFallbacks_AreAccepted()
    {
        // API biçimi: message_type sayı (0 = incoming).
        Assert.NotNull(ChatwootWebhook.Parse(Event(messageType: "0")));
        // source_id yoksa Chatwoot mesaj kimliği tekilleştirme anahtarı olur.
        Assert.Equal("cw:555", ChatwootWebhook.Parse(Event(sourceId: null))!.MessageId);
        // contact_inbox yoksa göndericinin numarası (+ işareti atılır).
        Assert.Equal(CustomerPhone, ChatwootWebhook.Parse(Event(contactSource: null))!.FromPhone);
        // "inbox" nesnesi yoksa konuşmanın inbox_id'si.
        var withoutInboxObject = Event().Replace($"\"inbox\":{{\"id\":{InboxId},\"name\":\"Maydanoz Asist WhatsApp\"}},", string.Empty);
        Assert.Equal(InboxId, ChatwootWebhook.Parse(withoutInboxObject)!.InboxId);
    }

    [Theory]
    [InlineData("outgoing")]
    [InlineData("private")]
    [InlineData("attachment")]
    [InlineData("other-channel")]
    [InlineData("other-event")]
    [InlineData("no-inbox")]
    [InlineData("no-phone")]
    [InlineData("empty-text")]
    [InlineData("outgoing-number")]
    public void NonCustomerTextEvents_AreIgnored(string kind)
    {
        var payload = kind switch
        {
            "outgoing" => Event(messageType: "\"outgoing\""),
            "private" => Event(isPrivate: true),
            "attachment" => Event(contentType: "input_select"),
            "other-channel" => Event(channel: "Channel::WebWidget"),
            "other-event" => Event(@event: "message_updated"),
            "no-inbox" => Event(inboxId: null),
            "no-phone" => Event(contactSource: null, senderPhone: null),
            "empty-text" => Event(text: "   "),
            "outgoing-number" => Event(messageType: "1"),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        Assert.Null(ChatwootWebhook.Parse(payload));
    }

    [Fact]
    public void NonObjectPayload_IsIgnored_AndBrokenJsonThrows()
    {
        Assert.Null(ChatwootWebhook.Parse("[]"));
        Assert.ThrowsAny<System.Text.Json.JsonException>(() => ChatwootWebhook.Parse("{bozuk"));
    }

    // ==================== 3) UÇTAN UCA (gerçek MySQL) ====================

    private static IEncryptionService IdentityEncryption()
    {
        var encryption = Substitute.For<IEncryptionService>();
        encryption.Encrypt(Arg.Any<string?>()).Returns(call => call.ArgAt<string?>(0) is { } p ? "enc:" + p : null);
        encryption.Decrypt(Arg.Any<string?>()).Returns(call => call.ArgAt<string?>(0) is { } c && c.StartsWith("enc:") ? c[4..] : null);
        return encryption;
    }

    private static WhatsAppService NewService(GuzellikDbContext db, IAppNotificationService? notifications = null)
    {
        var billing = Substitute.For<IWhatsAppBillingService>();
        billing.ReserveAsync(Arg.Any<Guid>(), Arg.Any<WhatsAppMessageCategory>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(call => BillingDecision.Free(call.ArgAt<WhatsAppMessageCategory>(1), WhatsAppBillingSource.Quota));
        var kvkk = Substitute.For<IKvkkDocumentService>();
        kvkk.BuildPdfAsync(Arg.Any<Guid>(), Arg.Any<string?>(), Arg.Any<CancellationToken>()).Returns(Task.FromResult<byte[]?>(null));
        return new WhatsAppService(
            db,
            IdentityEncryption(),
            Substitute.For<IHttpClientFactory>(),
            new ConfigurationBuilder().Build(),
            NullLogger<WhatsAppService>.Instance,
            new AllowAllFeatureService(),
            billing,
            new TestCurrentUser(UserRole.InstitutionOwner),
            Substitute.For<IWaitlistService>(),
            notifications ?? Substitute.For<IAppNotificationService>(),
            kvkk,
            Substitute.For<IServiceProvider>());
    }

    private sealed record Seed(Guid TenantId, Guid CustomerId, Guid AppointmentId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database, bool withSecret = true)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Chatwoot Kopru", $"cw-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "Erzurum", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "AYSE YILMAZ", CustomerPhone, null);
        db.Customers.Add(customer);
        // Bağlantı bilerek "Connected" DEĞİL: gönderim simülasyon yolundan gider (ağ yok), satırlar yine yazılır.
        var settings = new WhatsAppSettings(tenant.Id);
        settings.BindConnection(PhoneNumberId, "waba-cw", "+90 850 242 84 25", WhatsAppConnectionStatus.NotConnected);
        settings.SetChatwootInbox(InboxId);
        db.WhatsAppSettings.Add(settings);
        if (withSecret)
        {
            var platform = new PlatformIntegrationSettings();
            platform.UpdateChatwootBridge("enc:" + Secret);
            db.PlatformIntegrationSettings.Add(platform);
        }

        var staff = new StaffMember(tenant.Id, branch.Id, "UZMAN", "Uzman");
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m);
        db.StaffMembers.Add(staff);
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var start = DateTime.UtcNow.AddHours(20);
        var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, start, start.AddHours(1), 0m);
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();
        return new Seed(tenant.Id, customer.Id, appointment.Id);
    }

    private static (string Body, string Signature, string Timestamp) Signed(string body)
    {
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        return (body, Sign(Secret, ts, body), ts);
    }

    private static async Task<List<WhatsAppMessage>> InboundAsync(MySqlTestDatabase database, Guid tenantId)
    {
        await using var check = database.NewContext();
        return await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == tenantId && m.Direction == WhatsAppMessageDirection.Inbound)
            .ToListAsync();
    }

    /// <summary>Hatırlatmaya Chatwoot'tan gelen EVET randevuyu onaylar; satır Meta kimliğiyle (wamid) yazılır.</summary>
    [MySqlFact]
    public async Task ReminderReply_ThroughChatwoot_ConfirmsAppointment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await using (var db = database.NewContext())
            Assert.True((await NewService(db).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId)).IsSuccess);

        var (body, signature, ts) = Signed(Event(text: "EVET", sourceId: "wamid.CW-EVET"));
        await using (var db = database.NewContext())
            Assert.True(await NewService(db).HandleChatwootInboundAsync(body, null, signature, ts));

        var inbound = Assert.Single(await InboundAsync(database, seed.TenantId));
        Assert.Equal("wamid.CW-EVET", inbound.ProviderMessageId);
        Assert.Equal(PhoneNumberId, inbound.ProviderChannelId);
        await using var check = database.NewContext();
        var appointment = await check.Appointments.IgnoreQueryFilters().AsNoTracking().FirstAsync(a => a.Id == seed.AppointmentId);
        Assert.Equal(WhatsAppConfirmationStatus.Confirmed, appointment.CustomerConfirmation);
    }

    /// <summary>Chatwoot aynı olayı tekrar gönderirse (yeniden deneme) yanıt BİR kez işlenir.</summary>
    [MySqlFact]
    public async Task RedeliveredEvent_IsProcessedOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await using (var db = database.NewContext())
            await NewService(db).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId);

        var notifications = Substitute.For<IAppNotificationService>();
        var (body, signature, ts) = Signed(Event(text: "EVET", sourceId: "wamid.CW-REPLAY"));
        for (var i = 0; i < 2; i++)
        {
            await using var db = database.NewContext();
            Assert.True(await NewService(db, notifications).HandleChatwootInboundAsync(body, null, signature, ts));
        }

        Assert.Single(await InboundAsync(database, seed.TenantId));
        await notifications.Received(1).NotifyRolesAsync(
            Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<IReadOnlyCollection<UserRole>>(),
            Arg.Any<AppNotificationType>(), Arg.Any<AppNotificationSeverity>(),
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<object?>(), Arg.Any<string?>(),
            Arg.Any<bool>(), Arg.Any<CancellationToken>());
    }

    /// <summary>KVKK isteğine Chatwoot'tan gelen ONAYLIYORUM müşterinin açık rızasını işler.</summary>
    [MySqlFact]
    public async Task KvkkConsent_ThroughChatwoot_IsRecorded()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await using (var db = database.NewContext())
            await NewService(db).SendKvkkConsentRequestAsync(seed.TenantId, seed.CustomerId);

        var (body, signature, ts) = Signed(Event(text: "ONAYLIYORUM", sourceId: "wamid.CW-KVKK"));
        await using (var db = database.NewContext())
            Assert.True(await NewService(db).HandleChatwootInboundAsync(body, null, signature, ts));

        await using var check = database.NewContext();
        var customer = await check.Customers.IgnoreQueryFilters().AsNoTracking().FirstAsync(c => c.Id == seed.CustomerId);
        Assert.True(customer.KvkkConsent);
    }

    /// <summary>İmzasız Chatwoot sürümü: adresteki anahtar doğruysa işlenir.</summary>
    [MySqlFact]
    public async Task PathTokenMode_IsAccepted()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await using (var db = database.NewContext())
            Assert.True(await NewService(db).HandleChatwootInboundAsync(Event(sourceId: "wamid.CW-PATH"), Secret, null, null));
        Assert.Single(await InboundAsync(database, seed.TenantId));
    }

    /// <summary>Geçersiz imza, yanlış adres anahtarı ve tanımsız anahtar HİÇBİR satır yazmaz ve 401 döner (false).</summary>
    [MySqlFact]
    public async Task UnauthenticatedRequests_WriteNothing()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var body = Event(sourceId: "wamid.CW-FORGED");
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        await using (var db = database.NewContext())
        {
            var service = NewService(db);
            Assert.False(await service.HandleChatwootInboundAsync(body, null, Sign("tahmin", ts, body), ts));
            Assert.False(await service.HandleChatwootInboundAsync(body, "tahmin", null, null));
            Assert.False(await service.HandleChatwootInboundAsync(body, null, null, null));
        }
        Assert.Empty(await InboundAsync(database, seed.TenantId));

        // Anahtar hiç tanımlanmamışsa (fail-closed) doğru biçimli istek de reddedilir.
        await using var other = await MySqlTestDatabase.CreateAsync();
        var unconfigured = await SeedAsync(other, withSecret: false);
        await using (var db = other.NewContext())
            Assert.False(await NewService(db).HandleChatwootInboundAsync(body, Secret, null, null));
        Assert.Empty(await InboundAsync(other, unconfigured.TenantId));
    }

    /// <summary>Hiçbir kuruma bağlı olmayan gelen kutusu (ör. test numarası) 200 alır ama yok sayılır.</summary>
    [MySqlFact]
    public async Task UnknownInbox_IsAcknowledgedButIgnored()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var (body, signature, ts) = Signed(Event(inboxId: 999, sourceId: "wamid.CW-OTHER"));
        await using (var db = database.NewContext())
            Assert.True(await NewService(db).HandleChatwootInboundAsync(body, null, signature, ts));
        Assert.Empty(await InboundAsync(database, seed.TenantId));
    }

    // ==================== 4) BAĞLAMA VE AYAR KURALLARI ====================

    /// <summary>
    /// Gelen kutusu kimliği: null = KORU (alanı bilmeyen istemci bağı silmez), 0 = kaldır, başka kurumdaki kimlik = çakışma.
    /// </summary>
    [MySqlFact]
    public async Task ChatwootInbox_Binding_KeepsClearsAndRejectsClash()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        BindWhatsAppConnectionRequest Request(int? inbox) =>
            new(PhoneNumberId, "waba-cw", "+90 850 242 84 25", "NotConnected", null, null, ChatwootInboxId: inbox);

        await using (var db = database.NewContext())
        {
            var kept = await NewService(db).BindConnectionAsync(seed.TenantId, Request(null));
            Assert.True(kept.IsSuccess, kept.Error?.Message);
            Assert.Equal(InboxId, kept.Value!.ChatwootInboxId);
        }

        // Başka bir kurum aynı gelen kutusunu alamaz.
        Guid otherTenantId;
        await using (var db = database.NewContext())
        {
            var other = new Tenant("Diger Kurum", $"cw-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            other.AddBranch("Merkez", "Ankara", true);
            db.Tenants.Add(other);
            await db.SaveChangesAsync();
            otherTenantId = other.Id;
        }
        await using (var db = database.NewContext())
        {
            var clash = await NewService(db).BindConnectionAsync(otherTenantId,
                new BindWhatsAppConnectionRequest("999000111222333", null, null, "NotConnected", null, null, ChatwootInboxId: InboxId));
            Assert.False(clash.IsSuccess);
            // Mesaj bağın NEREDE olduğunu söyler: yönetici önce oradan kaldırabilsin.
            Assert.Contains("Chatwoot Kopru", clash.Error!.Message);
        }

        await using (var db = database.NewContext())
        {
            var cleared = await NewService(db).BindConnectionAsync(seed.TenantId, Request(0));
            Assert.True(cleared.IsSuccess, cleared.Error?.Message);
            Assert.Null(cleared.Value!.ChatwootInboxId);
        }
    }

    /// <summary>Köprü anahtarı şifreli saklanır, yalnız "tanımlı mı" döner; boş kayıt mevcut anahtarı KORUR.</summary>
    [Fact]
    public async Task PlatformSecret_IsWriteOnly_AndEmptyKeepsIt()
    {
        var options = new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        var user = new TestCurrentUser(UserRole.PlatformAdmin);
        static SavePlatformMessagingRequest Save(string? secret) => new(
            false, null, null, null, null, null, false, null, null, null, 587, null, null, true,
            ChatwootWebhookSecret: secret);

        await using (var db = new GuzellikDbContext(options, null, user, null, null, TestSearchIndex.Create()))
        {
            var service = new PlatformMessagingService(db, IdentityEncryption(), Substitute.For<IHttpClientFactory>(), NullLogger<PlatformMessagingService>.Instance);
            var saved = await service.SaveSettingsAsync(Save("  " + Secret + "  "));
            Assert.True(saved.IsSuccess, saved.Error?.Message);
            Assert.True(saved.Value!.HasChatwootWebhookSecret);

            var kept = await service.SaveSettingsAsync(Save(null));
            Assert.True(kept.Value!.HasChatwootWebhookSecret);
        }

        await using (var db = new GuzellikDbContext(options, null, user, null, null, TestSearchIndex.Create()))
        {
            var stored = await db.PlatformIntegrationSettings.AsNoTracking().SingleAsync();
            Assert.Equal("enc:" + Secret, stored.ChatwootWebhookSecretEncrypted); // kırpılmış ve şifreli
        }
    }
}

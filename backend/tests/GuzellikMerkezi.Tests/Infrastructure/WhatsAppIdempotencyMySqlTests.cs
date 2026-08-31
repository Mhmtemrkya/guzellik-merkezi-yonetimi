using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MÜKERRER GÖNDERİM VE MÜKERRER İŞLEME — iki eşzamanlılık açığının regresyon koruması.
///
/// <para>
/// İkisi de yalnız GERÇEK veritabanında görünür: InMemory sağlayıcı satır kilidi uygulamaz ve
/// benzersiz indeksi aynı biçimde zorlamaz, dolayısıyla iki eşzamanlı yazma orada hep "başarılı"
/// olur. Bu yüzden testler ayrı DbContext (= ayrı bağlantı) kullanır — tek bağlamda çalıştırmak
/// yarışı hiç kurmaz ve test kusuru yakalamadan yeşil yanar.
/// </para>
///
/// <list type="number">
/// <item><b>Zamanlayıcı mükerrer hatırlatması:</b> arka plan taraması randevuyu
/// <c>LastReminderAtUtc IS NULL</c> ile seçip damgayı gönderim SONRASI vuruyordu. İki API örneği
/// aynı randevuyu aynı anda seçebiliyor, müşteriye aynı hatırlatma iki kez gidiyor ve kontör iki kez
/// rezerve ediliyordu.</item>
/// <item><b>Webhook tekrar teslimi:</b> Meta 200 alamadığını sandığı webhook'u TEKRAR gönderir.
/// Mesaj kimliği (wamid) saklanmadığı için aynı yanıt ikinci kez işleniyor, randevu onayı/iptali ve
/// KVKK gibi domain yan etkileri TEKRARLANIYORDU.</item>
/// </list>
/// </summary>
public sealed class WhatsAppIdempotencyMySqlTests
{
    private const string AppSecret = "test-app-secret";
    private const string PhoneNumberId = "111222333444555";
    private const string CustomerPhone = "905551112233";

    /// <summary>
    /// Gerçek gönderim YOLA ÇIKMAZ ama simülasyon da değildir: bağlantı "Connected" olduğunda
    /// <c>ResolveSendContextAsync</c> token arar. Test kapsamı yarış davranışıdır, ağ değil —
    /// bu yüzden bağlantı bilerek BAĞLANMAMIŞ bırakılır (simülasyon yolu) ve doğrulanan şey
    /// "kaç mesaj SATIRI oluştu" olur. Mükerrer gönderim mükerrer satır demektir.
    /// </summary>
    private static WhatsAppService NewService(GuzellikDbContext db, IAppNotificationService? notifications = null)
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
            notifications ?? Substitute.For<IAppNotificationService>(),
            Substitute.For<IKvkkDocumentService>(),
            Substitute.For<IServiceProvider>());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid AppointmentId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("WA Yaris", $"wa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "YARIS MUSTERI", CustomerPhone, null);
        db.Customers.Add(customer);

        var settings = new WhatsAppSettings(tenant.Id);
        settings.BindConnection(PhoneNumberId, "waba-1", "+90 555 111 22 33", WhatsAppConnectionStatus.NotConnected);
        db.WhatsAppSettings.Add(settings);

        // GERÇEK personel + hizmet: uydurma kimlikler gerçek veritabanında yabancı anahtara takılır
        // (InMemory'de takılmazdı — bu testin gerçek şemada koşmasının bir sebebi daha).
        var staff = new StaffMember(tenant.Id, branch.Id, "YARIS PERSONEL", "Uzman");
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m);
        db.StaffMembers.Add(staff);
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var start = DateTime.UtcNow.AddHours(6);
        var appointment = new Appointment(tenant.Id, branch.Id, customer.Id,
            staff.Id, service.Id, start, start.AddHours(1), 0m);
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, appointment.Id);
    }

    // ==================== 1) ZAMANLAYICI: MÜKERRER HATIRLATMA ====================

    /// <summary>
    /// İki örnek aynı randevuyu aynı anda hatırlatmaya kalkarsa YALNIZ BİRİ sağlayıcıya gider.
    ///
    /// <para>
    /// Düzeltmeden önce bu test iki <c>reminder</c> satırı görüyordu: seçim ile damga arasındaki
    /// boşlukta ikisi de randevuyu "damgasız" buluyordu. Artık sahiplenme tek koşullu UPDATE ile
    /// yapılır; kaybeden taraf hiçbir yan etki üretmez.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentAutomaticReminders_SendOnlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // AYRI BAĞLAM = AYRI BAĞLANTI. Tek bağlamda çalıştırmak yarışı hiç kurmazdı.
        await using var dbA = database.NewContext();
        await using var dbB = database.NewContext();

        var first = NewService(dbA).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId);
        var second = NewService(dbB).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId);
        var results = await Task.WhenAll(first, second);

        // İkisi de HATA vermemeli: yarışı kaybetmek bir kusur değil, no-op'tur.
        Assert.All(results, r => Assert.True(r.IsSuccess, r.Error?.Message));
        Assert.Single(results, r => r.Value is { Sent: true });

        await using var check = database.NewContext();
        var reminders = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == seed.TenantId
                        && m.Direction == WhatsAppMessageDirection.Outbound
                        && m.TemplateName == "reminder")
            .ToListAsync();
        Assert.Single(reminders);

        var appointment = await check.Appointments.IgnoreQueryFilters().AsNoTracking()
            .FirstAsync(a => a.Id == seed.AppointmentId);
        Assert.NotNull(appointment.LastReminderAtUtc);
        Assert.Equal(WhatsAppConfirmationStatus.Pending, appointment.CustomerConfirmation);
    }

    /// <summary>Sıralı ikinci tur da göndermez — damga kalıcıdır (zamanlayıcı 15 dk'da bir çalışır).</summary>
    [MySqlFact]
    public async Task SecondAutomaticSweep_DoesNotResend()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
            await NewService(db).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId);

        await using (var db = database.NewContext())
        {
            var again = await NewService(db).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId);
            Assert.True(again.IsSuccess);
            Assert.False(again.Value!.Sent);
        }

        await using var check = database.NewContext();
        var count = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == seed.TenantId && m.TemplateName == "reminder");
        Assert.Equal(1, count);
    }

    /// <summary>
    /// ELLE gönderim kısıtlanmadı: yönetici randevu ertelendiğinde aynı randevuyu bilerek tekrar
    /// hatırlatabilmeli. Sahiplenme YALNIZ otomatik yolun kuralıdır.
    /// </summary>
    [MySqlFact]
    public async Task ManualReminder_MayBeSentAgain()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // Mükerrer koruması (30 dk "sonucu bilinmeyen deneme") YALNIZ Queued satırlar içindir;
        // simülasyonda satır Simulated'a döndüğü için elle ikinci gönderim serbesttir.
        await using (var db = database.NewContext())
            Assert.True((await NewService(db).SendReminderAsync(seed.TenantId, seed.AppointmentId)).IsSuccess);
        await using (var db = database.NewContext())
            Assert.True((await NewService(db).SendReminderAsync(seed.TenantId, seed.AppointmentId)).IsSuccess);

        await using var check = database.NewContext();
        var count = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == seed.TenantId && m.TemplateName == "reminder");
        Assert.Equal(2, count);
    }

    // ==================== 2) WEBHOOK: TEKRAR TESLİM ====================

    private static string InboundPayload(string wamid, string text) => $$"""
    {
      "entry": [{
        "changes": [{
          "value": {
            "metadata": { "phone_number_id": "{{PhoneNumberId}}" },
            "messages": [{
              "id": "{{wamid}}",
              "from": "{{CustomerPhone}}",
              "type": "text",
              "text": { "body": "{{text}}" }
            }]
          }
        }]
      }]
    }
    """;

    private static string Sign(string payload) =>
        "sha256=" + Convert.ToHexString(
            HMACSHA256.HashData(Encoding.UTF8.GetBytes(AppSecret), Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

    /// <summary>Gelen yanıtın randevuya bağlanabilmesi için önce bir giden hatırlatma gerekir.</summary>
    private static async Task SendReminderAsync(MySqlTestDatabase database, Seed seed)
    {
        await using var db = database.NewContext();
        var result = await NewService(db).SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId);
        Assert.True(result.IsSuccess, result.Error?.Message);
    }

    /// <summary>
    /// AYNI wamid iki kez teslim edilirse ikinci teslim HİÇBİR şey yapmaz.
    ///
    /// <para>
    /// Düzeltmeden önce ikinci teslim ikinci bir gelen satır yazıyor ve yöneticiye ikinci bir
    /// bildirim gönderiyordu; iptal niyetinde ise randevu ikinci kez iptal ediliyordu.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task ReplayedWebhook_IsProcessedOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        var payload = InboundPayload("wamid.REPLAY1", "EVET");
        var signature = Sign(payload);
        var notifications = Substitute.For<IAppNotificationService>();

        await using (var db = database.NewContext())
            await NewService(db, notifications).HandleInboundAsync(payload, signature);
        await using (var db = database.NewContext())
            await NewService(db, notifications).HandleInboundAsync(payload, signature);

        await using var check = database.NewContext();
        var inbound = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == seed.TenantId && m.Direction == WhatsAppMessageDirection.Inbound)
            .ToListAsync();
        Assert.Single(inbound);
        Assert.Equal("wamid.REPLAY1", inbound[0].ProviderMessageId);
        Assert.Equal(PhoneNumberId, inbound[0].ProviderChannelId);

        // DOMAIN YAN ETKİSİ DE BİR KEZ: yöneticiye tek bildirim gitti.
        await notifications.Received(1).NotifyRolesAsync(
            Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<IReadOnlyCollection<UserRole>>(),
            Arg.Any<AppNotificationType>(), Arg.Any<AppNotificationSeverity>(),
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<object?>(), Arg.Any<string?>(),
            Arg.Any<bool>(), Arg.Any<CancellationToken>());

        var appointment = await check.Appointments.IgnoreQueryFilters().AsNoTracking()
            .FirstAsync(a => a.Id == seed.AppointmentId);
        Assert.Equal(WhatsAppConfirmationStatus.Confirmed, appointment.CustomerConfirmation);
    }

    /// <summary>Aynı webhook AYNI ANDA iki kez teslim edilirse de tek kez işlenir (indeks zorlar).</summary>
    [MySqlFact]
    public async Task ConcurrentWebhookDelivery_IsProcessedOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        var payload = InboundPayload("wamid.CONCURRENT1", "EVET");
        var signature = Sign(payload);

        await using var dbA = database.NewContext();
        await using var dbB = database.NewContext();
        await Task.WhenAll(
            NewService(dbA).HandleInboundAsync(payload, signature),
            NewService(dbB).HandleInboundAsync(payload, signature));

        await using var check = database.NewContext();
        var inbound = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == seed.TenantId && m.Direction == WhatsAppMessageDirection.Inbound);
        Assert.Equal(1, inbound);
    }

    /// <summary>
    /// AŞIRI ELEME YOK: aynı metni taşıyan FARKLI mesajlar ayrı kalır. Müşteri iki kez "EVET"
    /// yazdıysa bu iki ayrı mesajdır; gövdeye göre tekilleştirmek gerçek yanıtı yutardı.
    /// </summary>
    [MySqlFact]
    public async Task DistinctMessageIds_AreKeptSeparate()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        foreach (var wamid in new[] { "wamid.FIRST", "wamid.SECOND" })
        {
            var payload = InboundPayload(wamid, "EVET");
            await using var db = database.NewContext();
            await NewService(db).HandleInboundAsync(payload, Sign(payload));
        }

        await using var check = database.NewContext();
        var inbound = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == seed.TenantId && m.Direction == WhatsAppMessageDirection.Inbound);
        Assert.Equal(2, inbound);
    }
}

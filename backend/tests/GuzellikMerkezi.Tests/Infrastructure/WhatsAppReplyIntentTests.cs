using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.Appointments;
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
/// AKILLI MÜŞTERİ YANITI (20 Kas 2026 canlı testinden): niyet motoru, yanıtın hangi mesaja verildiği, anlaşılamayan
/// yanıtın yöneticiye düşmesi, Bildirimler'den gönderilen hatırlatmanın randevuya bağlanması, KVKK isteğinin
/// mükerrer gitmemesi ve taşınan randevunun yeniden sorulması.
/// </summary>
public sealed class WhatsAppReplyIntentTests
{
    // ==================== 1) NİYET MOTORU ====================

    [Theory]
    // Onay
    [InlineData("EVET", WhatsAppReplyIntent.Confirm)]
    [InlineData("evettt", WhatsAppReplyIntent.Confirm)]
    [InlineData("Evvet", WhatsAppReplyIntent.Confirm)]
    [InlineData("1", WhatsAppReplyIntent.Confirm)]
    [InlineData("tmm", WhatsAppReplyIntent.Confirm)]
    [InlineData("Ok 👍", WhatsAppReplyIntent.Confirm)]
    [InlineData("👍", WhatsAppReplyIntent.Confirm)]
    [InlineData("Geleceğim", WhatsAppReplyIntent.Confirm)]
    [InlineData("gelcem", WhatsAppReplyIntent.Confirm)]
    [InlineData("geliyom", WhatsAppReplyIntent.Confirm)]
    [InlineData("Gelebilirim", WhatsAppReplyIntent.Confirm)]
    [InlineData("ONAYLIYORUM", WhatsAppReplyIntent.Confirm)]
    [InlineData("Oradayım", WhatsAppReplyIntent.Confirm)]
    [InlineData("sorun yok", WhatsAppReplyIntent.Confirm)]
    [InlineData("Olur", WhatsAppReplyIntent.Confirm)]
    [InlineData("Hayır, geleceğim", WhatsAppReplyIntent.Confirm)]          // fiil kelimeden üstün
    [InlineData("İptal etmeyin, geleceğim", WhatsAppReplyIntent.Confirm)]
    [InlineData("Evet, saatinde geliyorum", WhatsAppReplyIntent.Confirm)]  // zaman kelimesi var, değiştirme fiili yok
    // İptal
    [InlineData("HAYIR", WhatsAppReplyIntent.Cancel)]
    [InlineData("Gelemeyeceğim", WhatsAppReplyIntent.Cancel)]
    [InlineData("gelemeyecem", WhatsAppReplyIntent.Cancel)]
    [InlineData("gelemicem", WhatsAppReplyIntent.Cancel)]
    [InlineData("Gelmeyeceğim", WhatsAppReplyIntent.Cancel)]
    [InlineData("gelmiyom", WhatsAppReplyIntent.Cancel)]
    [InlineData("gelemem", WhatsAppReplyIntent.Cancel)]
    [InlineData("Evet ama gelemeyeceğim", WhatsAppReplyIntent.Cancel)]    // fiil kelimeden üstün
    [InlineData("İptal etmek istiyorum", WhatsAppReplyIntent.Cancel)]
    [InlineData("vazgeçtim", WhatsAppReplyIntent.Cancel)]
    [InlineData("Müsait değilim", WhatsAppReplyIntent.Cancel)]
    [InlineData("katılamayacağım", WhatsAppReplyIntent.Cancel)]
    [InlineData("onaylamıyorum", WhatsAppReplyIntent.Cancel)]
    [InlineData("Maalesef", WhatsAppReplyIntent.Cancel)]
    [InlineData("yok", WhatsAppReplyIntent.Cancel)]
    [InlineData("❌", WhatsAppReplyIntent.Cancel)]
    [InlineData("2", WhatsAppReplyIntent.Cancel)]
    // Erteleme
    [InlineData("ERTELE", WhatsAppReplyIntent.Reschedule)]
    [InlineData("Ertelesek mi?", WhatsAppReplyIntent.Reschedule)]
    [InlineData("erteleyebilir miyiz", WhatsAppReplyIntent.Reschedule)]
    [InlineData("Başka gün olur mu", WhatsAppReplyIntent.Reschedule)]
    [InlineData("başka bir güne alalım", WhatsAppReplyIntent.Reschedule)]
    [InlineData("Saatini değiştirebilir miyiz", WhatsAppReplyIntent.Reschedule)]
    [InlineData("Gelemem, başka saate alabilir miyiz", WhatsAppReplyIntent.Reschedule)]
    [InlineData("haftaya alalım", WhatsAppReplyIntent.Reschedule)]
    [InlineData("öne alabilir miyiz", WhatsAppReplyIntent.Reschedule)]
    [InlineData("ileri bir tarihe", WhatsAppReplyIntent.Reschedule)]
    [InlineData("randevuyu kaydırabilir misiniz", WhatsAppReplyIntent.Reschedule)]
    [InlineData("Saat 3'e çekebilir miyiz", WhatsAppReplyIntent.Reschedule)]
    [InlineData("gelecek hafta gelebilir miyim", WhatsAppReplyIntent.Reschedule)] // "gelecek hafta" onay sanılmaz
    [InlineData("müsait değilim başka gün olur mu", WhatsAppReplyIntent.Reschedule)]
    [InlineData("3", WhatsAppReplyIntent.Reschedule)]
    // Anlaşılamadı → yöneticiye düşer, tahmin edilmez
    [InlineData("Geç kalacağım", WhatsAppReplyIntent.Unknown)]
    [InlineData("Saat kaçtaydı?", WhatsAppReplyIntent.Unknown)]
    [InlineData("Teşekkürler", WhatsAppReplyIntent.Unknown)]
    [InlineData("Evet hayır", WhatsAppReplyIntent.Unknown)]
    [InlineData("geleceğim ama gelemeyebilirim", WhatsAppReplyIntent.Unknown)]
    [InlineData("yarın olur mu", WhatsAppReplyIntent.Reschedule)]             // tarih + öneri işareti
    [InlineData("Cuma 15:00'te gelsem olur mu?", WhatsAppReplyIntent.Reschedule)]
    [InlineData("yarın saat 3 uygun mu", WhatsAppReplyIntent.Reschedule)]
    [InlineData("Yarın 14:00'te geleceğim", WhatsAppReplyIntent.Confirm)]      // zaman var ama öneri değil, onay
    [InlineData("", WhatsAppReplyIntent.Unknown)]
    public void Interpreter_UnderstandsNaturalTurkishReplies(string text, WhatsAppReplyIntent expected) =>
        Assert.Equal(expected, WhatsAppReplyInterpreter.Interpret(text));

    // ==================== 1b) ZAMAN ÖNERİSİ AYRIŞTIRICI ====================

    // "Şimdi" = 20 Kasım 2026 Cuma 10:00 (Türkiye).
    private static readonly DateTime NowLocal = new(2026, 11, 20, 10, 0, 0);

    [Theory]
    [InlineData("Cuma 15:00'te gelsem olur mu", "2026-11-27", "15:00")]   // bugün cuma → gelecek cuma
    [InlineData("yarın saat 3 uygun mu", "2026-11-21", "15:00")]          // salon saati: 3 = 15:00
    [InlineData("21 Kasım 14.30", "2026-11-21", "14:30")]
    [InlineData("21.11 saat 16", "2026-11-21", "16:00")]
    [InlineData("haftaya salı öğleden sonra 2", "2026-11-24", "14:00")]
    [InlineData("pazartesi sabah 10'da", "2026-11-23", "10:00")]
    [InlineData("akşam 6 olur mu", null, "18:00")]
    [InlineData("3 buçukta gelsem", null, "15:30")]
    [InlineData("öbür gün", "2026-11-22", null)]
    [InlineData("ayın 25i uygun mu", "2026-11-25", null)]
    [InlineData("öğlen gelebilir miyim", null, "12:00")]
    [InlineData("5 ocak", "2027-01-05", null)]                            // geçmiş tarih → gelecek yıl
    public void Parser_ReadsTurkishDatesAndTimes(string text, string? date, string? time)
    {
        var p = WhatsAppTimeProposalParser.Parse(text, NowLocal);
        Assert.Equal(date, p.Date?.ToString("yyyy-MM-dd"));
        Assert.Equal(time, p.Time?.ToString("HH:mm"));
    }

    [Fact]
    public void Parser_FindsNothingInPlainText() => Assert.True(WhatsAppTimeProposalParser.Parse("Teşekkürler", NowLocal).IsEmpty);

    // ==================== 2) TAŞINAN RANDEVU YENİDEN SORULUR ====================

    [Fact]
    public void Reschedule_ClearsCustomerReply_AndReminderStamp_OnlyWhenStartChanges()
    {
        var start = DateTime.UtcNow.AddDays(1);
        var appointment = new Appointment(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), start, start.AddHours(1), 0m);
        appointment.MarkReminderSent();
        appointment.SetCustomerConfirmation(WhatsAppConfirmationStatus.RescheduleRequested);

        appointment.Reschedule(start, start.AddHours(2)); // yalnız bitiş uzadı: soru değişmedi
        Assert.Equal(WhatsAppConfirmationStatus.RescheduleRequested, appointment.CustomerConfirmation);
        Assert.NotNull(appointment.LastReminderAtUtc);

        appointment.Reschedule(start.AddDays(2), start.AddDays(2).AddHours(1)); // yeni saat
        Assert.Equal(WhatsAppConfirmationStatus.None, appointment.CustomerConfirmation);
        Assert.Null(appointment.LastReminderAtUtc); // otomatik tarama yeni saati tekrar hatırlatır
    }

    // ==================== 3) UÇTAN UCA (gerçek MySQL) ====================

    private const string AppSecret = "intent-test-app-secret";
    private const string PhoneNumberId = "148354043150891";
    private const string CustomerPhone = "905306480225";

    private sealed record Harness(WhatsAppService Service, IAppNotificationService Notifications, IAppointmentService Appointments);

    private static Harness NewService(GuzellikDbContext db)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["WhatsApp:AppSecret"] = AppSecret })
            .Build();
        var billing = Substitute.For<IWhatsAppBillingService>();
        billing.ReserveAsync(Arg.Any<Guid>(), Arg.Any<WhatsAppMessageCategory>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(call => BillingDecision.Free(call.ArgAt<WhatsAppMessageCategory>(1), WhatsAppBillingSource.Quota));
        var notifications = Substitute.For<IAppNotificationService>();
        var appointments = Substitute.For<IAppointmentService>();
        var services = Substitute.For<IServiceProvider>();
        services.GetService(typeof(IAppointmentService)).Returns(appointments);
        var kvkk = Substitute.For<IKvkkDocumentService>();
        kvkk.BuildPdfAsync(Arg.Any<Guid>(), Arg.Any<string?>(), Arg.Any<CancellationToken>()).Returns(Task.FromResult<byte[]?>(null));
        var service = new WhatsAppService(
            db, Substitute.For<IEncryptionService>(), Substitute.For<IHttpClientFactory>(), config,
            NullLogger<WhatsAppService>.Instance, new AllowAllFeatureService(), billing,
            new TestCurrentUser(UserRole.InstitutionOwner), Substitute.For<IWaitlistService>(), notifications, kvkk, services);
        return new Harness(service, notifications, appointments);
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid AppointmentId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database, bool withAppointment = true)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Niyet Salonu", $"ny-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "Erzurum", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "SELIN OZGURLER", CustomerPhone, null);
        db.Customers.Add(customer);
        var settings = new WhatsAppSettings(tenant.Id);
        settings.BindConnection(PhoneNumberId, "waba-ny", "+90 850 242 84 25", WhatsAppConnectionStatus.NotConnected);
        db.WhatsAppSettings.Add(settings);
        var staff = new StaffMember(tenant.Id, branch.Id, "UZMAN", "Uzman");
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m);
        db.StaffMembers.Add(staff);
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        var appointmentId = Guid.Empty;
        if (withAppointment)
        {
            var start = DateTime.UtcNow.AddHours(20);
            var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, start, start.AddHours(1), 0m);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }
        return new Seed(tenant.Id, branch.Id, customer.Id, appointmentId);
    }

    private static string Event(string wamid, string text) =>
        "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\"," +
        "\"metadata\":{\"display_phone_number\":\"908502428425\",\"phone_number_id\":\"" + PhoneNumberId + "\"}," +
        "\"messages\":[{\"from\":\"" + CustomerPhone + "\",\"id\":\"" + wamid + "\",\"timestamp\":\"1795200000\",\"type\":\"text\"," +
        "\"text\":{\"body\":\"" + text + "\"}}]},\"field\":\"messages\"}]}]}";

    private static string Sign(string payload) =>
        "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(AppSecret), Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();

    private static async Task<Harness> ReplyAsync(MySqlTestDatabase database, string wamid, string text)
    {
        await using var db = database.NewContext();
        var harness = NewService(db);
        var payload = Event(wamid, text);
        await harness.Service.HandleInboundAsync(payload, Sign(payload));
        return harness;
    }

    /// <summary>Hatırlatmadan SONRA giden ama yanıt beklemeyen mesaj (ör. "kvkk-thanks") ya da genel bildirim.</summary>
    private static async Task AddOutboundAsync(MySqlTestDatabase database, Seed seed, string templateName, Guid? appointmentId = null)
    {
        await using var db = database.NewContext();
        await db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(m => m.TenantId == seed.TenantId && m.Direction == WhatsAppMessageDirection.Outbound)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.CreatedAtUtc, DateTime.UtcNow.AddMinutes(-30)));
        db.WhatsAppMessages.Add(new WhatsAppMessage(seed.TenantId, seed.BranchId, appointmentId, seed.CustomerId,
            WhatsAppMessageDirection.Outbound, CustomerPhone, templateName + " gövdesi", WhatsAppMessageStatus.Sent, templateName: templateName));
        await db.SaveChangesAsync();
    }

    private static async Task SendReminderAsync(MySqlTestDatabase database, Seed seed)
    {
        await using var db = database.NewContext();
        Assert.True((await NewService(db).Service.SendAutomaticReminderAsync(seed.TenantId, seed.AppointmentId)).IsSuccess);
    }

    private static async Task<Appointment> AppointmentAsync(MySqlTestDatabase database, Guid id)
    {
        await using var check = database.NewContext();
        return await check.Appointments.IgnoreQueryFilters().AsNoTracking().FirstAsync(a => a.Id == id);
    }

    /// <summary>Yanıt beklemeyen KVKK teşekkürü araya girse de "EVET" ondan önceki hatırlatmaya işlenir.</summary>
    [MySqlFact]
    public async Task ReplyAfterSystemAck_StillConfirmsTheReminder()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);
        await AddOutboundAsync(database, seed, "kvkk-thanks");

        await ReplyAsync(database, "wamid.ACK", "Evet, geleceğim");
        Assert.Equal(WhatsAppConfirmationStatus.Confirmed, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
    }

    /// <summary>
    /// GÜVENLİK: hatırlatmadan sonra giden kampanya/genel mesaja yazılan "HAYIR" eski hatırlatmaya kayıp randevuyu
    /// iptal ETMEZ (yanıt kampanyaya verilmiştir).
    /// </summary>
    [MySqlFact]
    public async Task NoToALaterCampaign_DoesNotCancelTheAppointment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);
        await AddOutboundAsync(database, seed, "notification");

        var harness = await ReplyAsync(database, "wamid.CAMPAIGN", "HAYIR");
        Assert.Equal(WhatsAppConfirmationStatus.Pending, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
        await harness.Appointments.DidNotReceiveWithAnyArgs().ChangeStatusAsync(default, default, default!);
    }

    /// <summary>Hatırlatmaya "Gelemeyeceğim": müşteri yanıtı Reddetti olur ve randevu kanonik servisle iptal edilir.</summary>
    [MySqlFact]
    public async Task CancelReply_DeclinesAndCancelsThroughCanonicalService()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        var harness = await ReplyAsync(database, "wamid.CANCEL", "Gelemeyeceğim");
        Assert.Equal(WhatsAppConfirmationStatus.Declined, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
        await harness.Appointments.Received(1).ChangeStatusAsync(seed.TenantId, seed.AppointmentId,
            Arg.Is<ChangeAppointmentStatusRequest>(r => r != null && r.Status == AppointmentStatus.Cancelled), Arg.Any<CancellationToken>(), Arg.Any<Guid?>());
    }

    /// <summary>"Ertelesek mi?" → erteleme istendi; randevu iptal edilmez.</summary>
    [MySqlFact]
    public async Task RescheduleReply_MarksRequest_WithoutCancelling()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        var harness = await ReplyAsync(database, "wamid.RESCHEDULE", "Ertelesek mi?");
        Assert.Equal(WhatsAppConfirmationStatus.RescheduleRequested, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
        await harness.Appointments.DidNotReceiveWithAnyArgs().ChangeStatusAsync(default, default, default!);
    }

    /// <summary>"Öbür gün saat 5 uygun mu?" → erteleme istendi + önerilen zaman randevuya yazılır; taşınınca temizlenir.</summary>
    [MySqlFact]
    public async Task TimeProposal_IsStoredOnTheAppointment_AndClearedWhenMoved()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        await ReplyAsync(database, "wamid.PROPOSAL", "Öbür gün saat 5 uygun mu?");
        var appointment = await AppointmentAsync(database, seed.AppointmentId);
        Assert.Equal(WhatsAppConfirmationStatus.RescheduleRequested, appointment.CustomerConfirmation);
        Assert.NotNull(appointment.RescheduleProposalUtc);
        Assert.Equal(14, appointment.RescheduleProposalUtc!.Value.Hour); // 17:00 TSİ = 14:00 UTC

        await using (var db = database.NewContext())
        {
            var tracked = await db.Appointments.IgnoreQueryFilters().FirstAsync(a => a.Id == seed.AppointmentId);
            var proposal = DateTime.SpecifyKind(tracked.RescheduleProposalUtc!.Value, DateTimeKind.Utc);
            tracked.Reschedule(proposal, proposal.AddHours(1));
            await db.SaveChangesAsync();
        }
        var moved = await AppointmentAsync(database, seed.AppointmentId);
        Assert.Null(moved.RescheduleProposalUtc);
        Assert.Equal(WhatsAppConfirmationStatus.None, moved.CustomerConfirmation);
    }

    /// <summary>Anlaşılamayan yanıt randevuyu değiştirmez; yöneticiye "kontrol bekliyor" bildirimi düşer.</summary>
    [MySqlFact]
    public async Task UnclearReplyToReminder_NotifiesStaff_AndChangesNothing()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await SendReminderAsync(database, seed);

        var harness = await ReplyAsync(database, "wamid.UNCLEAR", "Geç kalacağım");
        Assert.Equal(WhatsAppConfirmationStatus.Pending, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
        await harness.Notifications.Received(1).NotifyRolesAsync(
            seed.TenantId, Arg.Any<Guid?>(), Arg.Any<IReadOnlyCollection<UserRole>>(),
            AppNotificationType.WhatsAppReply, Arg.Any<AppNotificationSeverity>(),
            "Müşteri yanıtı kontrol bekliyor", Arg.Is<string>(b => b != null && b.Contains("Geç kalacağım")),
            Arg.Any<object?>(), Arg.Any<string?>(), Arg.Any<bool>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Genel mesaja (kampanya) yazılan anlaşılamayan yanıt bildirim ÜRETMEZ (gürültü olurdu).</summary>
    [MySqlFact]
    public async Task UnclearReplyToCampaign_DoesNotNotify()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await AddOutboundAsync(database, seed, "notification");

        var harness = await ReplyAsync(database, "wamid.CAMPAIGN-THANKS", "Teşekkürler");
        await harness.Notifications.DidNotReceiveWithAnyArgs().NotifyRolesAsync(
            default, default, default!, default, default, default!, default!, default, default, default, default);
    }

    /// <summary>
    /// Randevu kimliği taşıyan değerlendirme linkine yazılan "hayır" randevuya işlenmez (yalnız iki yönlü
    /// hatırlatmanın yanıtı randevuyu değiştirir).
    /// </summary>
    [MySqlFact]
    public async Task NoToARatingLink_DoesNotTouchTheAppointment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        await AddOutboundAsync(database, seed, "rating-link", seed.AppointmentId);

        var harness = await ReplyAsync(database, "wamid.RATING", "hayır");
        Assert.Equal(WhatsAppConfirmationStatus.None, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
        await harness.Appointments.DidNotReceiveWithAnyArgs().ChangeStatusAsync(default, default, default!);
    }

    /// <summary>KVKK isteğine "Hayır" → kayıt değişmez, yöneticiye "KVKK açık rızası verilmedi" bildirimi.</summary>
    [MySqlFact]
    public async Task KvkkDecline_NotifiesStaff()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, withAppointment: false);
        await using (var db = database.NewContext())
            await NewService(db).Service.SendKvkkConsentRequestAsync(seed.TenantId, seed.CustomerId);

        var harness = await ReplyAsync(database, "wamid.KVKK-NO", "Hayır, onaylamıyorum");
        await harness.Notifications.Received(1).NotifyRolesAsync(
            seed.TenantId, Arg.Any<Guid?>(), Arg.Any<IReadOnlyCollection<UserRole>>(),
            AppNotificationType.WhatsAppReply, AppNotificationSeverity.Warning,
            "KVKK açık rızası verilmedi", Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<string?>(), Arg.Any<bool>(), Arg.Any<CancellationToken>());
        await using var check = database.NewContext();
        Assert.False((await check.Customers.IgnoreQueryFilters().AsNoTracking().FirstAsync(c => c.Id == seed.CustomerId)).KvkkConsent);
    }

    /// <summary>KVKK isteği 24 saat içinde İKİNCİ kez gönderilmez (otomatik kayıt isteği + toplu "KVKK mesajı").</summary>
    [MySqlFact]
    public async Task KvkkRequest_IsNotSentTwiceWithin24Hours()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, withAppointment: false);
        for (var i = 0; i < 2; i++)
        {
            await using var db = database.NewContext();
            await NewService(db).Service.SendKvkkConsentRequestAsync(seed.TenantId, seed.CustomerId);
        }

        await using var check = database.NewContext();
        var requests = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == seed.TenantId && m.TemplateName == "kvkk-consent");
        Assert.Equal(1, requests);
    }

    /// <summary>
    /// Bildirimler sayfasından gönderilen "randevu hatırlatma" en yakın randevuya BAĞLI gider (yanıtı randevuya
    /// işlenir) ve randevuya damga vurulur (otomatik tarama ikinci kez göndermez).
    /// </summary>
    [MySqlFact]
    public async Task ManualReminderFromNotifications_IsLinkedToTheNextAppointment()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            var result = await NewService(db).Service.SendCustomerAppointmentReminderAsync(seed.TenantId, seed.CustomerId, "genel metin");
            Assert.Null(result.Error);
        }

        await using var check = database.NewContext();
        var outbound = await check.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(m => m.TenantId == seed.TenantId && m.Direction == WhatsAppMessageDirection.Outbound);
        Assert.Equal(seed.AppointmentId, outbound.AppointmentId);
        Assert.Equal("reminder", outbound.TemplateName);
        Assert.NotNull((await AppointmentAsync(database, seed.AppointmentId)).LastReminderAtUtc);

        // ... ve müşterinin yanıtı o randevuya işlenir.
        await ReplyAsync(database, "wamid.MANUAL", "Gelemeyeceğim");
        Assert.Equal(WhatsAppConfirmationStatus.Declined, (await AppointmentAsync(database, seed.AppointmentId)).CustomerConfirmation);
    }

    /// <summary>Yaklaşan randevusu olmayan müşteriye "randevu hatırlatması" GİTMEZ; sebep döner.</summary>
    [MySqlFact]
    public async Task ManualReminder_WithoutUpcomingAppointment_IsNotSent()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database, withAppointment: false);

        await using (var db = database.NewContext())
        {
            var result = await NewService(db).Service.SendCustomerAppointmentReminderAsync(seed.TenantId, seed.CustomerId, "genel metin");
            Assert.False(result.Success);
            Assert.Contains("randevusu yok", result.Error);
        }

        await using var check = database.NewContext();
        Assert.Equal(0, await check.WhatsAppMessages.IgnoreQueryFilters().CountAsync(m => m.TenantId == seed.TenantId));
    }
}

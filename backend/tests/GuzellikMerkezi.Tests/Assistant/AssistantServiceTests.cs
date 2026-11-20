using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Infrastructure.Services;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services.Assistant;
using GuzellikMerkezi.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Maydi servisi uçtan uca (bellek içi veritabanı): kapılar (kapalı, platform yöneticisi, paket), sohbet ve tavsiye
/// reddi, yardım kartı, veri niyetlerinde rol/şube/izin kapsamı, cevaplanamayan soruların kaydı ve kişiye özel geçmiş.
/// </summary>
public sealed class AssistantServiceTests : IDisposable
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid BranchA = Guid.NewGuid();
    private static readonly Guid BranchB = Guid.NewGuid();
    private readonly string databaseName = Guid.NewGuid().ToString();
    private readonly TestCurrentUser owner = new(UserRole.InstitutionOwner, Tenant);
    private readonly TestCurrentUser staffAyse;
    private readonly TestCurrentUser staffAyseNoPerms;
    private readonly Guid ayseId, burakId;

    public AssistantServiceTests()
    {
        staffAyse = new TestCurrentUser(UserRole.Staff, Tenant, BranchA, Permissions.Appointments, Permissions.Services);
        staffAyseNoPerms = new TestCurrentUser(UserRole.Staff, Tenant, BranchA) { UserId = staffAyse.UserId };
        using var db = Db(owner);
        var service = new ServiceDefinition(Tenant, BranchA, "Cilt bakımı", 60, 900m);
        var ayse = new StaffMember(Tenant, BranchA, "Ayşe Demir", "Estetisyen");
        ayse.LinkTenantUser(staffAyse.UserId);
        var burak = new StaffMember(Tenant, BranchB, "Burak Can", "Uzman");
        var c1 = new Customer(Tenant, BranchA, "Elif Yıldız", "05320000001");
        var c2 = new Customer(Tenant, BranchB, "Deniz Ak", "05320000002");
        db.AddRange(service, ayse, burak, c1, c2);
        var todayStart = DateTime.UtcNow.AddHours(3).Date.AddHours(-3);
        // "Sonraki" randevu her zaman BUGÜN içinde kalmalı (gece 23'ten sonra +1 saat yarına düşüyordu):
        // günün bitiminden 5 dk önce. Şu an o saatten önceyse randevu henüz "sırada"dır.
        var later = todayStart.AddDays(1).AddMinutes(-5);
        // Bugün: Ayşe'nin 2 randevusu (A şubesi), Burak'ın 1 randevusu (B şubesi).
        db.Appointments.Add(new Appointment(Tenant, BranchA, c1.Id, ayse.Id, service.Id, later, later.AddHours(1), 900m));
        var done = new Appointment(Tenant, BranchA, c1.Id, ayse.Id, service.Id, todayStart.AddMinutes(30), todayStart.AddMinutes(90), 900m);
        db.Appointments.Add(done);
        db.Appointments.Add(new Appointment(Tenant, BranchB, c2.Id, burak.Id, service.Id, later, later.AddHours(1), 900m));
        db.Products.Add(new Product(Tenant, BranchA, "Serum", ProductCategory.SkinCare, "adet", 10m, 20m, 1m, 5m));
        db.Products.Add(new Product(Tenant, BranchA, "Krem", ProductCategory.SkinCare, "adet", 10m, 20m, 50m, 5m));
        db.SaveChangesAsync().GetAwaiter().GetResult();
        ayseId = ayse.Id;
        burakId = burak.Id;
    }

    public void Dispose() { }

    private GuzellikDbContext Db(ICurrentUser user, Guid? branchOverride = null) =>
        new(new DbContextOptionsBuilder<GuzellikDbContext>().UseInMemoryDatabase(databaseName).Options,
            new TestTenantContext(user.TenantId, branchOverride ?? user.BranchId, user.IsPlatformAdmin), user, null, null, TestSearchIndex.Create());

    private sealed class FakeFeatures(IReadOnlyCollection<string>? features) : IFeatureService
    {
        public Task<bool> HasFeatureAsync(Guid tenantId, string featureKey, CancellationToken ct = default) => Task.FromResult(features?.Contains(featureKey) ?? true);
        public Task<bool> IsFeatureAllowedAsync(Guid tenantId, string featureKey, CancellationToken ct = default) => HasFeatureAsync(tenantId, featureKey, ct);
        public Task<Result<TenantFeaturesDto>> GetTenantFeaturesAsync(Guid tenantId, CancellationToken ct = default) =>
            Task.FromResult(Result<TenantFeaturesDto>.Success(new TenantFeaturesDto(tenantId, features is null ? null : Guid.NewGuid(), "x", "x", features ?? [])));
        public FeatureCatalogDto GetCatalog() => new(Array.Empty<FeatureCatalogItem>());
        public void InvalidateTenant(Guid tenantId) { }
    }

    private sealed class FakeHelp(AssistantHelpAnswer answer) : IAssistantHelpService
    {
        public List<string> Questions { get; } = [];
        public List<AssistantHelpOptions> Options { get; } = [];
        public Task<AssistantHelpAnswer> AnswerAsync(string question, AssistantHelpOptions options, CancellationToken cancellationToken)
        {
            Questions.Add(question);
            Options.Add(options);
            return Task.FromResult(answer);
        }
    }

    private sealed class NoAi : IAssistantHelpMatcher
    {
        public bool IsEnabled => false;
        public int DailyLimit => 30;
        public Task<string?> PickArticleAsync(string maskedQuestion, IReadOnlyList<(string Id, string Title)> articles, CancellationToken cancellationToken) => Task.FromResult<string?>(null);
    }

    private (AssistantService Service, GuzellikDbContext Db) Build(ICurrentUser user, IReadOnlyCollection<string>? features = null,
        IAssistantHelpService? help = null, bool enabled = true, IReportsService? reports = null, Guid? branchOverride = null)
    {
        var db = Db(user, branchOverride);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Assistant:Enabled"] = enabled.ToString() }).Build();
        var service = new AssistantService(db, user, new TestTenantContext(user.TenantId, branchOverride ?? user.BranchId, user.IsPlatformAdmin), new FakeFeatures(features),
            help ?? new FakeHelp(AssistantHelpAnswer.None("owner")), new NoAi(), reports ?? new ReportsService(db, user), Substitute.For<ICustomerService>(),
            config, NullLogger<AssistantService>.Instance);
        return (service, db);
    }

    private static AssistantSendRequest Ask(string message, Guid? conversation = null, Guid? client = null, AssistantClientContext? context = null) =>
        new(conversation, message, client, context);

    // ── Kapılar ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Disabled_Is404_PlatformAdmin_And_PlanWithoutFeature_Are403()
    {
        Assert.Equal("NotFound", (await Build(owner, enabled: false).Service.SendAsync(Ask("merhaba"), default)).Error.Code);
        Assert.Equal("Forbidden", (await Build(new TestCurrentUser(UserRole.PlatformAdmin)).Service.SendAsync(Ask("merhaba"), default)).Error.Code);
        Assert.Equal("Forbidden", (await Build(owner, features: [FeatureCatalog.AuditLogs]).Service.SendAsync(Ask("merhaba"), default)).Error.Code);
        Assert.True((await Build(owner, features: [FeatureCatalog.AiAssistant]).Service.SendAsync(Ask("merhaba"), default)).IsSuccess);

        var status = (await Build(owner, features: [FeatureCatalog.AuditLogs]).Service.GetStatusAsync(default)).Value!;
        Assert.False(status.FeatureAllowed);
        Assert.Equal("Maydi", status.Name);
        Assert.Contains("sağlık", status.PrivacyNoteTr);
    }

    // ── Sohbet, tavsiye, yardım ─────────────────────────────────────────────

    [Fact]
    public async Task BeautyAdvice_IsRefused_AndNeverReachesHelp()
    {
        var help = new FakeHelp(AssistantHelpAnswer.None("owner"));
        var reply = (await Build(owner, help: help).Service.SendAsync(Ask("cildim için hangi krem iyi gelir"), default)).Value!;
        Assert.Equal("advice_refused", reply.Outcome);
        Assert.Contains("uzman", reply.Text);
        Assert.Empty(help.Questions);
    }

    [Fact]
    public async Task HowTo_ReturnsCatalogCard_WithNavigateAction()
    {
        var article = AssistantHelpCatalog.Articles.Single(a => a.Id == "cash-closing");
        var help = new FakeHelp(new AssistantHelpAnswer(AssistantHelpOutcome.Article, "owner", article, "ai", "/panel/kasa-kapanis"));
        var reply = (await Build(owner, help: help).Service.SendAsync(Ask("gün sonu nasıl kapatılır"), default)).Value!;

        Assert.Equal("how_to", reply.Kind);
        var action = Assert.Single(reply.Actions);
        Assert.Equal("/panel/kasa-kapanis", action.Route);
        Assert.Equal(["gün sonu nasıl kapatılır"], help.Questions);
    }

    [Fact]
    public async Task Unknown_IsRecorded_AndShownOnlyToManagersInScope()
    {
        // Personel (A şubesi) cevaplanamayan bir soru sorar.
        var (staffService, _) = Build(staffAyse);
        var reply = (await staffService.SendAsync(Ask("Türkiye'nin başkenti neresi"), default)).Value!;
        Assert.Equal("not_found", reply.Outcome);

        // Kurum sahibi görür; personel listeyi çağıramaz.
        var list = (await Build(owner).Service.GetUnansweredAsync(30, default)).Value!;
        var row = Assert.Single(list);
        Assert.Equal("Türkiye'nin başkenti neresi", row.Question);
        Assert.Equal(AssistantPortals.Staff, row.Portal);
        Assert.Equal("Forbidden", (await staffService.GetUnansweredAsync(30, default)).Error.Code);

        // Şube yöneticisi yalnız kendi şubesinde sorulanları görür.
        Assert.Single((await Build(new TestCurrentUser(UserRole.BranchManager, Tenant, BranchA)).Service.GetUnansweredAsync(30, default)).Value!);
        Assert.Empty((await Build(new TestCurrentUser(UserRole.BranchManager, Tenant, BranchB)).Service.GetUnansweredAsync(30, default)).Value!);
    }

    [Fact]
    public async Task DeclinedAiConsent_IsPassedToHelp_AsNoAi()
    {
        var help = new FakeHelp(AssistantHelpAnswer.None("owner"));
        await Build(owner, help: help).Service.SendAsync(Ask("kasa nasıl kapatılır", context: new AssistantClientContext(AllowAi: false, StoreBuild: true)), default);
        var options = Assert.Single(help.Options);
        Assert.False(options.AllowAi);
        Assert.True(options.StoreBuild);
    }

    // ── Veri niyetleri ve kapsam ────────────────────────────────────────────

    [Fact]
    public async Task Staff_SeesOnlyOwnAppointments()
    {
        var reply = (await Build(staffAyse).Service.SendAsync(Ask("bugünkü randevularım"), default)).Value!;
        Assert.Equal("data", reply.Kind);
        Assert.StartsWith("Bugün: 2 randevunuz var", reply.Text);
        // Saati geçmiş (ama tamamlanmamış) randevu "sırada" sayılmaz — panodaki sayıyla aynı.
        var localTime = DateTime.UtcNow.AddHours(3).TimeOfDay;
        if (localTime > TimeSpan.FromMinutes(31) && localTime < new TimeSpan(23, 55, 0)) Assert.Contains("1 sırada", reply.Text);
        Assert.Equal("/ekip/randevular", Assert.Single(reply.Actions).Route);
    }

    [Fact]
    public async Task Owner_SeesWholeInstitution_BranchManager_OwnBranch()
    {
        var all = (await Build(owner).Service.SendAsync(Ask("bugün kaç randevu var"), default)).Value!;
        Assert.StartsWith("Bugün: 3 randevu var", all.Text);

        var branchB = (await Build(new TestCurrentUser(UserRole.BranchManager, Tenant, BranchB)).Service.SendAsync(Ask("bugün kaç randevu var"), default)).Value!;
        Assert.StartsWith("Bugün: 1 randevu var", branchB.Text);

        // Kurum sahibi panelde A şubesini seçtiyse (X-Branch-Id → kiracı bağlamı) yalnız o şube sayılır.
        var ownerOnA = (await Build(owner, branchOverride: BranchA).Service.SendAsync(Ask("bugün kaç randevu var"), default)).Value!;
        Assert.StartsWith("Bugün: 2 randevu var", ownerOnA.Text);
    }

    [Fact]
    public async Task StaffWithoutPermission_IsDenied()
    {
        var reply = (await Build(staffAyseNoPerms).Service.SendAsync(Ask("bugünkü randevularım"), default)).Value!;
        Assert.Equal("denied", reply.Outcome);
        Assert.Contains("yetki", reply.Text);
    }

    [Fact]
    public async Task RoleOutOfPortal_IsDenied_RevenueNeverForStaff()
    {
        var reports = Substitute.For<IReportsService>();
        var reply = (await Build(staffAyse, reports: reports).Service.SendAsync(Ask("bugünkü ciro ne kadar"), default)).Value!;
        Assert.Equal("denied", reply.Outcome);
        await reports.DidNotReceiveWithAnyArgs().GetSummaryAsync(default, default!, default);
    }

    private static ReportSummaryDto Summary(decimal income, decimal expense, decimal sales, decimal previousIncome = 0) => new(
        DateTime.UtcNow, DateTime.UtcNow, null, null, "day",
        [
            new ReportMetricDto("income", "Toplam Gelir", income, previousIncome, "currency", "3 tahsilat"),
            new ReportMetricDto("expense", "Toplam Gider", expense, 0, "currency", "1 gider"),
            new ReportMetricDto("openReceivable", "Toplam Alacak", 250m, 0, "currency", null),
            new ReportMetricDto("sales", "Toplam Satış Tutarı", sales, 0, "currency", "2 satış"),
        ],
        [], [], [new ReportSliceDto("cash", "Nakit", income, 3)], [new ReportSliceDto("rent", "Kira", expense, 1)],
        [new ReportSliceDto("service", "Hizmet", sales, 2)], [], []);

    [Fact]
    public async Task Revenue_ComesFromReports_ForTheAskedPeriod()
    {
        var reports = Substitute.For<IReportsService>();
        ReportRangeRequest? asked = null;
        reports.GetSummaryAsync(Tenant, Arg.Do<ReportRangeRequest>(r => asked = r), Arg.Any<CancellationToken>())
            .Returns(Result<ReportSummaryDto>.Success(Summary(4500m, 500m, 6000m, previousIncome: 3000m)));

        var reply = (await Build(owner, reports: reports).Service.SendAsync(Ask("bugünün geliri ne"), default)).Value!;
        Assert.Equal("answered", reply.Outcome);
        Assert.Contains("4.500,00 ₺", reply.Text);
        Assert.Contains("net 4.000,00 ₺", reply.Text);
        Assert.Contains("%50 artış", reply.Text);

        // "ocak ayı gelirlerini göster": sayfaya yönlendirmez, Ocak ayının rakamını söyler.
        var january = (await Build(owner, reports: reports).Service.SendAsync(Ask("ocak ayı gelirlerini göster"), default)).Value!;
        Assert.Equal("data", january.Kind);
        Assert.StartsWith("Ocak", january.Text);
        var local = asked!.FromUtc.AddHours(3);
        Assert.Equal((1, 1), (local.Month, local.Day));
        Assert.Equal((2, 1), (asked.ToUtc.AddHours(3).Month, asked.ToUtc.AddHours(3).Day));
    }

    [Fact]
    public async Task Profit_Expenses_Sales_UseSameSummary()
    {
        var reports = Substitute.For<IReportsService>();
        reports.GetSummaryAsync(Tenant, Arg.Any<ReportRangeRequest>(), Arg.Any<CancellationToken>())
            .Returns(Result<ReportSummaryDto>.Success(Summary(4500m, 500m, 6000m)));
        var service = Build(owner, reports: reports).Service;

        Assert.Contains("net kâr 4.000,00 ₺", (await service.SendAsync(Ask("geçen ayın kârı ne kadar"), default)).Value!.Text);
        var expenses = (await service.SendAsync(Ask("bu ay giderlerimiz"), default)).Value!;
        Assert.Contains("Kira", expenses.Text);
        Assert.Contains("6.000,00 ₺", (await service.SendAsync(Ask("dün ne kadar satış yaptık"), default)).Value!.Text);
    }

    [Fact]
    public async Task PlanWithoutStock_DeniesCriticalStock_WithStock_ListsOnlyCritical()
    {
        var denied = (await Build(owner, features: [FeatureCatalog.AiAssistant]).Service.SendAsync(Ask("kritik stoktaki ürünler"), default)).Value!;
        Assert.Equal("denied", denied.Outcome);

        var reply = (await Build(owner, features: [FeatureCatalog.AiAssistant, FeatureCatalog.StockProducts]).Service.SendAsync(Ask("kritik stoktaki ürünler"), default)).Value!;
        Assert.StartsWith("1 ürün kritik", reply.Text);
    }

    [Fact]
    public async Task NextCustomer_ForStaff()
    {
        var reply = (await Build(staffAyse).Service.SendAsync(Ask("sıradaki müşterim kim"), default)).Value!;
        Assert.Contains("Elif Yıldız", reply.Text);
        Assert.DoesNotContain("Deniz", reply.Text);
    }

    [Fact]
    public async Task Customer_CannotAskManagerData()
    {
        var customer = new TestCurrentUser(UserRole.Customer, Tenant);
        var reply = (await Build(customer).Service.SendAsync(Ask("geciken taksitler"), default)).Value!;
        Assert.Equal("denied", reply.Outcome);
    }

    [Fact]
    public async Task Customer_AsksOwnAppointments_OrAnAction_IsNotDenied()
    {
        var customer = new TestCurrentUser(UserRole.Customer, Tenant);
        var own = (await Build(customer).Service.SendAsync(Ask("yarın randevum var mı"), default)).Value!;
        Assert.NotEqual("denied", own.Outcome);
        Assert.Equal("data", own.Kind);
        // Yapma isteği yardıma gider (makale yoksa "bilmiyorum"), "bu bilgi panelinizde yok" demez.
        var action = (await Build(customer).Service.SendAsync(Ask("randevumu iptal etmek istiyorum"), default)).Value!;
        Assert.NotEqual("denied", action.Outcome);
    }

    // ── Kalıcılık, gizlilik, geri bildirim ──────────────────────────────────

    [Fact]
    public async Task Conversation_IsPrivate_FeedbackOwnMessageOnly_AndRetriesAreIdempotent()
    {
        var client = Guid.NewGuid();
        var (service, db) = Build(owner);
        var first = (await service.SendAsync(Ask("merhaba", client: client), default)).Value!;
        var again = (await service.SendAsync(Ask("merhaba", client: client), default)).Value!;
        Assert.Equal(first.MessageId, again.MessageId);
        Assert.Equal(2, await db.AssistantMessages.CountAsync()); // soru + tek cevap

        var messages = (await service.GetMessagesAsync(first.ConversationId, default)).Value!;
        Assert.Equal(["user", "assistant"], messages.Select(m => m.Sender));

        // Başka kullanıcı (aynı kurum) sohbeti okuyamaz, mesaja oy veremez.
        var other = Build(new TestCurrentUser(UserRole.InstitutionOwner, Tenant)).Service;
        Assert.Equal("NotFound", (await other.GetMessagesAsync(first.ConversationId, default)).Error.Code);
        Assert.Equal("NotFound", (await other.SetFeedbackAsync(first.MessageId, true, default)).Error.Code);

        Assert.True((await service.SetFeedbackAsync(first.MessageId, false, default)).IsSuccess);
        Assert.Equal((short)-1, (await db.AssistantMessages.AsNoTracking().SingleAsync(m => m.Id == first.MessageId)).Feedback);

        Assert.True((await service.DeleteConversationAsync(first.ConversationId, default)).IsSuccess);
        Assert.Empty((await service.GetConversationsAsync(default)).Value!);
    }

    [Fact]
    public async Task Suggestions_OnlyAnswerableOnes_AndScreenContextFirst()
    {
        var staffSuggestions = (await Build(staffAyse).Service.GetSuggestionsAsync(new AssistantClientContext(), default)).Value!;
        Assert.DoesNotContain(staffSuggestions, s => s.Intent == nameof(AssistantIntent.Revenue));

        var onStock = (await Build(owner).Service.GetSuggestionsAsync(new AssistantClientContext("/panel/stok"), default)).Value!;
        Assert.Equal(nameof(AssistantIntent.CriticalStock), onStock[0].Intent);
    }

    [Fact]
    public async Task Briefing_GreetsAndSummarizes()
    {
        var briefing = (await Build(staffAyse).Service.GetBriefingAsync(new AssistantClientContext(), default)).Value!;
        Assert.Contains("Maydi", briefing.Greeting);
        Assert.Contains(briefing.Lines, line => line.StartsWith("Bugün: 2 randevunuz var", StringComparison.Ordinal));
        Assert.NotEmpty(briefing.Suggestions);
    }

    [Fact]
    public async Task AiPickedDataIntent_IsAnsweredFromRecords_WithLocalPeriod()
    {
        // Kural motoru anlamıyor; yapay zekâ "veri: randevular" seçiyor. Dönem yine sorudan YEREL çıkarılır.
        var help = new FakeHelp(new AssistantHelpAnswer(AssistantHelpOutcome.Data, "owner", null, "ai", null, AssistantIntent.AppointmentsToday));
        var reply = (await Build(owner, help: help).Service.SendAsync(Ask("bugün salona uğrayacak olanların sayısı"), default)).Value!;
        Assert.Equal("data", reply.Kind);
        Assert.StartsWith("Bugün: 3 randevu", reply.Text);
        // Yapay zekâya yalnız kişinin cevaplayabildiği veri niyetleri sunulur (finans yönetici için var).
        Assert.Contains(help.Options[0].DataChoices!, choice => choice.Intent == AssistantIntent.Revenue);

        var staffHelp = new FakeHelp(AssistantHelpAnswer.None("staff"));
        await Build(staffAyse, help: staffHelp).Service.SendAsync(Ask("salona uğrayacak olanların sayısı"), default);
        Assert.DoesNotContain(staffHelp.Options[0].DataChoices!, choice => choice.Intent == AssistantIntent.Revenue);
        // "Nasıl" sorusunda veri seçeneği sunulmaz.
        var howHelp = new FakeHelp(AssistantHelpAnswer.None("owner"));
        await Build(owner, help: howHelp).Service.SendAsync(Ask("randevu nasıl oluşturulur"), default);
        Assert.Empty(howHelp.Options[0].DataChoices ?? []);
    }

    [Fact]
    public async Task Customers_Birthdays_Cancellations_FromRecords()
    {
        using (var db = Db(owner))
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
            var c = new Customer(Tenant, BranchA, "Selin Kaya", "05320000003");
            c.UpdateProfile(new DateOnly(1990, today.Month, today.Day), Gender.Female, true, null);
            db.Customers.Add(c);
            var first = db.Appointments.First();
            first.Cancel("Hasta");
            await db.SaveChangesAsync();
        }
        var service = Build(owner).Service;
        var birthdays = (await service.SendAsync(Ask("bugün doğum günü olan var mı"), default)).Value!;
        Assert.Contains("1 müşterinin doğum günü", birthdays.Text);
        Assert.Contains("Selin Kaya", System.Text.Json.JsonSerializer.Serialize(birthdays.Data), StringComparison.Ordinal);
        var newCustomers = (await service.SendAsync(Ask("bu ay kaç yeni müşteri geldi"), default)).Value!;
        Assert.Contains("3 yeni müşteri", newCustomers.Text);
        var cancelled = (await service.SendAsync(Ask("bu ay iptal edilen randevular"), default)).Value!;
        Assert.Contains("1 randevu iptal edildi", cancelled.Text);
        var count = (await service.SendAsync(Ask("toplam kaç müşterimiz var"), default)).Value!;
        Assert.StartsWith("Toplam 3 kayıtlı müşteri", count.Text);
    }

    [Fact]
    public async Task English_Context_AnswersInEnglish()
    {
        var reply = (await Build(owner).Service.SendAsync(Ask("bugün kaç randevu var", context: new AssistantClientContext(English: true)), default)).Value!;
        Assert.StartsWith("Today: 3 appointments", reply.Text);
    }
}

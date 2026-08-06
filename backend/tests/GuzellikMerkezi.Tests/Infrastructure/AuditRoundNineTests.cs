using System.Text;
using GuzellikMerkezi.Api.Background;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Api.Realtime;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DENETİM TURU 9 — üçüncü NO-GO turunda çıkan kusurlar.
///
/// <list type="bullet">
/// <item><b>B1 — BEDAVA YENİLEME:</b> self-servis uç "farklı ücretli pakete geçiş"i engelliyor ama
/// MEVCUT ücretli paketin yeniden seçilmesini geçiriyordu; kurum yöneticisi aboneliğini ödeme
/// yapmadan sınırsız kez uzatabiliyordu.</item>
/// <item><b>B14 — ÜRETİMDE SAHTE ÖDEME:</b> bir konfigürasyon bayrağı canlıda simülasyon
/// sağlayıcısını açabiliyordu (hiç para çekilmeden her abonelik "ödendi").</item>
/// <item><b>B16 — DNS REBINDING:</b> SMTP host'u doğrulanıyor, bağlantıda DNS YENİDEN çözülüyordu;
/// aradaki pencerede kayıt iç bir adrese döndürülebiliyordu.</item>
/// <item><b>B17 — CANLI SOKET:</b> hub yetkisi yalnız bağlanırken kontrol ediliyordu; iptal edilmiş
/// oturum açık WebSocket üzerinden olay akışını izlemeye devam ediyordu.</item>
/// <item><b>B18 — YETKİ EŞLEMESİ:</b> tüm randevu yazmaları Appointments.Create istiyordu; yalnız
/// "durum güncelleme" yetkisi verilmiş personel kendi işini yapamıyordu (403).</item>
/// <item><b>B3 — SESSİZ KAYIP:</b> gönderilemeyen WhatsApp mesajı kalıcı iş kuyruğunda BAŞARILI
/// kapanıyor, hiç yeniden denenmeden kayboluyordu.</item>
/// </list>
/// </summary>
public sealed class AuditRoundNineTests
{
    // ── B18: randevu yolu → gerçek yetki sınıfı ──────────────────────────────────────────

    private sealed class Reached
    {
        private int _value;
        public int Value => Volatile.Read(ref _value);
        public void Increment() => Interlocked.Increment(ref _value);
    }

    private static StaffApprovalGateMiddleware NewGate(Reached reached) =>
        new(_ => { reached.Increment(); return Task.CompletedTask; });

    private static DefaultHttpContext Request(string path, string method, bool replay = false)
    {
        var http = new DefaultHttpContext();
        http.Request.Method = method;
        http.Request.Path = path;
        http.Request.ContentType = "application/json";
        var bytes = Encoding.UTF8.GetBytes("{}");
        http.Request.Body = new MemoryStream(bytes);
        http.Request.ContentLength = bytes.Length;
        http.Response.Body = new MemoryStream();
        if (replay)
        {
            http.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                [new System.Security.Claims.Claim(IApprovalReplayer.ReplayClaimType, Guid.CreateVersion7().ToString())],
                "replay"));
        }
        return http;
    }

    private static IPendingOperationService PendingOpsStub()
    {
        var stub = Substitute.For<IPendingOperationService>();
        stub.CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(), Arg.Any<string>(),
                Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>())
            .Returns(Result<PendingOperationDto>.Failure(Error.Validation("stub")));
        return stub;
    }

    /// <summary>
    /// ASIL İDDİA: yalnız <c>Appointments.Status</c> yetkisi olan personel randevu durumunu
    /// güncelleyebilir. Eskiden aynı yol ayrıca <c>Appointments.Create</c> istediği için, kendisine
    /// AÇIKÇA verilmiş bu yetki hiç kullanılamıyor ve her istek 403 dönüyordu.
    /// </summary>
    [Theory]
    [InlineData("/api/admin/appointments/11111111-1111-1111-1111-111111111111/status", "PATCH")]
    [InlineData("/api/admin/appointments/11111111-1111-1111-1111-111111111111/complete", "POST")]
    public async Task AppointmentStatus_WithOnlyStatusPermission_ReachesEndpoint(string path, string method)
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Reached();
        var http = Request(path, method);
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null,
            Permissions.Appointments, Permissions.AppointmentsStatus);

        await NewGate(reached).InvokeAsync(http, staff, new TestTenantContext(tenantId), PendingOpsStub());

        Assert.NotEqual(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(1, reached.Value);
    }

    /// <summary>KARŞIT DURUM: durum yetkisi YOKSA kapı hâlâ kapalı — kural gevşemedi.</summary>
    [Fact]
    public async Task AppointmentStatus_WithoutStatusPermission_IsForbidden()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Reached();
        var http = Request("/api/admin/appointments/11111111-1111-1111-1111-111111111111/status", "PATCH");
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null,
            Permissions.Appointments, Permissions.AppointmentsCreate);

        await NewGate(reached).InvokeAsync(http, staff, new TestTenantContext(tenantId), PendingOpsStub());

        Assert.Equal(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(0, reached.Value);
    }

    /// <summary>
    /// GERİLEME KORUMASI: randevu OLUŞTURMA hâlâ <c>Appointments.Create</c> ister — durum yetkisi
    /// oluşturma yetkisi yerine geçmez.
    /// </summary>
    [Fact]
    public async Task AppointmentCreate_WithOnlyStatusPermission_IsForbidden()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Reached();
        var http = Request("/api/admin/appointments", "POST");
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null,
            Permissions.Appointments, Permissions.AppointmentsStatus);

        await NewGate(reached).InvokeAsync(http, staff, new TestTenantContext(tenantId), PendingOpsStub());

        Assert.Equal(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(0, reached.Value);
    }

    /// <summary>
    /// AYNI KUSURUN OKUMA TARAFI: yalnız durum yetkisi olan personel randevu LİSTESİNİ de açabilir.
    /// Sayfayı görme hakkı uç grubundaki <c>RequirePermission(Appointments)</c> ile ayrıca
    /// kapıdan geçer; işlem izni yazma içindir.
    /// </summary>
    [Fact]
    public async Task AppointmentList_WithOnlyStatusPermission_ReachesEndpoint()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Reached();
        var http = Request("/api/admin/appointments", "GET");
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null,
            Permissions.Appointments, Permissions.AppointmentsStatus);

        await NewGate(reached).InvokeAsync(http, staff, new TestTenantContext(tenantId), PendingOpsStub());

        Assert.NotEqual(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(1, reached.Value);
    }

    /// <summary>
    /// Yanlış tamamlamayı geri alma kendi yetkisine tabidir. Onaylanmış replay yolundan bakılır:
    /// bu yol onay kapısına takılmaz, dolayısıyla ölçülen şey yalnız YETKİ eşlemesidir.
    /// </summary>
    [Fact]
    public async Task VoidCompletion_WithOnlyVoidPermission_ReachesEndpoint()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Reached();
        var http = Request("/api/admin/appointments/11111111-1111-1111-1111-111111111111/void-completion", "POST", replay: true);
        var staff = new TestCurrentUser(UserRole.Staff, tenantId, null,
            Permissions.Appointments, Permissions.AppointmentsVoidCompletion);

        await NewGate(reached).InvokeAsync(http, staff, new TestTenantContext(tenantId), PendingOpsStub());

        Assert.NotEqual(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(1, reached.Value);
    }

    // ── B1: ücretli paket self-servis YENİLENEMEZ ────────────────────────────────────────

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static SubscriptionPlanService NewPlanService(GuzellikDbContext db) =>
        new(db, new AllowAllFeatureService(), new NoopAuditLogger());

    private static SubscriptionPlan PaidPlan() =>
        new("pro", "Pro", monthlyPriceTRY: 1500m, maxBranches: 3, maxStaff: 20, maxCustomers: 5000,
            maxMonthlyAppointments: 0, maxMonthlySmsCount: 0, yearlyPriceTRY: 15000m);

    private static SubscriptionPlan FreePlan() =>
        new("free", "Ücretsiz", monthlyPriceTRY: 0m, maxBranches: 1, maxStaff: 2, maxCustomers: 100,
            maxMonthlyAppointments: 0, maxMonthlySmsCount: 0);

    /// <summary>
    /// ASIL İDDİA: MEVCUT ücretli paketini yeniden seçen kurum yöneticisi aboneliğini BEDAVA
    /// uzatamaz. Eski kural yalnız "farklı ücretli pakete geçiş"i engelliyordu; aynı paketi seçmek
    /// tahsilat olmadan bitiş tarihini bir dönem ileri atıyordu.
    /// </summary>
    [Fact]
    public async Task SelfService_RenewingSamePaidPlan_IsRejectedAndDoesNotExtend()
    {
        var options = NewOptions();
        Guid tenantId;
        Guid planId;
        DateTime? endsBefore;

        await using (var db = NewDb(options))
        {
            var plan = PaidPlan();
            var tenant = new Tenant("Salon", "salon", "Pro");
            db.SubscriptionPlans.Add(plan);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            // Kurum zaten bu ücretli pakette ve aboneliği sürüyor.
            tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddDays(-29));
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            planId = plan.Id;
            endsBefore = tenant.SubscriptionEndsAtUtc;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewPlanService(db).AssignToTenantAsync(
                tenantId, planId, BillingPeriod.Monthly, CancellationToken.None, selfService: true);

            Assert.True(result.IsFailure);
            Assert.Equal("Conflict", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var tenant = await check.Tenants.IgnoreQueryFilters().FirstAsync(t => t.Id == tenantId);
            Assert.Equal(endsBefore, tenant.SubscriptionEndsAtUtc);   // TEK GERÇEK ÖLÇÜT: süre uzamadı
        }
    }

    /// <summary>KARŞIT DURUM: ücretsiz pakete geçiş self-serviste çalışmaya devam eder.</summary>
    [Fact]
    public async Task SelfService_FreePlan_IsStillAllowed()
    {
        var options = NewOptions();
        Guid tenantId;
        Guid freePlanId;

        await using (var db = NewDb(options))
        {
            var free = FreePlan();
            var tenant = new Tenant("Salon", "salon2", "Ücretsiz");
            db.SubscriptionPlans.Add(free);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            freePlanId = free.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewPlanService(db).AssignToTenantAsync(
                tenantId, freePlanId, BillingPeriod.Monthly, CancellationToken.None, selfService: true);
            Assert.True(result.IsSuccess);
        }
    }

    /// <summary>
    /// PLATFORM YOLU KAPANMADI: platform yöneticisi (selfService=false) ücretli paketi atayabilir —
    /// düzeltme yalnız KURUMUN kendi kendine yenilemesini kapatır.
    /// </summary>
    [Fact]
    public async Task PlatformAssignment_OfPaidPlan_StillWorks()
    {
        var options = NewOptions();
        Guid tenantId;
        Guid planId;

        await using (var db = NewDb(options))
        {
            var plan = PaidPlan();
            var tenant = new Tenant("Salon", "salon3", "Pro");
            db.SubscriptionPlans.Add(plan);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            planId = plan.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewPlanService(db).AssignToTenantAsync(
                tenantId, planId, BillingPeriod.Monthly, CancellationToken.None, selfService: false);
            Assert.True(result.IsSuccess);
        }
    }

    // ── B14: üretimde sahte ödeme kaçış kapısı kaldırıldı ────────────────────────────────

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    /// <summary>
    /// ASIL İDDİA: canlıda simülasyonu açan eski bayrak kalmışsa uygulama AÇILMAZ. Sessizce yok
    /// saymak, ayarı devralan bir kurulumun neden farklı davrandığını görünmez kılardı.
    /// </summary>
    [Fact]
    public void ProductionPaymentGuard_LegacySimulationOverride_Throws()
    {
        var config = Config((PaymentGatewayResolver.LegacySimulationOverrideKey, "true"));

        var ex = Assert.Throws<InvalidOperationException>(
            () => PaymentGatewayResolver.EnsureProductionPaymentConfiguration(config, "Production"));

        Assert.Contains(PaymentGatewayResolver.LegacySimulationOverrideKey, ex.Message);
    }

    /// <summary>Geliştirme/staging ortamında simülasyon meşrudur — kapı yalnız canlıyı korur.</summary>
    [Theory]
    [InlineData("Development")]
    [InlineData("Staging")]
    public void ProductionPaymentGuard_NonProduction_DoesNotThrow(string environment)
    {
        var config = Config((PaymentGatewayResolver.LegacySimulationOverrideKey, "true"));
        PaymentGatewayResolver.EnsureProductionPaymentConfiguration(config, environment);
    }

    /// <summary>Bayrak yoksa canlı ortam da sorunsuz açılır (kural fazla geniş değil).</summary>
    [Fact]
    public void ProductionPaymentGuard_WithoutOverride_DoesNotThrow()
    {
        PaymentGatewayResolver.EnsureProductionPaymentConfiguration(Config(), "Production");
    }

    // ── B16: SMTP ucu doğrulanan adrese sabitlenir ───────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: TLS KAPALIYKEN bağlantı, doğrulanan IP'ye kurulur. Host ADI verilseydi DNS
    /// bağlantı anında yeniden çözülür ve aradaki pencerede iç bir adrese döndürülebilirdi.
    /// </summary>
    [Fact]
    public void ResolveSmtp_WithoutTls_PinsValidatedAddress()
    {
        var endpoint = OutboundEndpointGuard.ResolveSmtp("8.8.8.8", 587, useTls: false);

        Assert.Null(endpoint.Error);
        Assert.True(System.Net.IPAddress.TryParse(endpoint.ConnectHost, out _));
    }

    /// <summary>
    /// TLS AÇIKKEN ad korunur: bağı SERTİFİKA kurar (IP'ye bağlanmak geçerli sertifikaları da
    /// reddettirirdi). Yeniden çözümleme iç bir servise gitse bile el sıkışma düşer.
    /// </summary>
    [Fact]
    public void ResolveSmtp_WithTls_KeepsHostName()
    {
        var endpoint = OutboundEndpointGuard.ResolveSmtp("8.8.8.8", 587, useTls: true);

        Assert.Null(endpoint.Error);
        Assert.Equal("8.8.8.8", endpoint.ConnectHost);
    }

    /// <summary>Reddedilen uç için bağlanılacak adres ÜRETİLMEZ (fail-closed).</summary>
    [Theory]
    [InlineData("127.0.0.1", 587)]
    [InlineData("8.8.8.8", 3306)]
    public void ResolveSmtp_RejectedEndpoint_HasNoConnectHost(string host, int port)
    {
        var endpoint = OutboundEndpointGuard.ResolveSmtp(host, port, useTls: false);

        Assert.NotNull(endpoint.Error);
        Assert.Null(endpoint.ConnectHost);
    }

    // ── B17: canlı hub oturumu iptalden etkilenir ────────────────────────────────────────

    private static readonly DateTime Revoked = new(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// ASIL İDDİA: damga, token üretildikten SONRA ileri alınmışsa açık soket koparılır. Bu, HTTP
    /// tarafındaki kuralın (OnTokenValidated) ta kendisidir; eskiden WebSocket bu kuralın dışındaydı.
    /// </summary>
    [Fact]
    public void RealtimeSentinel_TokenOlderThanSecurityStamp_IsRevoked()
    {
        var state = new RealtimeSessionSentinel.UserState(IsActive: true, IsDeleted: false, SecurityStampUtc: Revoked);

        var reason = RealtimeSessionSentinel.RevocationReason(state, Revoked.AddMinutes(-5));

        Assert.NotNull(reason);
    }

    /// <summary>Damgadan SONRA üretilen token geçerlidir — kural fazla geniş değil.</summary>
    [Fact]
    public void RealtimeSentinel_TokenNewerThanSecurityStamp_Survives()
    {
        var state = new RealtimeSessionSentinel.UserState(IsActive: true, IsDeleted: false, SecurityStampUtc: Revoked);

        Assert.Null(RealtimeSessionSentinel.RevocationReason(state, Revoked.AddMinutes(5)));
    }

    /// <summary>Pasifleştirilen ya da silinen kullanıcının soketi damgadan bağımsız koparılır.</summary>
    [Theory]
    [InlineData(false, false)]   // pasif
    [InlineData(true, true)]     // silinmiş
    public void RealtimeSentinel_InactiveOrDeletedUser_IsRevoked(bool isActive, bool isDeleted)
    {
        var state = new RealtimeSessionSentinel.UserState(isActive, isDeleted, SecurityStampUtc: null);

        Assert.NotNull(RealtimeSessionSentinel.RevocationReason(state, DateTime.UtcNow));
    }

    /// <summary>
    /// KAYIT YOKSA HTTP İLE AYNI DAVRANILIR (fail-open). Koparsaydık istemci yeniden bağlanır,
    /// negotiate HTTP kapısından geçer ve 30 saniye sonra yine kopardı — sonu gelmeyen döngü.
    /// </summary>
    [Fact]
    public void RealtimeSentinel_UnknownUser_IsNotRevoked()
    {
        Assert.Null(RealtimeSessionSentinel.RevocationReason(null, DateTime.UtcNow));
    }

    /// <summary>Bağlantı kaydı eklenip silinebilir (nöbetçinin tarayacağı küme doğru).</summary>
    [Fact]
    public void RealtimeRegistry_TracksAndReleasesConnections()
    {
        var registry = new RealtimeConnectionRegistry();
        registry.Add(new RealtimeConnectionRegistry.LiveConnection(
            "conn-1", Guid.CreateVersion7(), DateTime.UtcNow, IsCustomer: false, Abort: () => { }));

        Assert.Equal(1, registry.Count);
        registry.Remove("conn-1");
        Assert.Equal(0, registry.Count);
    }

    // ── B3: gönderilemeyen mesaj kuyrukta BAŞARILI kapanmaz ──────────────────────────────

    private static IWhatsAppService WhatsAppStub(WhatsAppDispatchReport report)
    {
        var stub = Substitute.For<IWhatsAppService>();
        stub.SendKvkkConsentRequestAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(report));
        return stub;
    }

    private static string KvkkPayload() =>
        System.Text.Json.JsonSerializer.Serialize(new KvkkConsentJob(Guid.CreateVersion7(), Guid.CreateVersion7()));

    /// <summary>
    /// ASIL İDDİA: sağlayıcı reddettiğinde handler İSTİSNA fırlatır — kalıcı iş kuyruğu yeniden
    /// dener, denemeler tükenirse dead-letter'a düşer. Eskiden hata yutulduğu için iş "başarılı"
    /// kapanıyor ve KVKK isteği hiç gönderilmeden kayboluyordu.
    /// </summary>
    [Fact]
    public async Task KvkkJob_WhenProviderRejects_ThrowsSoQueueRetries()
    {
        var handler = new KvkkConsentJobHandler(WhatsAppStub(WhatsAppDispatchReport.Failed("Meta 400")));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => handler.ExecuteAsync(KvkkPayload(), CancellationToken.None));

        Assert.Contains("Meta 400", ex.Message);
    }

    /// <summary>
    /// BİLEREK ATLANAN gönderim başarıdır: telefonu olmayan / zaten onay vermiş müşteri için tekrar
    /// denemek aynı sonucu verir. Kuralın fazla geniş olmadığının kanıtı.
    /// </summary>
    [Fact]
    public async Task KvkkJob_WhenSkipped_CompletesSuccessfully()
    {
        var handler = new KvkkConsentJobHandler(WhatsAppStub(WhatsAppDispatchReport.Skipped));

        await handler.ExecuteAsync(KvkkPayload(), CancellationToken.None);
    }

    /// <summary>Gönderilen mesaj da doğal olarak başarıdır.</summary>
    [Fact]
    public async Task KvkkJob_WhenSent_CompletesSuccessfully()
    {
        var handler = new KvkkConsentJobHandler(WhatsAppStub(WhatsAppDispatchReport.Sent));

        await handler.ExecuteAsync(KvkkPayload(), CancellationToken.None);
    }

    /// <summary>
    /// HİÇ TESLİM EDİLEMEYEN PUSH PARTİSİ de başarısızdır. Kısmi başarıda tekrar denemek teslim
    /// edilmiş cihazlara MÜKERRER bildirim gönderirdi; bu yüzden yalnız tamamen başarısız parti
    /// istisnaya çevrilir.
    /// </summary>
    [Fact]
    public async Task PushJob_WhenNothingDelivered_Throws()
    {
        var push = Substitute.For<IPushSender>();
        push.SendAsync(Arg.Any<IReadOnlyCollection<PushMessage>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(0));
        var payload = System.Text.Json.JsonSerializer.Serialize(
            new PushSendJob([new PushMessage("token-1", "Başlık", "Gövde", null)]));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new PushSendJobHandler(push).ExecuteAsync(payload, CancellationToken.None));
    }

    /// <summary>Kısmi teslimat başarıdır — mükerrer bildirim üretmemek için yeniden denenmez.</summary>
    [Fact]
    public async Task PushJob_WhenPartiallyDelivered_CompletesSuccessfully()
    {
        var push = Substitute.For<IPushSender>();
        push.SendAsync(Arg.Any<IReadOnlyCollection<PushMessage>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(1));
        var payload = System.Text.Json.JsonSerializer.Serialize(new PushSendJob(
        [
            new PushMessage("token-1", "Başlık", "Gövde", null),
            new PushMessage("token-2", "Başlık", "Gövde", null),
        ]));

        await new PushSendJobHandler(push).ExecuteAsync(payload, CancellationToken.None);
    }
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.Support;
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
/// DESTEK TALEPLERİ — üç giriş (ziyaretçi / kurum / platform), tek kuyruk.
/// </summary>
public sealed class SupportTicketTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ICurrentUser user) =>
        new(options, null, user, null, null, TestSearchIndex.Create());

    /// <summary>Oturumsuz ziyaretçi — kimliğin tek kaynağı formdur.</summary>
    private sealed class Anonymous : ICurrentUser
    {
        public Guid? UserId => null;
        public string? Email => null;
        public UserRole? Role => null;
        public Guid? TenantId => null;
        public Guid? BranchId => null;
        public Guid? CustomerId => null;
        public bool IsAuthenticated => false;
        public bool IsPlatformAdmin => false;
        public string? IpAddress => "127.0.0.1";
        public string? DeviceId => null;
        public string? DeviceInfoJson => null;
        public IReadOnlyCollection<string> Permissions => [];
    }

    private static IPlatformMessagingService NewMessaging()
    {
        var m = Substitute.For<IPlatformMessagingService>();
        m.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, "id", null));
        return m;
    }

    private static SupportService NewService(GuzellikDbContext db, ICurrentUser user, IPlatformMessagingService? messaging = null) =>
        new(db, user, messaging ?? NewMessaging(), new FixedClock(),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
            NullLogger<SupportService>.Instance);

    private static CreateSupportTicketRequest Form(string subject = "Seans düşmüyor") =>
        new(subject, "Randevuyu tamamladım ama paketten seans düşmedi.", "Ayşe Yılmaz", "ayse@ornek.com", null,
            SupportTicketCategory.Bug);

    private static async Task<(Guid TenantId, Guid UserId)> SeedTenantAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options, new TestCurrentUser());
        var tenant = new Tenant("Güzel Salon", "guzel-salon", "Premium");
        tenant.AssignCode("BA-01");
        tenant.AddBranch("Merkez", "İstanbul", isDefault: true);
        var owner = tenant.GrantAccess("sahip@ornek.com", UserRole.InstitutionOwner, null, "Ayşe Yılmaz");
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return (tenant.Id, owner.Id);
    }

    // ================================================================= oluşturma

    /// <summary>Ziyaretçi talebi kurumsuz açılır ve takip kodu + jeton alır.</summary>
    [Fact]
    public async Task ZiyaretciTalebi_KurumsuzAcilir_KodVeJetonAlir()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());

        var result = await NewService(db, new Anonymous()).CreateAsync(Form());

        Assert.True(result.IsSuccess);
        Assert.StartsWith("DST-", result.Value!.Code, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(result.Value.AccessToken));

        await using var verify = NewDb(options, new Anonymous());
        var ticket = await verify.SupportTickets.IgnoreQueryFilters().Include(t => t.Messages).SingleAsync();
        Assert.Null(ticket.TenantId);            // ziyaretçi: kurum yok
        Assert.Equal("ayse@ornek.com", ticket.RequesterEmail);
        Assert.Equal(SupportTicketStatus.Open, ticket.Status);
        Assert.True(ticket.HasUnreadForPlatform);
        Assert.Single(ticket.Messages);
    }

    /// <summary>
    /// OTURUMLU TALEPTE KİMLİK SUNUCUDAN GELİR; formdaki ad/e-posta YOK SAYILIR.
    /// </summary>
    /// <remarks>
    /// Aksi hâlde giriş yapmış biri başkasının adına talep açıp yanıtları o adrese
    /// yönlendirebilirdi.
    /// </remarks>
    [Fact]
    public async Task OturumluTalep_KimligiOturumdanAlir_FormdakiniYokSayar()
    {
        var options = NewOptions();
        var (tenantId, userId) = await SeedTenantAsync(options);
        var user = new TestCurrentUser(UserRole.InstitutionOwner, tenantId) { UserId = userId };

        await using var db = NewDb(options, user);
        var result = await NewService(db, user).CreateAsync(
            Form() with { Name = "Sahte Kişi", Email = "saldirgan@kotu.com" });

        Assert.True(result.IsSuccess);

        await using var verify = NewDb(options, new Anonymous());
        var ticket = await verify.SupportTickets.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(tenantId, ticket.TenantId);
        Assert.Equal("sahip@ornek.com", ticket.RequesterEmail);   // formdaki adres DEĞİL
        Assert.NotEqual("Sahte Kişi", ticket.RequesterName);
        // Kurum adı KOPYALANIR: kurum silinse de kayıt okunabilir kalsın.
        Assert.Contains("Güzel Salon", ticket.TenantNameSnapshot);
        Assert.Contains("BA-01", ticket.TenantNameSnapshot);
    }

    /// <summary>
    /// ÖNCELİK İSTEMCİYE BIRAKILMAZ: herkes kendini "Acil" işaretlerse sıralama anlamını yitirir.
    /// </summary>
    [Fact]
    public async Task Oncelik_IstemciSecemez_HerZamanNormalBaslar()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());

        await NewService(db, new Anonymous()).CreateAsync(Form() with { Priority = SupportTicketPriority.Urgent });

        await using var verify = NewDb(options, new Anonymous());
        Assert.Equal(SupportTicketPriority.Normal,
            (await verify.SupportTickets.IgnoreQueryFilters().SingleAsync()).Priority);
    }

    /// <summary>İkinci talep sıradaki kodu alır (DST-YY-0001 → 0002).</summary>
    [Fact]
    public async Task IkinciTalep_SiradakiKoduAlir()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());
        var service = NewService(db, new Anonymous());

        var first = await service.CreateAsync(Form("Birinci"));
        var second = await service.CreateAsync(Form("İkinci"));

        Assert.EndsWith("0001", first.Value!.Code, StringComparison.Ordinal);
        Assert.EndsWith("0002", second.Value!.Code, StringComparison.Ordinal);
    }

    // ================================================================= oturumsuz takip

    /// <summary>
    /// YANLIŞ JETON ile TALEP YOK ayrımı DIŞARI SIZMAZ: ikisi de aynı hatayı verir.
    /// </summary>
    /// <remarks>
    /// Fark olsaydı, sıralı kodlar taranarak hangi taleplerin var olduğu keşfedilebilirdi.
    /// </remarks>
    [Fact]
    public async Task YanlisJeton_TalepYokMesajiyla_AyirtEdilemez()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());
        var service = NewService(db, new Anonymous());
        var created = await service.CreateAsync(Form());

        var wrongToken = await service.GetByTokenAsync(created.Value!.Code, "yanlis-jeton");
        var missing = await service.GetByTokenAsync("DST-26-9999", "yanlis-jeton");

        Assert.True(wrongToken.IsFailure);
        Assert.True(missing.IsFailure);
        Assert.Equal(missing.Error.Code, wrongToken.Error.Code);
        Assert.Equal(missing.Error.Message, wrongToken.Error.Message);
    }

    /// <summary>Doğru kod + jeton talebi açar ve okunmamış rozetini düşürür.</summary>
    [Fact]
    public async Task DogruKodVeJeton_TalebiAcar()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());
        var service = NewService(db, new Anonymous());
        var created = await service.CreateAsync(Form());

        var detail = await service.GetByTokenAsync(created.Value!.Code, created.Value.AccessToken);

        Assert.True(detail.IsSuccess);
        Assert.Equal("Seans düşmüyor", detail.Value!.Subject);
        Assert.Single(detail.Value.Messages);
    }

    // ================================================================= durum akışı

    /// <summary>
    /// Platform yanıtı durumu "Yanıtınız bekleniyor"a çeker ve ilk yanıt süresini damgalar.
    /// </summary>
    [Fact]
    public async Task PlatformYaniti_DurumuMusteriBekleniyorYapar()
    {
        var options = NewOptions();
        var platform = new TestCurrentUser(UserRole.PlatformAdmin);
        await using var db = NewDb(options, new Anonymous());
        var created = await NewService(db, new Anonymous()).CreateAsync(Form());

        await using var db2 = NewDb(options, platform);
        var ticketId = (await db2.SupportTickets.IgnoreQueryFilters().SingleAsync()).Id;
        var replied = await NewService(db2, platform).ReplyAsync(ticketId, new SupportReplyRequest("Bakıyoruz."));

        Assert.True(replied.IsSuccess);
        Assert.Equal(SupportTicketStatus.WaitingCustomer, replied.Value!.Status);
        Assert.NotNull(replied.Value.FirstResponseAtUtc);
        Assert.Equal(2, replied.Value.Messages.Count);
        Assert.NotNull(created.Value);
    }

    /// <summary>
    /// ÇÖZÜLDÜ SAYILAN TALEBE GELEN YANIT ONU YENİDEN AÇAR.
    /// </summary>
    /// <remarks>
    /// "Hayır, hâlâ sorun var" diyen bir mesajın kapalı bir kutuya düşüp kimsenin görmemesi,
    /// destek sisteminin en sık ve en pahalı arızasıdır.
    /// </remarks>
    [Fact]
    public async Task CozulmusTalebeYanit_TalebiYenidenAcar()
    {
        var options = NewOptions();
        var platform = new TestCurrentUser(UserRole.PlatformAdmin);

        await using var db = NewDb(options, new Anonymous());
        var anonService = NewService(db, new Anonymous());
        var created = await anonService.CreateAsync(Form());

        await using var db2 = NewDb(options, platform);
        var ticketId = (await db2.SupportTickets.IgnoreQueryFilters().SingleAsync()).Id;
        var resolved = await NewService(db2, platform).UpdateAsync(ticketId,
            new UpdateSupportTicketRequest(SupportTicketStatus.Resolved, null, null));
        Assert.Equal(SupportTicketStatus.Resolved, resolved.Value!.Status);

        await using var db3 = NewDb(options, new Anonymous());
        var reopened = await NewService(db3, new Anonymous())
            .ReplyByTokenAsync(created.Value!.Code, created.Value.AccessToken, new SupportReplyRequest("Hâlâ olmuyor."));

        Assert.True(reopened.IsSuccess);
        Assert.Equal(SupportTicketStatus.InProgress, reopened.Value!.Status);
        Assert.Null(reopened.Value.ResolvedAtUtc);
    }

    /// <summary>Kapatılmış talebe yanıt yazılamaz — kullanıcı hatası olarak döner, 500 değil.</summary>
    [Fact]
    public async Task KapatilmisTalebeYanit_Reddedilir()
    {
        var options = NewOptions();
        var platform = new TestCurrentUser(UserRole.PlatformAdmin);

        await using var db = NewDb(options, new Anonymous());
        var created = await NewService(db, new Anonymous()).CreateAsync(Form());

        await using var db2 = NewDb(options, platform);
        var ticketId = (await db2.SupportTickets.IgnoreQueryFilters().SingleAsync()).Id;
        await NewService(db2, platform).UpdateAsync(ticketId,
            new UpdateSupportTicketRequest(SupportTicketStatus.Closed, null, null));

        await using var db3 = NewDb(options, new Anonymous());
        var reply = await NewService(db3, new Anonymous())
            .ReplyByTokenAsync(created.Value!.Code, created.Value.AccessToken, new SupportReplyRequest("Bir şey daha var."));

        Assert.True(reply.IsFailure);
        Assert.Equal("Validation", reply.Error.Code);
    }

    /// <summary>Durum değişikliği yazışmaya SİSTEM NOTU olarak düşer (kim ne zaman değiştirdi).</summary>
    [Fact]
    public async Task DurumDegisikligi_SistemNotuBirakir()
    {
        var options = NewOptions();
        var platform = new TestCurrentUser(UserRole.PlatformAdmin);

        await using var db = NewDb(options, new Anonymous());
        await NewService(db, new Anonymous()).CreateAsync(Form());

        await using var db2 = NewDb(options, platform);
        var ticketId = (await db2.SupportTickets.IgnoreQueryFilters().SingleAsync()).Id;
        var updated = await NewService(db2, platform).UpdateAsync(ticketId,
            new UpdateSupportTicketRequest(null, SupportTicketPriority.Urgent, null));

        Assert.True(updated.IsSuccess);
        Assert.Contains(updated.Value!.Messages, m => m.Side == SupportAuthorSide.System);
    }

    // ================================================================= kapsam

    /// <summary>
    /// KURUM YALNIZ KENDİ TALEPLERİNİ GÖRÜR — başkasının talebi "bulunamadı" der (BOLA).
    /// </summary>
    [Fact]
    public async Task Kurum_BaskaKurumunTalebiniGoremez()
    {
        var options = NewOptions();
        var (tenantA, userA) = await SeedTenantAsync(options);

        Guid tenantB;
        await using (var seed = NewDb(options, new TestCurrentUser()))
        {
            var other = new Tenant("Diğer Salon", "diger-salon", "Premium");
            other.AssignCode("BA-02");
            other.AddBranch("Merkez", "Ankara", isDefault: true);
            other.GrantAccess("diger@ornek.com", UserRole.InstitutionOwner, null, "Zeynep");
            seed.Tenants.Add(other);
            await seed.SaveChangesAsync();
            tenantB = other.Id;
        }

        // A kurumu bir talep açar.
        var userAContext = new TestCurrentUser(UserRole.InstitutionOwner, tenantA) { UserId = userA };
        await using var dbA = NewDb(options, userAContext);
        await NewService(dbA, userAContext).CreateAsync(Form());

        await using var dbLookup = NewDb(options, new Anonymous());
        var ticketId = (await dbLookup.SupportTickets.IgnoreQueryFilters().SingleAsync()).Id;

        // B kurumu onu göremez ve listesinde bulamaz.
        var userBContext = new TestCurrentUser(UserRole.InstitutionOwner, tenantB) { UserId = Guid.CreateVersion7() };
        await using var dbB = NewDb(options, userBContext);
        var serviceB = NewService(dbB, userBContext);

        Assert.True((await serviceB.GetMineAsync(ticketId)).IsFailure);
        Assert.Empty((await serviceB.ListMineAsync(new SupportTicketQuery())).Value!.Items);
    }

    /// <summary>
    /// ZİYARETÇİ TALEBİ PLATFORM KUYRUĞUNDA GÖRÜNÜR.
    /// </summary>
    /// <remarks>
    /// Tabloya kiracı global filtresi konulsaydı, <c>TenantId</c>'si null olan bu talepler
    /// hiçbir listede görünmezdi — yani en değerli müşteri adayı sessizce kaybolurdu.
    /// </remarks>
    [Fact]
    public async Task ZiyaretciTalebi_PlatformKuyrugundaGorunur()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());
        await NewService(db, new Anonymous()).CreateAsync(Form());

        var platform = new TestCurrentUser(UserRole.PlatformAdmin);
        await using var db2 = NewDb(options, platform);
        var list = await NewService(db2, platform).ListAllAsync(new SupportTicketQuery());

        Assert.True(list.IsSuccess);
        Assert.Single(list.Value!.Items);
    }

    /// <summary>Kuyruk özeti sayaçları doğru sayar.</summary>
    [Fact]
    public async Task KuyrukOzeti_SayaclariDogruSayar()
    {
        var options = NewOptions();
        await using var db = NewDb(options, new Anonymous());
        var service = NewService(db, new Anonymous());
        await service.CreateAsync(Form("Bir"));
        await service.CreateAsync(Form("İki"));

        var platform = new TestCurrentUser(UserRole.PlatformAdmin);
        await using var db2 = NewDb(options, platform);
        var summary = await NewService(db2, platform).GetSummaryAsync();

        Assert.True(summary.IsSuccess);
        Assert.Equal(2, summary.Value!.Open);
        Assert.Equal(2, summary.Value.Unread);
        // Hiç yanıtlanmadı: ölçülemeyen ile sıfır AYNI ŞEY DEĞİLDİR.
        Assert.Null(summary.Value.AvgFirstResponseHours);
    }
}

using System.Security.Claims;
using System.Text;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Maydanoz platform köprüsü: imzalı /api/connector/v1/platform/* → izin listesindeki /api/platform/* (platform
/// yöneticisi kimliğiyle). Kapsam, izin listesi, yol hileleri, kimlik ve gövdesiz denetim kaydı.
/// </summary>
public sealed class PlatformBridgeTests
{
    private const string Secret = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";

    private readonly IAuditLogger _audit = Substitute.For<IAuditLogger>();

    private static IConfiguration Config(string scopes = "plans.read platform.manage") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Connector:Keys:maydanoz:Secret"] = Secret,
            ["Connector:Keys:maydanoz:Scopes"] = scopes,
        }).Build();

    private static DefaultHttpContext Signed(string method, string path, string body = "")
    {
        var http = new DefaultHttpContext();
        http.Request.Method = method;
        var q = path.IndexOf('?');
        http.Request.Path = q < 0 ? path : path[..q];
        if (q >= 0) http.Request.QueryString = new QueryString(path[q..]);
        var bytes = Encoding.UTF8.GetBytes(body);
        http.Request.Body = new MemoryStream(bytes);
        http.Request.ContentLength = bytes.Length;
        http.Response.Body = new MemoryStream();
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var nonce = Guid.NewGuid().ToString("N");
        var canonical = ConnectorSignature.Canonical(method, path, ts, nonce, ConnectorSignature.BodyHash(bytes));
        http.Request.Headers[ConnectorSignature.KeyHeader] = "maydanoz";
        http.Request.Headers[ConnectorSignature.TimestampHeader] = ts.ToString();
        http.Request.Headers[ConnectorSignature.NonceHeader] = nonce;
        http.Request.Headers[ConnectorSignature.SignatureHeader] = ConnectorSignature.Sign(Secret, canonical);
        return http;
    }

    private static GuzellikDbContext Db(bool withAdmin = true)
    {
        var db = new GuzellikDbContext(new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options);
        if (withAdmin)
        {
            var tenant = new Tenant("Platform", "platform", "BeautyAsist", TenantStatus.Active);
            var passive = tenant.GrantAccess("eski@beautyasist.test", UserRole.PlatformAdmin, null, "Eski Yönetici");
            passive.Disable();
            tenant.GrantAccess("platform@beautyasist.test", UserRole.PlatformAdmin, null, "Platform Yöneticisi");
            tenant.GrantAccess("sahip@beautyasist.test", UserRole.InstitutionOwner, null, "Kurum Sahibi");
            db.Tenants.Add(tenant);
            db.SaveChanges();
            db.ChangeTracker.Clear();
        }

        return db;
    }

    private async Task<(DefaultHttpContext Http, bool Reached, string? Path, ClaimsPrincipal? User)> RunAsync(
        DefaultHttpContext http, GuzellikDbContext db, IConfiguration? config = null, int downstreamStatus = 200)
    {
        var reached = false;
        string? path = null;
        ClaimsPrincipal? user = null;
        var mw = new PlatformBridgeMiddleware(ctx =>
        {
            reached = true;
            path = ctx.Request.Path.Value;
            user = ctx.User;
            ctx.Response.StatusCode = downstreamStatus;
            return Task.CompletedTask;
        }, NullLogger<PlatformBridgeMiddleware>.Instance);
        await mw.InvokeAsync(http, config ?? Config(), db, _audit);
        return (http, reached, path, user);
    }

    private static async Task<string> BodyOf(HttpContext http)
    {
        http.Response.Body.Position = 0;
        return await new StreamReader(http.Response.Body).ReadToEndAsync();
    }

    [Fact]
    public async Task ASignedSettingsRead_RunsAsTheActivePlatformAdmin_OnThePlatformRoute()
    {
        await using var db = Db();
        var request = Signed("GET", "/api/connector/v1/platform/messaging/settings");
        request.Request.Headers.Authorization = "Bearer baska-birinin-jetonu";

        var (http, reached, path, user) = await RunAsync(request, db);

        Assert.True(reached);
        Assert.Equal("/api/platform/messaging/settings", path);
        Assert.False(http.Request.Headers.ContainsKey("Authorization"));
        Assert.True(user!.Identity!.IsAuthenticated);
        Assert.Equal(PlatformBridgeMiddleware.AuthenticationType, user.Identity.AuthenticationType);
        Assert.True(user.IsInRole(nameof(UserRole.PlatformAdmin)));
        Assert.Equal("platform@beautyasist.test", user.FindFirstValue(ClaimTypes.Email));
        Assert.Equal("maydanoz", user.FindFirstValue(PlatformBridgeMiddleware.ViaClaim));
        var adminId = await db.TenantUsers.IgnoreQueryFilters().Where(u => u.Email == "platform@beautyasist.test").Select(u => u.Id).SingleAsync();
        Assert.Equal(adminId.ToString(), user.FindFirstValue(ClaimTypes.NameIdentifier));
        // Okuma denetim kaydına girmez.
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!, default!, default);
    }

    [Fact]
    public async Task ASuccessfulWrite_IsAudited_WithoutTheBody()
    {
        await using var db = Db();
        const string body = "{\"smtpPassword\":\"cok-gizli-parola\",\"paymentsEnabled\":true}";
        var (_, reached, path, _) = await RunAsync(Signed("PUT", "/api/connector/v1/platform/messaging/settings", body), db);

        Assert.True(reached);
        Assert.Equal("/api/platform/messaging/settings", path);
        await _audit.Received(1).LogAsync(null, null, PlatformBridgeMiddleware.AuditAction, "Platform", null,
            "Maydanoz platform köprüsü: PUT /api/platform/messaging/settings",
            Arg.Is<object?>(data => data != null && !data.ToString()!.Contains("cok-gizli-parola")), Arg.Any<CancellationToken>());

        // Başarısız yazma (ör. doğrulama hatası) denetim kaydına girmez.
        _audit.ClearReceivedCalls();
        await RunAsync(Signed("PUT", "/api/connector/v1/platform/messaging/settings", body), db, downstreamStatus: 400);
        await _audit.DidNotReceiveWithAnyArgs().LogAsync(default, default, default!, default!, default);
    }

    [Fact]
    public async Task WithoutThePlatformScope_TheBridgeRefuses()
    {
        await using var db = Db();
        var (http, reached, _, _) = await RunAsync(Signed("GET", "/api/connector/v1/platform/messaging/settings"), db,
            Config("plans.read tenants.read checkouts.read checkouts.write"));

        Assert.False(reached);
        Assert.Equal(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Contains("connector.scope", await BodyOf(http));
    }

    [Theory]
    [InlineData("DELETE", "/api/connector/v1/platform/tenants/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("PUT", "/api/connector/v1/platform/tenants/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("POST", "/api/connector/v1/platform/tenants")]
    [InlineData("GET", "/api/connector/v1/platform/support/not-a-guid")]
    [InlineData("DELETE", "/api/connector/v1/platform/support/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("PUT", "/api/connector/v1/platform/system/database")]
    [InlineData("DELETE", "/api/connector/v1/platform/messaging/settings")]
    [InlineData("GET", "/api/connector/v1/platform/messaging/settings/extra")]
    [InlineData("GET", "/api/connector/v1/platform/Messaging/settings")]
    [InlineData("GET", "/api/connector/v1/platform/messaging//settings")]
    [InlineData("GET", "/api/connector/v1/platform/messaging/../tenants")]
    [InlineData("GET", "/api/connector/v1/platform")]
    [InlineData("PUT", "/api/connector/v1/platform/subscription-plans/not-a-guid")]
    [InlineData("POST", "/api/connector/v1/platform/messaging/test-fax")]
    public async Task PathsOutsideTheAllowList_AreRefused(string method, string path)
    {
        await using var db = Db();
        var (http, reached, _, _) = await RunAsync(Signed(method, path), db);

        Assert.False(reached);
        Assert.Equal(StatusCodes.Status404NotFound, http.Response.StatusCode);
    }

    [Fact]
    public async Task AnEncodedPath_NeverReachesThePlatform()
    {
        // Kestrel %2e'yi çözüp nokta parçalarını atar (izin listesi reddeder); çözülmemiş hali imzayla da tutmaz.
        await using var db = Db();
        var (http, reached, _, _) = await RunAsync(Signed("GET", "/api/connector/v1/platform/messaging/%2e%2e/tenants"), db);

        Assert.False(reached);
        Assert.True(http.Response.StatusCode is StatusCodes.Status401Unauthorized or StatusCodes.Status404NotFound);
    }

    [Theory]
    [InlineData("POST", "/api/connector/v1/platform/messaging/test-email")]
    [InlineData("PUT", "/api/connector/v1/platform/system/settings")]
    [InlineData("POST", "/api/connector/v1/platform/system/queue/0b8f1c1e-1111-4222-8333-944455556666/requeue")]
    [InlineData("PUT", "/api/connector/v1/platform/whatsapp/billing-settings")]
    [InlineData("GET", "/api/connector/v1/platform/whatsapp/credit-packages?includeInactive=true")]
    [InlineData("DELETE", "/api/connector/v1/platform/whatsapp/pricing/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("PUT", "/api/connector/v1/platform/subscription-plans/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("POST", "/api/connector/v1/platform/subscription-plans")]
    public async Task SettingsRoutes_PassThrough(string method, string path)
    {
        await using var db = Db();
        var (http, reached, rewritten, _) = await RunAsync(Signed(method, path, method == "GET" ? "" : "{}"), db);

        Assert.True(reached);
        Assert.StartsWith("/api/platform/", rewritten);
        // Sorgu dizesi (imzanın parçası) aynen hedefe gider.
        Assert.Equal(path.Contains('?') ? "?includeInactive=true" : string.Empty, http.Request.QueryString.Value ?? string.Empty);
    }

    /// <summary>
    /// 2. dilim (19 Kas 2026): destek kuyruğu, kurumlar (yalnız profil yazma) ve veritabanı izleme. Sorgu dizesi
    /// (Türkçe harf ve boşluk kodlanmış) imzanın parçasıdır ve hedefe AYNEN gider.
    /// </summary>
    [Theory]
    [InlineData("GET", "/api/connector/v1/platform/support?scope=open&search=%C5%9Fule%20han%C4%B1m&page=1&pageSize=25", "/api/platform/support")]
    [InlineData("GET", "/api/connector/v1/platform/support/summary", "/api/platform/support/summary")]
    [InlineData("GET", "/api/connector/v1/platform/support/0b8f1c1e-1111-4222-8333-944455556666", "/api/platform/support/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("POST", "/api/connector/v1/platform/support/0b8f1c1e-1111-4222-8333-944455556666/reply", "/api/platform/support/0b8f1c1e-1111-4222-8333-944455556666/reply")]
    [InlineData("PUT", "/api/connector/v1/platform/support/0b8f1c1e-1111-4222-8333-944455556666", "/api/platform/support/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("GET", "/api/connector/v1/platform/tenants?page=1&pageSize=200&search=", "/api/platform/tenants")]
    [InlineData("GET", "/api/connector/v1/platform/tenants/0b8f1c1e-1111-4222-8333-944455556666", "/api/platform/tenants/0b8f1c1e-1111-4222-8333-944455556666")]
    [InlineData("PUT", "/api/connector/v1/platform/tenants/0b8f1c1e-1111-4222-8333-944455556666/profile", "/api/platform/tenants/0b8f1c1e-1111-4222-8333-944455556666/profile")]
    [InlineData("GET", "/api/connector/v1/platform/system/database", "/api/platform/system/database")]
    [InlineData("GET", "/api/connector/v1/platform/system/database/schema", "/api/platform/system/database/schema")]
    public async Task SupportTenantAndDatabaseRoutes_PassThrough(string method, string path, string target)
    {
        await using var db = Db();
        var (http, reached, rewritten, _) = await RunAsync(Signed(method, path, method == "GET" ? "" : "{}"), db);

        Assert.True(reached);
        Assert.Equal(target, rewritten);
        var q = path.IndexOf('?');
        Assert.Equal(q < 0 ? string.Empty : path[q..], http.Request.QueryString.Value ?? string.Empty);
    }

    [Fact]
    public async Task WithoutAnActivePlatformAdmin_TheBridgeCannotRun()
    {
        await using var db = Db(withAdmin: false);
        var (http, reached, _, _) = await RunAsync(Signed("GET", "/api/connector/v1/platform/messaging/settings"), db);

        Assert.False(reached);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, http.Response.StatusCode);
        Assert.Contains("connector.platform-user", await BodyOf(http));
    }

    [Fact]
    public async Task ABadSignature_IsRefusedBeforeAnythingElse()
    {
        await using var db = Db();
        var tampered = Signed("GET", "/api/connector/v1/platform/messaging/settings");
        tampered.Request.Path = "/api/connector/v1/platform/system/settings";

        var (http, reached, _, _) = await RunAsync(tampered, db);

        Assert.False(reached);
        Assert.Equal(StatusCodes.Status401Unauthorized, http.Response.StatusCode);
    }

    [Theory]
    [InlineData("/api/platform/messaging/settings")]
    [InlineData("/api/connector/v1/plans")]
    [InlineData("/api/connector/v1/platformx/messaging/settings")]
    [InlineData("/api/admin/tenant")]
    public async Task OtherPaths_AreLeftUntouched(string path)
    {
        await using var db = Db();
        var http = new DefaultHttpContext();
        http.Request.Method = "GET";
        http.Request.Path = path;
        var original = http.User;

        var (_, reached, seen, user) = await RunAsync(http, db);

        Assert.True(reached);
        Assert.Equal(path, seen);
        Assert.Same(original, user);
    }

    [Fact]
    public void TheAllowListIsExactAndDenyByDefault()
    {
        Assert.True(PlatformBridgeMiddleware.IsAllowed("GET", "/subscription-plans"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("PATCH", "/subscription-plans"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("GET", "/subscription-plans/"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("GET", string.Empty));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("GET", "/" + new string('a', 200)));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("GET", "/invoices"));
        Assert.True(PlatformBridgeMiddleware.IsAllowed("GET", "/tenants/0b8f1c1e-1111-4222-8333-944455556666"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("PUT", "/tenants/0b8f1c1e-1111-4222-8333-944455556666"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("DELETE", "/tenants/0b8f1c1e-1111-4222-8333-944455556666"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("GET", "/tenants/0b8f1c1e-1111-4222-8333-944455556666/access"));
        Assert.False(PlatformBridgeMiddleware.IsAllowed("POST", "/support"));
    }
}

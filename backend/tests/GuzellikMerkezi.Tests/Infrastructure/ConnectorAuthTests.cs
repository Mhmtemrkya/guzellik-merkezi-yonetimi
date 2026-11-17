using System.Text;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application.Features.Connector;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MAYDANOZ BAĞLAYICISI KAPISI — imza, zaman, tekrar ve kapsam.
/// Maydanoz tarafı aynı imzayı üretir; buradaki sabit vektör iki projenin uyuştuğunun kanıtıdır.
/// </summary>
public sealed class ConnectorAuthTests
{
    private const string Secret = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";

    private static IConfiguration Config(string scopes = "*", string secret = Secret) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Connector:Keys:maydanoz:Secret"] = secret,
            ["Connector:Keys:maydanoz:Scopes"] = scopes,
        }).Build();

    private static DefaultHttpContext Signed(string method, string path, string body = "", string? nonce = null,
        long? timestamp = null, string secret = Secret, string keyId = "maydanoz")
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

        var ts = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        nonce ??= Guid.NewGuid().ToString("N");
        var canonical = ConnectorSignature.Canonical(method, path, ts, nonce, ConnectorSignature.BodyHash(bytes));
        http.Request.Headers[ConnectorSignature.KeyHeader] = keyId;
        http.Request.Headers[ConnectorSignature.TimestampHeader] = ts.ToString();
        http.Request.Headers[ConnectorSignature.NonceHeader] = nonce;
        http.Request.Headers[ConnectorSignature.SignatureHeader] = ConnectorSignature.Sign(secret, canonical);
        return http;
    }

    private static (ConnectorAuthMiddleware mw, Func<bool> reached) Middleware()
    {
        var reached = false;
        var mw = new ConnectorAuthMiddleware(ctx => { reached = true; return Task.CompletedTask; }, NullLogger<ConnectorAuthMiddleware>.Instance);
        return (mw, () => reached);
    }

    private static GuzellikMerkezi.Infrastructure.Persistence.GuzellikDbContext InMemory() =>
        new(new DbContextOptionsBuilder<GuzellikMerkezi.Infrastructure.Persistence.GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
            .Options);

    /// <summary>Sözleşme vektörü: Maydanoz testinde aynı girdi aynı imzayı üretmeli.</summary>
    [Fact]
    public void Signature_KnownVector()
    {
        var canonical = ConnectorSignature.Canonical("get", "/api/connector/v1/plans?x=1", 1763380800, "nonce-0123456789ab",
            ConnectorSignature.BodyHash([]));
        Assert.Equal("GET\n/api/connector/v1/plans?x=1\n1763380800\nnonce-0123456789ab\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", canonical);
        // Maydanoz testindeki AYNI sabit: iki taraf aynı baytları imzalıyor.
        Assert.Equal("ab074ae63aafd73914ad6b9b9a23cd802ac237fa458e50fe482a853375c3a6a9", ConnectorSignature.Sign("k", canonical));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("short", false)]
    [InlineData("has space 0123456789", false)]
    [InlineData("0123456789abcdef", true)]
    [InlineData("abc-DEF_0123456789", true)]
    public void Nonce_Validation(string? nonce, bool ok) => Assert.Equal(ok, ConnectorSignature.IsValidNonce(nonce));

    [Fact]
    public void Matches_RejectsMalformed()
    {
        var sig = ConnectorSignature.Sign("k", "x");
        Assert.True(ConnectorSignature.Matches(sig, sig));
        Assert.False(ConnectorSignature.Matches(sig, null));
        Assert.False(ConnectorSignature.Matches(sig, new string('z', 64)));
        Assert.False(ConnectorSignature.Matches(sig, sig[..62]));
    }

    [Fact]
    public void ShortSecret_IsIgnored_SoGroupStaysClosed()
    {
        Assert.Empty(ConnectorAuthMiddleware.LoadKeys(Config(secret: "too-short")));
        var keys = ConnectorAuthMiddleware.LoadKeys(Config("plans.read, tenants.read"));
        Assert.True(keys["maydanoz"].Allows("plans.read"));
        Assert.False(keys["maydanoz"].Allows("settings.write"));
    }

    [Fact]
    public async Task NoKeysConfigured_Returns404_AndNeverReachesEndpoint()
    {
        var (mw, reached) = Middleware();
        var http = Signed("GET", "/api/connector/v1/ping");
        await mw.InvokeAsync(http, new ConfigurationBuilder().Build(), InMemory());
        Assert.Equal(404, http.Response.StatusCode);
        Assert.False(reached());
    }

    [Fact]
    public async Task ValidSignature_Passes_AndExposesKey()
    {
        var (mw, reached) = Middleware();
        var http = Signed("POST", "/api/connector/v1/tenants?page=1", "{\"a\":1}");
        await mw.InvokeAsync(http, Config(), InMemory());
        Assert.True(reached());
        Assert.IsType<ConnectorKey>(http.Items[ConnectorAuthMiddleware.KeyItem]);
        // Gövde uca yeniden okunabilir kalmalı.
        Assert.Equal("{\"a\":1}", await new StreamReader(http.Request.Body).ReadToEndAsync());
    }

    public static TheoryData<string, Func<DefaultHttpContext>> Tampered => new()
    {
        { "wrong secret", () => Signed("GET", "/api/connector/v1/ping", secret: Secret + "x") },
        { "unknown key", () => Signed("GET", "/api/connector/v1/ping", keyId: "other") },
        { "old timestamp", () => Signed("GET", "/api/connector/v1/ping", timestamp: DateTimeOffset.UtcNow.AddMinutes(-6).ToUnixTimeSeconds()) },
        { "future timestamp", () => Signed("GET", "/api/connector/v1/ping", timestamp: DateTimeOffset.UtcNow.AddMinutes(6).ToUnixTimeSeconds()) },
        { "bad nonce", () => Signed("GET", "/api/connector/v1/ping", nonce: "x") },
    };

    [Theory]
    [MemberData(nameof(Tampered))]
    public async Task Tampered_Returns401(string _, Func<DefaultHttpContext> make)
    {
        var (mw, reached) = Middleware();
        var http = make();
        await mw.InvokeAsync(http, Config(), InMemory());
        Assert.Equal(401, http.Response.StatusCode);
        Assert.False(reached());
    }

    [Fact]
    public async Task ChangedBody_AfterSigning_Returns401()
    {
        var (mw, reached) = Middleware();
        var http = Signed("POST", "/api/connector/v1/x", "{\"amount\":100}");
        var forged = Encoding.UTF8.GetBytes("{\"amount\":999}");
        http.Request.Body = new MemoryStream(forged);
        http.Request.ContentLength = forged.Length;
        await mw.InvokeAsync(http, Config(), InMemory());
        Assert.Equal(401, http.Response.StatusCode);
        Assert.False(reached());
    }

    [Fact]
    public async Task ChangedQuery_AfterSigning_Returns401()
    {
        var (mw, reached) = Middleware();
        var http = Signed("GET", "/api/connector/v1/tenants?page=1");
        http.Request.QueryString = new QueryString("?page=2");
        await mw.InvokeAsync(http, Config(), InMemory());
        Assert.Equal(401, http.Response.StatusCode);
        Assert.False(reached());
    }

    /// <summary>TEKRAR: aynı imzalı istek ikinci kez gelirse gerçek benzersiz indeks reddeder.</summary>
    [MySqlFact]
    public async Task ReplayedRequest_IsRejected_ByUniqueIndex()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var nonce = Guid.NewGuid().ToString("N");
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var (mw1, reached1) = Middleware();
        await using (var db = database.NewContext())
            await mw1.InvokeAsync(Signed("GET", "/api/connector/v1/ping", nonce: nonce, timestamp: ts), Config(), db);
        Assert.True(reached1());

        var (mw2, reached2) = Middleware();
        var replay = Signed("GET", "/api/connector/v1/ping", nonce: nonce, timestamp: ts);
        await using (var db = database.NewContext())
            await mw2.InvokeAsync(replay, Config(), db);
        Assert.Equal(401, replay.Response.StatusCode);
        Assert.False(reached2());
    }
}

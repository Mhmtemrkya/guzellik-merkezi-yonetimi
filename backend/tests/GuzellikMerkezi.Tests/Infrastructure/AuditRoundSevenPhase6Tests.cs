using System.Security.Claims;
using GuzellikMerkezi.Api.Realtime;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DERİN DENETİM — FAZ 6 (projeksiyon / taşıma).
///
/// <list type="bullet">
/// <item><b>M9</b> — Dışarı çıkan bağlantı guard'ı IPv6 ULA/multicast/belirsiz adresleri ve
/// çözülemeyen adları GÜVENLİ sayıyordu (fail-open).</item>
/// <item><b>M11</b> — Müşteri (portal) oturumu kurum İÇİ SignalR grubuna katılıyor, iç olayların
/// konu adı ve zamanlamasını görebiliyordu.</item>
/// </list>
/// </summary>
public sealed class AuditRoundSevenPhase6Tests
{
    // ── M9: dışarı çıkan bağlantı guard'ı fail-CLOSED ────────────────────────────────────

    [Theory]
    // IPv4 — bilinen özel aralıklar (eskiden de yakalanıyordu; gerileme koruması)
    [InlineData("127.0.0.1")]
    [InlineData("10.1.2.3")]
    [InlineData("192.168.1.10")]
    [InlineData("169.254.169.254")]   // bulut metadata
    [InlineData("172.16.0.5")]
    [InlineData("100.64.0.1")]        // CGNAT
    [InlineData("0.0.0.0")]
    // IPv6 — ASIL AÇIK: bunlar geçiyordu
    [InlineData("::1")]               // loopback
    [InlineData("::")]                // belirsiz adres
    [InlineData("fd00::1")]           // ULA (fc00::/7)
    [InlineData("fc00::1")]
    [InlineData("ff02::1")]           // multicast
    [InlineData("::ffff:169.254.169.254")]  // IPv4-eşlemeli metadata
    [InlineData("::ffff:127.0.0.1")]
    public void ValidateSmtp_PrivateOrLocalAddress_IsRejected(string host)
    {
        var error = OutboundEndpointGuard.ValidateSmtp(host, 587);
        Assert.NotNull(error);
    }

    /// <summary>
    /// ÇÖZÜLEMEYEN AD GÜVENLİ DEĞİLDİR: ad sonradan (bağlantı anında) iç bir adrese çözülebilir.
    /// Eskiden DNS hatası "sorun yok" sayılıyordu.
    /// </summary>
    [Fact]
    public void ValidateSmtp_UnresolvableHost_IsRejected()
    {
        var error = OutboundEndpointGuard.ValidateSmtp($"{Guid.NewGuid():N}.invalid", 587);
        Assert.NotNull(error);
    }

    /// <summary>KARŞIT DURUM: gerçek genel bir adres kabul edilir — kural fazla geniş değil.</summary>
    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("2606:4700:4700::1111")]
    public void ValidateSmtp_PublicAddress_IsAccepted(string host)
    {
        Assert.Null(OutboundEndpointGuard.ValidateSmtp(host, 587));
    }

    /// <summary>Port kısıtı korunur (kural gevşemedi).</summary>
    [Fact]
    public void ValidateSmtp_DisallowedPort_IsRejected()
    {
        Assert.NotNull(OutboundEndpointGuard.ValidateSmtp("8.8.8.8", 3306));
    }

    /// <summary>Allowlist dışı SMS host'u reddedilir; izinli host kabul edilir.</summary>
    [Fact]
    public void ValidateSmsApiUrl_EnforcesHostAllowlist()
    {
        Assert.NotNull(OutboundEndpointGuard.ValidateSmsApiUrl("https://evil.example.com/send"));
        Assert.Null(OutboundEndpointGuard.ValidateSmsApiUrl("https://api.netgsm.com.tr/sms"));
    }

    // ── M11: müşteri oturumu kurum grubuna girmez ────────────────────────────────────────

    private static RealtimeHub NewHub(IGroupManager groups, ClaimsPrincipal user)
    {
        var context = Substitute.For<HubCallerContext>();
        context.ConnectionId.Returns("conn-1");
        context.User.Returns(user);
        return new RealtimeHub { Context = context, Groups = groups };
    }

    private static ClaimsPrincipal Principal(Guid tenantId, Guid userId, Guid? customerId)
    {
        var claims = new List<Claim>
        {
            new("tenant_id", tenantId.ToString()),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
        };
        if (customerId is { } cid) claims.Add(new Claim("customer_id", cid.ToString()));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    /// <summary>
    /// ASIL İDDİA: müşteri (portal) bağlantısı <c>tenant:{id}</c> grubuna KATILMAZ — kurum içi
    /// olayların konu adını ve zamanlamasını görmemelidir. Yalnız kendi kişisel grubuna girer.
    /// </summary>
    [Fact]
    public async Task OnConnected_CustomerSession_DoesNotJoinTenantGroup()
    {
        var tenantId = Guid.CreateVersion7();
        var userId = Guid.CreateVersion7();
        var groups = Substitute.For<IGroupManager>();
        var hub = NewHub(groups, Principal(tenantId, userId, Guid.CreateVersion7()));

        await hub.OnConnectedAsync();

        await groups.DidNotReceive().AddToGroupAsync("conn-1", RealtimeHub.TenantGroup(tenantId), Arg.Any<CancellationToken>());
        await groups.Received(1).AddToGroupAsync("conn-1", RealtimeHub.UserGroup(userId), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// KARŞIT DURUM: personel/yönetici bağlantısı kurum grubuna KATILIR — kural fazla geniş değil,
    /// anlık tazeleme paneli çalışmaya devam eder.
    /// </summary>
    [Fact]
    public async Task OnConnected_StaffSession_JoinsTenantGroup()
    {
        var tenantId = Guid.CreateVersion7();
        var userId = Guid.CreateVersion7();
        var groups = Substitute.For<IGroupManager>();
        var hub = NewHub(groups, Principal(tenantId, userId, customerId: null));

        await hub.OnConnectedAsync();

        await groups.Received(1).AddToGroupAsync("conn-1", RealtimeHub.TenantGroup(tenantId), Arg.Any<CancellationToken>());
        await groups.Received(1).AddToGroupAsync("conn-1", RealtimeHub.UserGroup(userId), Arg.Any<CancellationToken>());
    }
}

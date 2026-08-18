using GuzellikMerkezi.Api.Services;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// PANEL GİRİŞİNDE İKİNCİ FAKTÖR — parola + e-postaya gelen kod.
///
/// <para>
/// Parola tek başına yetmiyordu: panel müşteri kişisel verisi, tahsilat ve kasa içeriyor.
/// Bu testler oturumun kod doğrulanmadan ASLA teslim edilmediğini sabitler.
/// </para>
/// </summary>
public sealed class PanelLoginOtpTests
{
    private static readonly UserProfileDto Profile = new(
        Guid.CreateVersion7(), "yonetici@ornek.test", "Deniz Kaya", UserRole.InstitutionOwner,
        Guid.CreateVersion7(), Guid.CreateVersion7(), Array.Empty<string>(), false);

    private static readonly LoginResponse Session =
        new("access-token", "refresh-token", DateTime.UtcNow.AddMinutes(60), Profile);

    private static IPlatformMessagingService NewMessaging(bool emailWorks = true)
    {
        var m = Substitute.For<IPlatformMessagingService>();
        m.SendEmailAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(emailWorks, !emailWorks, "id", emailWorks ? null : "smtp down"));
        return m;
    }

    private static PanelLoginOtpService NewService(IAuthService auth, IPlatformMessagingService messaging)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns("Production"); // devCode sızmasın
        return new PanelLoginOtpService(auth, new MemoryCache(new MemoryCacheOptions()), messaging, env,
            NullLogger<PanelLoginOtpService>.Instance);
    }

    private static IAuthService NewAuth(bool passwordOk = true)
    {
        var auth = Substitute.For<IAuthService>();
        auth.LoginAsync(Arg.Any<LoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(passwordOk
                ? Result<LoginResponse>.Success(Session)
                : Result<LoginResponse>.Failure(Error.Unauthorized("E-posta, rol veya parola hatalı.")));
        return auth;
    }

    private static LoginRequest Request() =>
        new("yonetici@ornek.test", "parola", UserRole.InstitutionOwner, Guid.CreateVersion7(), Guid.CreateVersion7());

    /// <summary>Doğru parola OTURUM DEĞİL, meydan okuma döndürür; kod e-postaya gider.</summary>
    [Fact]
    public async Task CorrectPassword_ReturnsChallenge_NotSession()
    {
        var messaging = NewMessaging();
        var result = await NewService(NewAuth(), messaging).StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(string.IsNullOrWhiteSpace(result.Value!.ChallengeId));
        Assert.Contains("•", result.Value.MaskedEmail);
        Assert.Null(result.Value.DevCode); // canlıda kod sızmaz
        await messaging.Received(1).SendEmailAsync(
            "yonetici@ornek.test", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Yanlış parolada KOD GÖNDERİLMEZ — e-posta bombardımanı yolu açılmasın.</summary>
    [Fact]
    public async Task WrongPassword_SendsNoCode()
    {
        var messaging = NewMessaging();
        var result = await NewService(NewAuth(passwordOk: false), messaging).StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
        await messaging.DidNotReceive().SendEmailAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// FAIL-CLOSED: kod gönderilemezse oturum TESLİM EDİLMEZ.
    /// "Gönderemedik, buyur gir" demek ikinci faktörü tamamen kaldırmak olurdu.
    /// </summary>
    [Fact]
    public async Task EmailFailure_RefusesLogin()
    {
        var result = await NewService(NewAuth(), NewMessaging(emailWorks: false))
            .StartAsync(Request(), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    /// <summary>Yanlış kod oturumu açmaz; doğru kod açar ve kod TEK KULLANIMLIKTIR.</summary>
    [Fact]
    public async Task Verify_RejectsWrongCode_AcceptsRightCodeOnce()
    {
        var messaging = NewMessaging();
        var service = NewService(NewAuth(), messaging);
        var start = await service.StartAsync(Request(), CancellationToken.None);

        var body = messaging.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
            .Select(c => (string)c.GetArguments()[2]!)
            .Single();
        var code = System.Text.RegularExpressions.Regex.Match(body, @">(\d{6})<").Groups[1].Value;

        Assert.True((await service.VerifyAsync(start.Value!.ChallengeId, "000000", CancellationToken.None)).IsFailure);

        var ok = await service.VerifyAsync(start.Value.ChallengeId, code, CancellationToken.None);
        Assert.True(ok.IsSuccess);
        Assert.Equal("access-token", ok.Value!.AccessToken);

        // Aynı kod ikinci kez kullanılamaz.
        Assert.True((await service.VerifyAsync(start.Value.ChallengeId, code, CancellationToken.None)).IsFailure);
    }

    /// <summary>5 yanlış denemede meydan okuma düşer; doğru kod bile artık çalışmaz.</summary>
    [Fact]
    public async Task Verify_LocksAfterFiveWrongAttempts()
    {
        var messaging = NewMessaging();
        var service = NewService(NewAuth(), messaging);
        var start = await service.StartAsync(Request(), CancellationToken.None);

        var body = messaging.ReceivedCalls()
            .Where(c => c.GetMethodInfo().Name == nameof(IPlatformMessagingService.SendEmailAsync))
            .Select(c => (string)c.GetArguments()[2]!)
            .Single();
        var code = System.Text.RegularExpressions.Regex.Match(body, @">(\d{6})<").Groups[1].Value;

        for (var i = 0; i < 5; i++)
            Assert.True((await service.VerifyAsync(start.Value!.ChallengeId, "000000", CancellationToken.None)).IsFailure);

        Assert.True((await service.VerifyAsync(start.Value!.ChallengeId, code, CancellationToken.None)).IsFailure);
    }

    /// <summary>Bilinmeyen/süresi dolmuş meydan okuma reddedilir.</summary>
    [Fact]
    public async Task Verify_UnknownChallenge_IsRejected()
    {
        var result = await NewService(NewAuth(), NewMessaging())
            .VerifyAsync("bilinmeyen", "123456", CancellationToken.None);

        Assert.True(result.IsFailure);
    }
}

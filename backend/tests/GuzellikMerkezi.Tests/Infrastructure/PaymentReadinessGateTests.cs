using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÖDEME YAPILANDIRMASI HAZIRLIK KAPISI.
///
/// <para>
/// Kapı kendi kural setini TAŞIMAZ; gerçek checkout'un kullandığı
/// <see cref="IPaymentGatewayResolver"/>'a sorar. İlk sürüm kuralları çoğaltıyordu ve kopya
/// zayıftı: tanınmayan sağlayıcı ("TypoPay") anahtarları varsa geçiyor, üretimde SANDBOX adresi
/// HTTPS olduğu için geçiyordu — readiness "hazır" derken checkout ya patlıyor ya da sandbox'tan
/// SAHTE PARA başarısı üretiyordu.
/// </para>
/// <para>
/// EN KRİTİK DAVRANIŞ KAPININ GEÇMESİ: üretim <c>PaymentsEnabled=0</c> ile çalışıyor. Kapalı ödeme
/// GEÇERLİ bir yapılandırmadır ve asla trafiği kesmemelidir.
/// </para>
/// </summary>
public sealed class PaymentReadinessGateTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    /// <summary>Çözücüyü taklit eder: çözücü neyi reddediyorsa kapı da onu reddetmeli.</summary>
    private sealed class StubResolver : IPaymentGatewayResolver
    {
        private readonly string? _rejectReason;
        public StubResolver(string? rejectReason = null) => _rejectReason = rejectReason;

        public Task<Result<PaymentGatewayContext>> ResolveAsync(CancellationToken ct = default) =>
            Task.FromResult(_rejectReason is null
                ? Result<PaymentGatewayContext>.Success(new PaymentGatewayContext(
                    new SimulationPaymentGateway("qa-secret"), "https://panel.test/donus"))
                : Result<PaymentGatewayContext>.Failure(Error.Conflict(_rejectReason)));
    }

    private static async Task<string?> IssueAsync(
        DbContextOptions<GuzellikDbContext> options, IPaymentGatewayResolver resolver)
    {
        await using var db = NewDb(options);
        return await PaymentConfigGate.DescribeAsync(db, resolver, CancellationToken.None);
    }

    private static async Task SeedAsync(DbContextOptions<GuzellikDbContext> options, bool paymentsEnabled)
    {
        await using var db = NewDb(options);
        var settings = new PlatformIntegrationSettings();
        settings.UpdatePayments(paymentsEnabled, "Iyzico", "enc-key", "enc-secret",
            "https://api.iyzipay.com", "https://panel.test/donus");
        db.PlatformIntegrationSettings.Add(settings);
        await db.SaveChangesAsync();
    }

    /// <summary>ÜRETİM YAPILANDIRMASI: ödeme kapalı → kapı GEÇER (en kritik test).</summary>
    [Fact]
    public async Task OdemeKapaliyken_KapiGecer()
    {
        var options = NewOptions();
        await SeedAsync(options, paymentsEnabled: false);

        // Çözücü reddetse BİLE kapı geçer: ödeme kapalıyken çözücüye hiç sorulmaz.
        Assert.Null(await IssueAsync(options, new StubResolver("çözücü reddi")));
    }

    /// <summary>Ayar satırı hiç yoksa da kapı geçmeli — yeni kurulum trafiğe alınabilir.</summary>
    [Fact]
    public async Task AyarSatiriYokken_KapiGecer()
    {
        Assert.Null(await IssueAsync(NewOptions(), new StubResolver("çözücü reddi")));
    }

    /// <summary>
    /// BLOCKER B1-a: TANINMAYAN SAĞLAYICI ("TypoPay") readiness'ten GEÇMEMELİ.
    ///
    /// Eski kapı "anahtarlar var mı" diye bakıyordu; TypoPay + anahtar = geçer diyordu. Çözücü ise
    /// aynı yapılandırmada checkout'u DURDURUYOR. Kapı artık çözücüye sorduğu için ikisi aynı fikirde.
    /// </summary>
    [Fact]
    public async Task TaninmayanSaglayici_KapiDuser()
    {
        var options = NewOptions();
        await SeedAsync(options, paymentsEnabled: true);

        var issue = await IssueAsync(options, new StubResolver("Tanınmayan ödeme sağlayıcısı: 'TypoPay'."));
        Assert.NotNull(issue);
        Assert.Contains("TypoPay", issue);
    }

    /// <summary>
    /// BLOCKER B1-b: ÜRETİMDE SANDBOX ADRESİ readiness'ten GEÇMEMELİ.
    ///
    /// Sandbox her çekimi gerçek para hareketi OLMADAN başarılı döner: canlı kurumlar ücretsiz
    /// abone olurdu. Eski kapı yalnız "HTTPS mi" diye baktığı için sandbox adresi geçiyordu.
    /// </summary>
    [Fact]
    public async Task UretimdeSandboxAdresi_KapiDuser()
    {
        var options = NewOptions();
        await SeedAsync(options, paymentsEnabled: true);

        var issue = await IssueAsync(options, new StubResolver("Canlı ortamda sandbox adresi kullanılamaz."));
        Assert.NotNull(issue);
        Assert.Contains("sandbox", issue, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Çözücü kabul ediyorsa kapı da geçer — kapı fazla sıkı olmamalı.</summary>
    [Fact]
    public async Task CozucuKabulEdiyorsa_KapiGecer()
    {
        var options = NewOptions();
        await SeedAsync(options, paymentsEnabled: true);

        Assert.Null(await IssueAsync(options, new StubResolver()));
    }
}

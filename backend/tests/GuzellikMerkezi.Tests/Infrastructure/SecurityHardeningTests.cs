using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// GÜVENLİK DENETİMİ REGRESYONLARI (31 Tem 2026 raporu).
/// Her test, raporda doğrulanmış bir bulgunun kapandığını kilitler.
/// </summary>
public sealed class SecurityHardeningTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    // =====================================================================================
    // F-03 — Pending-operation BOLA/IDOR
    // =====================================================================================

    [Fact]
    public async Task PendingOperation_StaffCannotReadOrCancelAnotherUsersRequest()
    {
        var options = NewOptions();
        var tenantId = Guid.CreateVersion7();
        var staffA = Guid.CreateVersion7();
        var staffB = Guid.CreateVersion7();
        Guid operationOfB;

        await using (var db = NewDb(options))
        {
            var op = new PendingOperation(
                tenantId, null, staffB, "Personel B", PendingOperationType.HttpReplay,
                "Müşteri güncelle", "özet", "{\"secret\":\"payload\"}", DateTime.MinValue);
            db.PendingOperations.Add(op);
            await db.SaveChangesAsync();
            operationOfB = op.Id;
        }

        await using (var db = NewDb(options))
        {
            // Get/Cancel bu bağımlılıklara dokunmaz (yalnız sorgu + durum değişimi).
            var service = new PendingOperationService(db, null!, null!, new NoopAuditLogger(), null!, new NoopRealtimeNotifier());

            // Personel A, B'nin işlemini ne okuyabilir ne iptal edebilir.
            var read = await service.GetAsync(tenantId, operationOfB, staffA, UserRole.Staff);
            Assert.True(read.IsFailure);
            Assert.Equal("NotFound", read.Error.Code);

            var cancel = await service.CancelAsync(tenantId, operationOfB, staffA, UserRole.Staff);
            Assert.True(cancel.IsFailure);

            // Sahibi okuyabilir; yönetici de kurum içindeki her işlemi görebilir.
            Assert.True((await service.GetAsync(tenantId, operationOfB, staffB, UserRole.Staff)).IsSuccess);
            Assert.True((await service.GetAsync(tenantId, operationOfB, staffA, UserRole.InstitutionOwner)).IsSuccess);
        }
    }

    // =====================================================================================
    // F-12 — Görsel/imza tip + boyut doğrulaması
    // =====================================================================================

    [Theory]
    [InlineData("https://tracker.example.com/pixel.png")]                 // harici URL → IP/referrer sızıntısı
    [InlineData("data:text/html;base64,PHNjcmlwdD4=")]                     // HTML
    [InlineData("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")]             // SVG (script taşıyabilir)
    [InlineData("data:image/png;base64,!!!not-base64!!!")]                 // bozuk base64
    [InlineData("data:image/png;base64,/9j/4AAQSkZJRg==")]                 // PNG denmiş ama JPEG baytları
    [InlineData("")]
    public void ImageDataUrl_RejectsUntrustedContent(string value)
    {
        Assert.NotNull(ImageDataUrl.Validate(value, ImageDataUrl.MaxSignatureBytes, "İmza görseli"));
    }

    [Fact]
    public void ImageDataUrl_AcceptsSmallPng_AndRejectsOversized()
    {
        // 1x1 saydam PNG.
        const string png = "data:image/png;base64," +
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        Assert.Null(ImageDataUrl.Validate(png, ImageDataUrl.MaxSignatureBytes, "İmza görseli"));

        // Aynı görsel, 1 KB'lık sınırla → reddedilir.
        Assert.NotNull(ImageDataUrl.Validate(png, 8, "İmza görseli"));
    }

    // =====================================================================================
    // F-10 — SSRF allowlist
    // =====================================================================================

    [Theory]
    [InlineData("http://api.netgsm.com.tr/sms/send/get")]   // HTTPS değil
    [InlineData("https://127.0.0.1/sms")]                    // loopback
    [InlineData("https://169.254.169.254/latest/meta-data")] // bulut metadata
    [InlineData("https://internal.corp.local/sms")]          // allowlist dışı
    public void OutboundGuard_RejectsUnsafeSmsEndpoints(string url)
    {
        Assert.NotNull(OutboundEndpointGuard.ValidateSmsApiUrl(url));
    }

    [Fact]
    public void OutboundGuard_AllowsKnownProviderAndEmptyValue()
    {
        Assert.Null(OutboundEndpointGuard.ValidateSmsApiUrl("https://api.netgsm.com.tr/sms/send/get"));
        Assert.Null(OutboundEndpointGuard.ValidateSmsApiUrl(null));
    }

    [Theory]
    [InlineData("127.0.0.1", 587)]      // loopback
    [InlineData("10.0.0.5", 587)]       // özel ağ
    [InlineData("smtp.example.com", 9)] // izinsiz port
    public void OutboundGuard_RejectsUnsafeSmtp(string host, int port)
    {
        Assert.NotNull(OutboundEndpointGuard.ValidateSmtp(host, port));
    }

    // =====================================================================================
    // F-06 — Hesap kilitleme
    // =====================================================================================

    [Fact]
    public void TenantUser_LocksAfterThreshold_AndUnlocksOnReset()
    {
        var tenant = new Tenant("QA", "qa-lockout", "Pro", TenantStatus.Active);
        var user = tenant.GrantAccess("a@b.test", UserRole.Staff, null, "Ad");
        var now = DateTime.UtcNow;

        for (var i = 0; i < 7; i++) user.RegisterFailedLogin(now, threshold: 8, TimeSpan.FromMinutes(15));
        Assert.False(user.IsLockedOut(now));

        user.RegisterFailedLogin(now, threshold: 8, TimeSpan.FromMinutes(15));
        Assert.True(user.IsLockedOut(now));
        Assert.False(user.IsLockedOut(now.AddMinutes(16))); // süre dolunca kendiliğinden açılır

        user.ResetFailedLogins();
        Assert.False(user.IsLockedOut(now));
    }

    // =====================================================================================
    // F-01 — Kayıt yalnız telefon doğrulandıktan sonra token üretir
    // =====================================================================================

    [Fact]
    public async Task CustomerRegister_IsRejected_WithoutAnyVerifiedChannel()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        // Hiçbir kanal kanıtlanmadıysa ERKEN döner; hiçbir bağımlılığa dokunulmaz.
        var service = new AuthService(db, null!, null!, null!, null!, null!, null!, null!, null!);

        var result = await service.CustomerRegisterAsync(
            new CustomerRegisterRequest("Ayşe Yılmaz", "05551112233", new DateOnly(1990, 1, 1), Gender.Female, null, KvkkConsent: true),
            phoneVerified: false,
            verifiedEmail: null);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
    }

    /// <summary>
    /// E-POSTA İLE DOĞRULAMANIN SINIRI: kod e-postaya gittiyse telefon sahipliği kanıtlanmamıştır.
    /// Bu yüzden başkasının numarasını yazan biri, o numaraya ait MEVCUT hesabı sahiplenemez —
    /// aksi hâlde e-posta kanalı bir hesap ele geçirme yoluna dönüşürdü.
    /// </summary>
    [Fact]
    public async Task CustomerRegister_WithEmailProofOnly_CannotClaimAnotherPersonsPhone()
    {
        var options = NewOptions();
        Guid tenantId;
        await using (var seed = NewDb(options))
        {
            var tenant = new Tenant("Bireysel Müşteriler", SystemTenant.IndividualSlug, "Sistem", TenantStatus.Active);
            var branch = tenant.AddBranch(SystemTenant.IndividualBranchName, "—", true);
            seed.Tenants.Add(tenant);
            await seed.SaveChangesAsync();
            tenantId = tenant.Id;

            // Numaranın gerçek sahibi — e-postası saldırganın adresi DEĞİL.
            var owner = new Customer(tenantId, branch.Id, "Ayşe Yılmaz", "05551112233", "ayse@example.com");
            seed.Customers.Add(owner);
            await seed.SaveChangesAsync();
        }

        await using var db = NewDb(options);
        var service = new AuthService(db, null!, null!, null!, null!, null!, null!, null!, null!);

        var result = await service.CustomerRegisterAsync(
            new CustomerRegisterRequest("Saldırgan Kişi", "05551112233", null, Gender.Unspecified, "saldirgan@example.com", KvkkConsent: true),
            phoneVerified: false,
            verifiedEmail: "saldirgan@example.com");

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
    }

    /// <summary>
    /// KVKK ONAYI OLMADAN KAYIT AÇILMAZ.
    ///
    /// <para>
    /// Eskiden kayıt <c>kvkkConsent: true</c> yazıyordu ama hiçbir ekran onay sormuyordu: hiç
    /// alınmamış bir hukuki beyan veritabanında "verildi" görünüyordu. Sunucu son kapıdır —
    /// istemci kutuyu gizlese ya da isteği elle kursa bile kayıt burada durur.
    /// </para>
    /// </summary>
    [Fact]
    public async Task CustomerRegister_IsRejected_WithoutKvkkConsent()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var service = new AuthService(db, null!, null!, null!, null!, null!, null!, null!, null!);

        var result = await service.CustomerRegisterAsync(
            new CustomerRegisterRequest("Ayşe Yılmaz", "05551112233", null, Gender.Female, null, KvkkConsent: false),
            phoneVerified: true,
            verifiedEmail: null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation", result.Error.Code);
    }
}

using System.Text;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ATOMİK "RANDEVU + KATALOG SATIŞI" UCUNUN SATIŞ YETKİSİ (deploy blocker, 3 Ağu 2026 — 3. tur).
///
/// <para>
/// Eski akışta satış üç çağrıydı: adisyon aç → kalem ekle → randevu. İlk iki adım
/// <c>/api/admin/adisyonlar</c> altındaydı ve <c>Accounting.Adisyon</c> iznini istiyordu. Atomik uç
/// (<c>POST /api/admin/appointments/with-sale</c>) yalnız <c>Appointments</c> izin grubunda olduğu
/// için, sadece randevu açma yetkisi olan personel isteğe <c>sale</c> ekleyerek satış
/// başlatabiliyordu. Kural iki yerde birden zorunlu: onay kapısında (istek taslağa bile girmesin)
/// ve serviste (kapı atlanırsa da geçerli).
/// </para>
/// </summary>
public sealed class WithSaleSalePermissionTests
{
    // ---------------------------------------------------------------- servis katmanı

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AppointmentService NewService(GuzellikDbContext db, ICurrentUser user)
    {
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), user);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), user, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), null!, user, adisyon, accounts);
    }

    /// <summary>Randevu açma yetkisi olan ama adisyon yetkisi verilmemiş personel.</summary>
    private static TestCurrentUser StaffWithoutSalePermission() =>
        new(UserRole.Staff, null, null, Permissions.Appointments, Permissions.AppointmentsCreate);

    private static CreateAppointmentWithSaleRequest Request(Guid customerId, Guid staffId, Guid serviceId, bool withSale)
    {
        var start = DateTime.UtcNow.AddDays(1);
        var appointment = new CreateAppointmentRequest(Guid.CreateVersion7(), customerId, staffId, serviceId, start, start.AddHours(1), 0m, null);
        return new CreateAppointmentWithSaleRequest(
            appointment,
            withSale ? new AppointmentCatalogSaleDto(serviceId, null, staffId) : null);
    }

    /// <summary>
    /// Accounting.Adisyon yetkisi OLMAYAN personel, randevu isteğine satış ekleyerek adisyon açamamalı.
    /// </summary>
    [Fact]
    public async Task CreateWithSale_StaffWithoutAdisyonPermission_IsForbidden()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var result = await NewService(db, StaffWithoutSalePermission()).CreateWithSaleAsync(
            Guid.CreateVersion7(), Request(Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), withSale: true));

        Assert.True(result.IsFailure);
        Assert.Equal("Forbidden", result.Error.Code);
    }

    /// <summary>Satışsız randevu yetki kısıtına takılmamalı (rutin işlem).</summary>
    [Fact]
    public async Task CreateWithoutSale_StaffWithoutAdisyonPermission_IsNotForbidden()
    {
        var options = NewOptions();
        await using var db = NewDb(options);
        var result = await NewService(db, StaffWithoutSalePermission()).CreateWithSaleAsync(
            Guid.CreateVersion7(), Request(Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), withSale: false));

        // Boş veritabanında başka nedenlerle düşer; ASIL İDDİA yetki reddi OLMAMASI.
        Assert.True(result.IsFailure);
        Assert.NotEqual("Forbidden", result.Error.Code);
    }

    /// <summary>Yetkili personelde satış yolu yetkiye takılmamalı.</summary>
    [Fact]
    public async Task CreateWithSale_StaffWithAdisyonPermission_IsNotForbidden()
    {
        var options = NewOptions();
        var staff = new TestCurrentUser(UserRole.Staff, null, null,
            Permissions.Appointments, Permissions.AppointmentsCreate, Permissions.AccountingAdisyon);

        await using var db = NewDb(options);
        var result = await NewService(db, staff).CreateWithSaleAsync(
            Guid.CreateVersion7(), Request(Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), withSale: true));

        Assert.True(result.IsFailure);
        Assert.NotEqual("Forbidden", result.Error.Code);
    }

    // ---------------------------------------------------------------- onay kapısı

    private static DefaultHttpContext GateRequest(string body)
    {
        var http = new DefaultHttpContext();
        http.Request.Method = "POST";
        http.Request.Path = "/api/admin/appointments/with-sale";
        http.Request.ContentType = "application/json";
        var bytes = Encoding.UTF8.GetBytes(body);
        http.Request.Body = new MemoryStream(bytes);
        http.Request.ContentLength = bytes.Length;
        http.Response.Body = new MemoryStream();
        return http;
    }

    private static IPendingOperationService NewPendingOpsStub()
    {
        var stub = Substitute.For<IPendingOperationService>();
        // Gövde kurmadan yeterli: kapıdan GEÇEN istek "onaya alınamadı" (400) yolunda biter;
        // testin iddiası çağrının YAPILIP yapılmadığıdır.
        stub.CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(), Arg.Any<string>(),
                Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>())
            .Returns(Result<PendingOperationDto>.Failure(Error.Validation("stub")));
        return stub;
    }

    private const string SaleBody =
        "{\"appointment\":{\"customerId\":\"11111111-1111-1111-1111-111111111111\"},\"sale\":{\"serviceDefinitionId\":\"22222222-2222-2222-2222-222222222222\"}}";

    private const string NoSaleBody =
        "{\"appointment\":{\"customerId\":\"11111111-1111-1111-1111-111111111111\"},\"sale\":null}";

    private static StaffApprovalGateMiddleware NewGate(Counter reached) =>
        new(_ =>
        {
            reached.Increment();
            return Task.CompletedTask;
        });

    private sealed class Counter
    {
        private int _value;
        public int Value => Volatile.Read(ref _value);
        public void Increment() => Interlocked.Increment(ref _value);
    }

    /// <summary>
    /// ASIL İDDİA: yetkisiz personelin satışlı isteği ONAY KUYRUĞUNA BİLE alınmamalı — 403.
    /// (Aksi hâlde yönetici onayladığında satış personelin yetkisi olmadan uygulanırdı.)
    /// </summary>
    [Fact]
    public async Task Gate_SaleWithoutAdisyonPermission_Is403_AndNotQueued()
    {
        var tenantId = Guid.CreateVersion7();
        var pendingOps = NewPendingOpsStub();
        var reached = new Counter();
        var http = GateRequest(SaleBody);

        await NewGate(reached).InvokeAsync(http,
            new TestCurrentUser(UserRole.Staff, tenantId, null, Permissions.Appointments, Permissions.AppointmentsCreate),
            new TestTenantContext(tenantId), pendingOps);

        Assert.Equal(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(0, reached.Value);
        await pendingOps.DidNotReceive().CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(),
            Arg.Any<string>(), Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Aynı personel SATIŞSIZ gönderirse istek normal şekilde onaya alınır.</summary>
    [Fact]
    public async Task Gate_WithoutSale_IsQueuedNormally()
    {
        var tenantId = Guid.CreateVersion7();
        var pendingOps = NewPendingOpsStub();
        var http = GateRequest(NoSaleBody);

        await NewGate(new Counter()).InvokeAsync(http,
            new TestCurrentUser(UserRole.Staff, tenantId, null, Permissions.Appointments, Permissions.AppointmentsCreate),
            new TestTenantContext(tenantId), pendingOps);

        Assert.NotEqual(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        await pendingOps.Received(1).CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(),
            Arg.Any<string>(), Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>());
    }

    /// <summary>Adisyon yetkisi olan personelin satışlı isteği onaya alınır.</summary>
    [Fact]
    public async Task Gate_SaleWithAdisyonPermission_IsQueued()
    {
        var tenantId = Guid.CreateVersion7();
        var pendingOps = NewPendingOpsStub();
        var http = GateRequest(SaleBody);

        await NewGate(new Counter()).InvokeAsync(http,
            new TestCurrentUser(UserRole.Staff, tenantId, null,
                Permissions.Appointments, Permissions.AppointmentsCreate, Permissions.AccountingAdisyon),
            new TestTenantContext(tenantId), pendingOps);

        Assert.NotEqual(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        await pendingOps.Received(1).CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(),
            Arg.Any<string>(), Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>());
    }
}

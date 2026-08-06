using System.Text;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CashClosing;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DENETİM TURU 8 — deploy provasında (NO-GO) çıkan kusurlar.
///
/// <list type="bullet">
/// <item><b>K1 — YETKİ AKLAMA:</b> onay kapısı, replay claim'ini görünce ERKEN ÇIKIYOR ve kendi
/// işlem-izni kontrolünü hiç çalıştırmıyordu. Personel yetkisi varken isteği kuyruğa atıyor,
/// yönetici yetkiyi geri alıyor, sonra isteği onaylıyordu → iş ARTIK OLMAYAN yetkiyle uygulanıyordu.
/// Onay "bu işi yap" demektir; "yetki denetimini atla" demek değildir.</item>
/// <item><b>K1b — GÜVENLİK DAMGASI:</b> replay istek sahibi adına YENİ token ürettiği için parola
/// sıfırlama / zorunlu çıkış gibi iptal olaylarını sessizce atlıyordu.</item>
/// </list>
/// </summary>
public sealed class AuditRoundEightTests
{
    // ── K1: onay kapısı replay'de de yetki arar ──────────────────────────────────────────

    private sealed class Counter
    {
        private int _value;
        public int Value => Volatile.Read(ref _value);
        public void Increment() => Interlocked.Increment(ref _value);
    }

    private static StaffApprovalGateMiddleware NewGate(Counter reached) =>
        new(_ => { reached.Increment(); return Task.CompletedTask; });

    /// <summary>Replay isteği: sunucunun kendi imzaladığı kısa ömürlü kapsam token'ı gibi işaretli.</summary>
    private static DefaultHttpContext ReplayRequest(string path, string method = "POST")
    {
        var http = new DefaultHttpContext();
        http.Request.Method = method;
        http.Request.Path = path;
        http.Request.ContentType = "application/json";
        var bytes = Encoding.UTF8.GetBytes("{}");
        http.Request.Body = new MemoryStream(bytes);
        http.Request.ContentLength = bytes.Length;
        http.Response.Body = new MemoryStream();
        http.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(IApprovalReplayer.ReplayClaimType, Guid.CreateVersion7().ToString())],
            "replay"));
        return http;
    }

    private static IPendingOperationService NewPendingOpsStub()
    {
        var stub = Substitute.For<IPendingOperationService>();
        stub.CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(), Arg.Any<string>(),
                Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>())
            .Returns(Result<PendingOperationDto>.Failure(Error.Validation("stub")));
        return stub;
    }

    /// <summary>
    /// ASIL İDDİA: izni GERİ ALINMIŞ personelin onaylanan isteği replay'de de 403 alır — onay,
    /// yetki denetimini aklamaz.
    /// </summary>
    [Fact]
    public async Task Replay_WithRevokedActionPermission_IsForbidden()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Counter();
        var http = ReplayRequest("/api/admin/appointments");

        // Personelin sayfa izni var ama AKSİYON izni (Appointments.Create) geri alınmış.
        var revoked = new TestCurrentUser(UserRole.Staff, tenantId, null, Permissions.Appointments, Permissions.AppointmentsStatus);

        await NewGate(reached).InvokeAsync(http, revoked, new TestTenantContext(tenantId), NewPendingOpsStub());

        Assert.Equal(StatusCodes.Status403Forbidden, http.Response.StatusCode);
        Assert.Equal(0, reached.Value);   // uca HİÇ ulaşmadı
    }

    /// <summary>
    /// KARŞIT DURUM: izin DURUYORSA replay normal şekilde uca ulaşır — kural fazla geniş değil,
    /// onaylanan işler uygulanmaya devam eder.
    /// </summary>
    [Fact]
    public async Task Replay_WithIntactPermission_ReachesEndpoint()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Counter();
        var http = ReplayRequest("/api/admin/appointments");

        var allowed = new TestCurrentUser(UserRole.Staff, tenantId, null, Permissions.Appointments, Permissions.AppointmentsCreate);

        await NewGate(reached).InvokeAsync(http, allowed, new TestTenantContext(tenantId), NewPendingOpsStub());

        Assert.Equal(1, reached.Value);
        Assert.NotEqual(StatusCodes.Status403Forbidden, http.Response.StatusCode);
    }

    /// <summary>
    /// Replay YENİDEN KUYRUĞA ALINMAZ (gerileme koruması): yetkisi yerinde olan replay uca gider,
    /// bekleyen işlem oluşturulmaz — aksi hâlde onaylanan iş sonsuza dek kuyrukta dönerdi.
    /// </summary>
    [Fact]
    public async Task Replay_IsNotQueuedAgain()
    {
        var tenantId = Guid.CreateVersion7();
        var reached = new Counter();
        var pendingOps = NewPendingOpsStub();
        var http = ReplayRequest("/api/admin/customers", "PUT");

        var allowed = new TestCurrentUser(UserRole.Staff, tenantId, null, Permissions.Customers, Permissions.CustomersManage);

        await NewGate(reached).InvokeAsync(http, allowed, new TestTenantContext(tenantId), pendingOps);

        Assert.Equal(1, reached.Value);
        await pendingOps.DidNotReceive().CreateAsync(Arg.Any<Guid>(), Arg.Any<Guid?>(), Arg.Any<Guid>(),
            Arg.Any<string>(), Arg.Any<CreatePendingOperationRequest>(), Arg.Any<CancellationToken>());
    }

    // ── Y6: tanınmayan ödeme sağlayıcısı simülasyona DÜŞMEZ ──────────────────────────────

    /// <summary>
    /// ASIL İDDİA: yazım hatası olan / tanınmayan sağlayıcı adı KAYIT ANINDA reddedilir.
    ///
    /// <para>
    /// Eskiden kural "Iyzico değilse simülasyon" idi: "Iyzıco" (Türkçe ı) ya da "iyzipay" yazan
    /// bir platform yöneticisi, üretimde para çekilmeden abonelik "ödendi" sayılmasına yol açardı.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData("Iyzıco")]      // Türkçe ı
    [InlineData("iyzipay")]
    [InlineData("Stripe")]
    [InlineData("simülasyon")]
    public void UpdatePayments_UnknownProvider_IsRejected(string provider)
    {
        var settings = new PlatformIntegrationSettings();
        var ex = Assert.Throws<GuzellikMerkezi.Domain.Exceptions.DomainException>(
            () => settings.UpdatePayments(true, provider, null, null, null, null));
        Assert.Contains("Tanınmayan ödeme sağlayıcısı", ex.Message);
    }

    /// <summary>
    /// KARŞIT DURUM: tanınan adlar kabul edilir ve KANONİK yazımla saklanır — büyük/küçük harf
    /// farkı aşağı akıştaki karşılaştırmaları bozmasın.
    /// </summary>
    [Theory]
    [InlineData("iyzico", "Iyzico")]
    [InlineData("IYZICO", "Iyzico")]
    [InlineData("simulation", "Simulation")]
    [InlineData(null, "Simulation")]
    public void UpdatePayments_KnownProvider_IsStoredCanonically(string? input, string expected)
    {
        var settings = new PlatformIntegrationSettings();
        settings.UpdatePayments(true, input, null, null, null, null);
        Assert.Equal(expected, settings.PaymentProvider);
    }

    // ── Y2: gider iptali geçmişi yeniden yazmaz, ters kayıt yazar ────────────────────────

    /// <summary>
    /// ASIL İDDİA: onaylı gider iptal edilince ASIL SATIR kendi döneminde KALIR ve iptalin
    /// yapıldığı güne negatif tutarlı bir ters kayıt yazılır.
    ///
    /// <para>
    /// Eskiden iptal yalnız damga koyuyor, okuma yolları satırı süzüyordu: GERÇEKLEŞMİŞ bir kasa
    /// çıkışı geçmişten siliniyordu. Geçen ayın kârı bugün değişiyor, o güne ait kasa kapanışı
    /// defterle tutmuyordu. Muhasebede kapanmış dönem yeniden yazılmaz.
    /// </para>
    /// </summary>
    [Fact]
    public async Task VoidExpense_KeepsOriginalInItsPeriod_AndWritesReversalOnVoidDate()
    {
        var options = NewOptions();
        var lastMonth = DateTime.UtcNow.AddDays(-40);
        Guid tenantId, expenseId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Gider QA", $"gider-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var expense = new BusinessExpense(tenant.Id, branch.Id, ExpenseCategory.Rent, 5000m, lastMonth);
            expense.Approve();
            db.BusinessExpenses.Add(expense);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            expenseId = expense.Id;
        }

        await using (var db = NewDb(options))
        {
            var owner = new TestCurrentUser(UserRole.InstitutionOwner, tenantId, null);
            var service = new ExpenseService(db, new NoopAuditLogger(), owner);
            var voided = await service.VoidAsync(tenantId, expenseId, new VoidExpenseRequest("Yanlis girildi, para cikmadi"));
            Assert.True(voided.IsSuccess, voided.IsFailure ? voided.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var rows = await check.BusinessExpenses.AsNoTracking().ToListAsync();
            Assert.Equal(2, rows.Count);

            var original = rows.Single(r => r.Id == expenseId);
            var reversal = rows.Single(r => r.Id != expenseId);

            // ASIL SATIR DEĞİŞMEDİ: tutarı ve tarihi yerinde — geçmiş dönem yeniden yazılmadı.
            Assert.Equal(5000m, original.Amount);
            Assert.Equal(lastMonth.Date, original.OccurredAtUtc.Date);
            Assert.NotNull(original.VoidedAtUtc);

            // TERS KAYIT: negatif tutar, iptal günü, asıl kayda bağlı ve onaylı.
            Assert.Equal(-5000m, reversal.Amount);
            Assert.Equal(expenseId, reversal.ReversalOfExpenseId);
            Assert.True(reversal.IsApproved);
            Assert.Equal(DateTime.UtcNow.Date, reversal.OccurredAtUtc.Date);

            // NET SIFIR: toplam artık "iptali süz" kuralı olmadan doğru çıkar.
            Assert.Equal(0m, rows.Where(r => r.IsApproved).Sum(r => r.Amount));
        }
    }

    /// <summary>
    /// Aynı gider İKİ KEZ iptal edilemez — ikinci ters kayıt defteri eksiye çekerdi.
    /// </summary>
    [Fact]
    public async Task VoidExpense_Twice_IsRejected()
    {
        var options = NewOptions();
        Guid tenantId, expenseId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Gider QA2", $"gider2-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var expense = new BusinessExpense(tenant.Id, branch.Id, ExpenseCategory.Rent, 1000m, DateTime.UtcNow);
            expense.Approve();
            db.BusinessExpenses.Add(expense);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            expenseId = expense.Id;
        }

        await using (var db = NewDb(options))
        {
            var owner = new TestCurrentUser(UserRole.InstitutionOwner, tenantId, null);
            var service = new ExpenseService(db, new NoopAuditLogger(), owner);
            Assert.True((await service.VoidAsync(tenantId, expenseId, new VoidExpenseRequest("Ilk iptal"))).IsSuccess);
        }

        await using (var db = NewDb(options))
        {
            var owner = new TestCurrentUser(UserRole.InstitutionOwner, tenantId, null);
            var service = new ExpenseService(db, new NoopAuditLogger(), owner);
            var second = await service.VoidAsync(tenantId, expenseId, new VoidExpenseRequest("Ikinci iptal"));
            Assert.True(second.IsFailure, "Ayni gider iki kez iptal edilebildi.");
        }

        await using (var check = NewDb(options))
            Assert.Equal(2, await check.BusinessExpenses.AsNoTracking().CountAsync());
    }

    // ── Y4: tahsilatı olan randevunun tamamlaması geri alınamaz ──────────────────────────

    /// <summary>
    /// ASIL İDDİA: /complete ucundan PARASI ALINMIŞ bir randevunun tamamlaması, tahsilat
    /// düzeltilmeden geri alınamaz.
    ///
    /// <para>
    /// Eski kapı yalnız BAĞLI SATIŞA bakıyordu. Satışa bağlanmamış ama ödemesi alınmış randevu
    /// geri alınabiliyor, tahsilat cari kartta SAHİPSİZ kalıyordu — Reference şifreli olduğu için
    /// hangi randevuya ait olduğu da bulunamıyordu. Bağ artık tahsilat satırında duruyor.
    /// </para>
    /// </summary>
    [Fact]
    public async Task VoidCompletion_WhenAppointmentHasPayment_IsRejected()
    {
        var options = NewOptions();
        Guid tenantId, branchId, customerId, staffId, serviceId, appointmentId, accountId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Odeme QA", $"odeme-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "ODEME MUSTERI", "0555 121 31 41", null);
            db.Customers.Add(customer);
            var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 45, 1000m, "Epilasyon");
            db.ServiceDefinitions.Add(service);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Cari", 1000m, 0m);
            db.CustomerAccounts.Add(account);
            var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
                DateTime.UtcNow.AddHours(-2), DateTime.UtcNow.AddHours(-1), 1000m);
            appointment.Complete();
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();

            // Randevuya BAĞLI tahsilat.
            db.AccountPayments.Add(new AccountPayment(account.Id, 1000m, "cash", "Randevu tahsilatı",
                DateTime.UtcNow, null, appointment.Id));
            await db.SaveChangesAsync();

            tenantId = tenant.Id; branchId = branch.Id; customerId = customer.Id;
            staffId = staff.Id; serviceId = service.Id; appointmentId = appointment.Id; accountId = account.Id;
        }

        await using (var db = NewDb(options))
        {
            var actor = new TestCurrentUser(UserRole.InstitutionOwner, tenantId, branchId);
            var accounts = new CustomerAccountService(db, new NoopAuditLogger(), actor);
            var adisyon = new AdisyonService(db, new NoopAuditLogger(), actor, accounts, new AllowAllFeatureService());
            var service = new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), null!,
                new CapturingJobQueue(), new NoopAppNotificationService(), actor, adisyon, accounts);

            var voided = await service.VoidCompletionAsync(tenantId, appointmentId,
                new VoidAppointmentCompletionRequest("Yanlis tamamlandi"));

            Assert.True(voided.IsFailure, "Tahsilati olan randevunun tamamlamasi geri alinabildi.");
            Assert.Equal("Conflict", voided.Error.Code);
            Assert.Contains("tahsilat", voided.Error.Message);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Completed, appointment.Status);   // durum değişmedi
            Assert.Equal(1, await check.AccountPayments.IgnoreQueryFilters().CountAsync(p => p.CustomerAccountId == accountId));
        }
    }

    // ── Y3: şube kasa kapanışı ───────────────────────────────────────────────────────────

    private sealed record CashSeed(Guid TenantId, Guid BranchA, Guid BranchB);

    private static async Task<CashSeed> SeedBranchesAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Kasa QA", $"kasa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var a = tenant.AddBranch("Şube A", "İstanbul", true);
        var b = tenant.AddBranch("Şube B", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return new CashSeed(tenant.Id, a.Id, b.Id);
    }

    private static CashClosingService NewClosings(GuzellikDbContext db, Guid tenantId, Guid? activeBranchId) =>
        new(db, new StubCashFlow(), new NoopAuditLogger(), new AllowAllFeatureService(),
            new NoopAppNotificationService(), new TestTenantContext(tenantId, activeBranchId));

    /// <summary>Kapanış testinin konusu kapsam/tekillik; tutar kaynağı sabitlenir.</summary>
    private sealed class StubCashFlow : ICashFlowService
    {
        public Task<Result<CashFlowSummaryDto>> SummaryAsync(Guid tenantId, CashFlowFilter filter, CancellationToken ct = default) =>
            Task.FromResult(Result<CashFlowSummaryDto>.Success(new CashFlowSummaryDto(
                1000m, 0m, 1000m, 1, 0, [new CashFlowMethodTotalDto("cash", 1000m, 0m, 1)])));

        public Task<Result<IReadOnlyCollection<CashFlowEntryDto>>> ListAsync(Guid tenantId, CashFlowFilter filter, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<Result<ProfitReportDto>> ProfitReportAsync(Guid tenantId, int months, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// ASIL İDDİA: iki şubenin AYNI güne ait kapanışları birbirini EZMEZ.
    ///
    /// <para>
    /// Mevcut kapanış araması şubeyi hiç dikkate almıyordu: B şubesi kapanış yapınca A'nın aynı
    /// güne ait satırını buluyor ve B'nin tutarlarıyla üzerine yazıyordu — A'nın kapanışı sessizce
    /// kayboluyordu.
    /// </para>
    /// </summary>
    [Fact]
    public async Task CashClosing_TwoBranchesSameDay_DoNotOverwriteEachOther()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var day = DateOnly.FromDateTime(DateTime.UtcNow);
        var request = new CreateCashClosingRequest(day, DateTime.UtcNow.AddHours(-8), DateTime.UtcNow, 0m, 900m, null, null);

        await using (var db = NewDb(options))
            Assert.True((await NewClosings(db, seed.TenantId, seed.BranchA).CreateAsync(seed.TenantId, request)).IsSuccess);

        await using (var db = NewDb(options))
            Assert.True((await NewClosings(db, seed.TenantId, seed.BranchB).CreateAsync(seed.TenantId, request)).IsSuccess);

        await using (var check = NewDb(options))
        {
            var rows = await check.CashRegisterClosings.IgnoreQueryFilters().AsNoTracking().ToListAsync();
            Assert.Equal(2, rows.Count);
            Assert.Contains(rows, r => r.BranchId == seed.BranchA);
            Assert.Contains(rows, r => r.BranchId == seed.BranchB);
        }
    }

    /// <summary>
    /// AYNI ŞUBE aynı gün ikinci kez kapatılırsa YENİ satır açılmaz — mevcut kayıt güncellenir
    /// ("yeniden say" akışı).
    /// </summary>
    [Fact]
    public async Task CashClosing_SameBranchTwice_UpdatesInsteadOfDuplicating()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);
        var day = DateOnly.FromDateTime(DateTime.UtcNow);

        await using (var db = NewDb(options))
            await NewClosings(db, seed.TenantId, seed.BranchA).CreateAsync(seed.TenantId,
                new CreateCashClosingRequest(day, DateTime.UtcNow.AddHours(-8), DateTime.UtcNow, 0m, 900m, null, null));

        await using (var db = NewDb(options))
            await NewClosings(db, seed.TenantId, seed.BranchA).CreateAsync(seed.TenantId,
                new CreateCashClosingRequest(day, DateTime.UtcNow.AddHours(-8), DateTime.UtcNow, 0m, 950m, "yeniden sayildi", null));

        await using (var check = NewDb(options))
        {
            var row = Assert.Single(await check.CashRegisterClosings.IgnoreQueryFilters().AsNoTracking().ToListAsync());
            Assert.Equal(950m, row.CountedCash);
        }
    }

    /// <summary>
    /// KURUM GENELİ KAPSAMDA ŞUBE KAPANIŞI REDDEDİLİR: tutarlar tüm şubelerin toplamıdır, tek bir
    /// şubenin kasasına yazılamaz.
    /// </summary>
    [Fact]
    public async Task CashClosing_BranchRequestedWhileTenantWideScope_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedBranchesAsync(options);

        await using var db = NewDb(options);
        var result = await NewClosings(db, seed.TenantId, activeBranchId: null).CreateAsync(seed.TenantId,
            new CreateCashClosingRequest(DateOnly.FromDateTime(DateTime.UtcNow), DateTime.UtcNow.AddHours(-8), DateTime.UtcNow, 0m, 900m, null, seed.BranchA));

        Assert.True(result.IsFailure, "Kurum geneli kapsamda sube kapanisi yazilabildi.");
        Assert.Equal("Validation", result.Error.Code);
    }

    // ── Y9: uzun iş kirasını uzatır (ortak kalp atışı) ───────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: iş çalışırken kira OTOMATİK uzar; kilit dolup iş ikinci kez alınmaz.
    ///
    /// <para>
    /// Kalp atışı yalnız DB poller'da vardı; RabbitMQ tüketicisi kirayı hiç uzatmıyordu. Artık
    /// ortak yardımcıdan (<c>DurableJobClaim.KeepAlive</c>) geliyor, yani iki yol ayrışamaz.
    /// Bakıcı KENDİ scope'unu açar: DbContext iş parçacığı güvenli olmadığı için, işle aynı bağlamı
    /// paylaşsaydı "second operation started on this context" hatası üretirdi.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task KeepAlive_ExtendsLease_WhileWorkIsRunning()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid jobId;

        await using (var db = database.NewContext())
        {
            var job = new BackgroundJob("qa.long", "{}");
            db.BackgroundJobs.Add(job);
            await db.SaveChangesAsync();
            jobId = job.Id;

            var tracked = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            // KISA kira: kalp atışı olmasaydı iş sürerken dolardı.
            Assert.True(await DurableJobClaim.TryClaimAsync(db, tracked, "worker-a", TimeSpan.FromSeconds(3), default));
        }

        DateTime? before;
        await using (var check = database.NewContext())
            before = (await check.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId)).LockedUntilUtc;

        var scopeFactory = database.NewServiceProvider().GetRequiredService<IServiceScopeFactory>();
        await using (DurableJobClaim.KeepAlive(scopeFactory, jobId, "worker-a", TimeSpan.FromSeconds(3)))
        {
            // "İş" sürerken en az bir vuruş geçsin (aralık = kira/3 ≈ 1 sn, taban 1 sn).
            await Task.Delay(TimeSpan.FromSeconds(2.5));
        }

        await using (var check = database.NewContext())
        {
            var job = await check.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.True(job.LockedUntilUtc > before, "Kalp atisi kirayi uzatmadi — uzun is yeniden alinabilirdi.");
            Assert.Equal("worker-a", job.LockToken);
        }
    }

    // ── K1b: güvenlik damgası değiştiyse replay uygulanmaz ───────────────────────────────

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static async Task<(Guid TenantId, Guid StaffId, DateTime? Stamp)> SeedStaffAsync(
        DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Tur8 QA", $"tur8-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var staff = tenant.GrantAccess($"p-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.Staff, null, "Personel");
        db.TenantUsers.Add(staff);
        await db.SaveChangesAsync();

        return (tenant.Id, staff.Id, staff.SecurityStampUtc);
    }

    /// <summary>
    /// ASIL İDDİA: istek gönderildikten SONRA güvenlik damgası değiştiyse (parola sıfırlama,
    /// zorunlu çıkış) onay replay'i uygulanmaz. Aksi hâlde ele geçirilmiş bir hesabın kuyrukta
    /// bekleyen isteği, parola sıfırlandıktan sonra bile çalışırdı.
    /// </summary>
    [Fact]
    public async Task RequesterScope_WhenSecurityStampChanged_RefusesToken()
    {
        var options = NewOptions();
        var (tenantId, staffId, stampAtRequest) = await SeedStaffAsync(options);
        // İstek anında damga YOKTU (hiç oturum iptali yaşanmamış) → sentinel kaydedilir.
        var recordedStamp = stampAtRequest ?? DateTime.MinValue;

        // Parola sıfırlama / zorunlu çıkış → damga tazelenir.
        await using (var db = NewDb(options))
        {
            var staff = await db.TenantUsers.SingleAsync(u => u.Id == staffId);
            staff.InvalidateSessions(DateTime.UtcNow.AddMinutes(1));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var scope = new ApprovalRequesterScope(db, TestTokens.Create());
            var result = await scope.CreateAccessTokenAsync(
                tenantId, staffId, null, Guid.CreateVersion7(), recordedStamp);

            Assert.True(result.IsFailure, "Damga degismisken replay token'i uretilebildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }
    }

    /// <summary>
    /// KARŞIT DURUM: damga DEĞİŞMEMİŞSE token normal şekilde üretilir — onaylar çalışmaya devam eder.
    /// </summary>
    [Fact]
    public async Task RequesterScope_WhenSecurityStampUnchanged_IssuesToken()
    {
        var options = NewOptions();
        var (tenantId, staffId, stampAtRequest) = await SeedStaffAsync(options);

        await using var db = NewDb(options);
        var scope = new ApprovalRequesterScope(db, TestTokens.Create());
        var result = await scope.CreateAccessTokenAsync(
            tenantId, staffId, null, Guid.CreateVersion7(), stampAtRequest ?? DateTime.MinValue);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.False(string.IsNullOrWhiteSpace(result.Value));
    }

    /// <summary>
    /// ESKİ KAYITLAR (damgasız) çalışmaya devam eder: geçiş sırasında kuyrukta bekleyen istekler
    /// kilitlenmemeli.
    /// </summary>
    [Fact]
    public async Task RequesterScope_LegacyOperationWithoutStamp_IssuesToken()
    {
        var options = NewOptions();
        var (tenantId, staffId, _) = await SeedStaffAsync(options);

        await using (var db = NewDb(options))
        {
            var staff = await db.TenantUsers.SingleAsync(u => u.Id == staffId);
            staff.InvalidateSessions(DateTime.UtcNow.AddMinutes(1));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var scope = new ApprovalRequesterScope(db, TestTokens.Create());
            var result = await scope.CreateAccessTokenAsync(tenantId, staffId, null, Guid.CreateVersion7(), null);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }
    }

    /// <summary>
    /// Bekleyen işlem OLUŞTURULURKEN damga kaydedilir — karşılaştırmanın dayanağı budur.
    /// </summary>
    [Fact]
    public async Task CreatePendingOperation_CapturesRequesterSecurityStamp()
    {
        var options = NewOptions();
        var (tenantId, staffId, stamp) = await SeedStaffAsync(options);

        await using (var db = NewDb(options))
        {
            var service = new PendingOperationService(db, null!, null!, new NoopAuditLogger(),
                new NoopAppNotificationService(), new NoopRealtimeNotifier());
            var created = await service.CreateAsync(tenantId, null, staffId, "Personel",
                new CreatePendingOperationRequest(PendingOperationType.HttpReplay, "Test", null, "{}"));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var op = await check.PendingOperations.AsNoTracking().SingleAsync();
            // Damgası olmayan kullanıcıda sentinel yazılır — böylece SONRADAN yapılan iptal yakalanır.
            Assert.Equal(stamp ?? DateTime.MinValue, op.RequesterSecurityStampUtc);
        }
    }
}

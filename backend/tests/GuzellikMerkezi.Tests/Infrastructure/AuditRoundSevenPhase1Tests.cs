using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DERİN DENETİM — FAZ 1 (güvenlik/billing sınırı).
///
/// <list type="bullet">
/// <item><b>C1</b> — Kurum sahibi <c>PUT /api/admin/tenant</c> ile ödeme yapmadan paket/dönem/durum
/// değiştirebiliyordu; profil ucu artık abonelik alanı taşımayan ayrı bir DTO/servis kullanıyor.</item>
/// <item><b>H13</b> — "Ödeme içeren tamamlama AccountingCollect'i atlıyor" iddiası; servis kapısı
/// kilitleniyor.</item>
/// <item><b>H16</b> — Personel tekil GET'i self-scope uygulamıyordu (meslektaşın e-postası,
/// telefonu, prim oranı ve izin listesi okunabiliyordu).</item>
/// </list>
/// </summary>
public sealed class AuditRoundSevenPhase1Tests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    // ── C1: kurum profili güncellemesi aboneliğe DOKUNAMAZ ────────────────────────────────

    private static TenantService NewTenants(GuzellikDbContext db) =>
        new(db, new PlainPasswordHasher(), new AllowAllFeatureService(), new NoopAuditLogger());

    /// <summary>
    /// ASIL İDDİA: profil güncellemesi paketi, dönemi ve durumu DEĞİŞTİREMEZ. Askıya alınmış bir
    /// kurum bu uçtan aktif/deneme yapılamaz, ücretli plan ödeme olmadan atanamaz.
    /// </summary>
    [Fact]
    public async Task UpdateProfile_CannotChangeSubscriptionPlanPeriodOrStatus()
    {
        var options = NewOptions();
        Guid tenantId;
        Guid paidPlanId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Denetim QA", $"denetim-{Guid.NewGuid():N}"[..20], "Deneme", TenantStatus.Trial);
            db.Tenants.Add(tenant);
            var paidPlan = new SubscriptionPlan("premium", "Premium", 1000m, 5, 20, 5000, 5000, 1000);
            db.SubscriptionPlans.Add(paidPlan);
            await db.SaveChangesAsync();
            tenant.Suspend();                       // ödeme yapılmadı → askıda
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            paidPlanId = paidPlan.Id;
        }

        await using (var db = NewDb(options))
        {
            // Profil ucunun DTO'sunda abonelik alanı YOKTUR: derleme düzeyinde de gönderilemez.
            var result = await NewTenants(db).UpdateProfileAsync(tenantId, new UpdateTenantProfileRequest(
                Name: "Yeni Ad", Domain: "yeni.example", OwnerName: "Sahip", Phone: "0555 000 00 00",
                TaxNumber: "123", Currency: "TRY", MaxInstallments: 6, OverdueGraceDays: 3));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var tenant = await check.Tenants.SingleAsync(t => t.Id == tenantId);
            Assert.Equal("Yeni Ad", tenant.Name);                       // profil güncellendi
            Assert.Equal(TenantStatus.Suspended, tenant.Status);        // ASKIDA KALDI
            Assert.Equal("Deneme", tenant.Plan);                        // paket değişmedi
            Assert.NotEqual(paidPlanId, tenant.SubscriptionPlanId ?? Guid.Empty);
            Assert.Null(tenant.SubscriptionEndsAtUtc);                  // abonelik başlatılmadı
        }
    }

    /// <summary>Platform yolu aboneliği değiştirmeye DEVAM eder (kural kurum sahibine kapalı, platforma değil).</summary>
    [Fact]
    public async Task PlatformUpdate_StillManagesSubscription()
    {
        var options = NewOptions();
        Guid tenantId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Platform QA", $"platform-{Guid.NewGuid():N}"[..20], "Deneme", TenantStatus.Trial);
            db.Tenants.Add(tenant);
            db.SubscriptionPlans.Add(new SubscriptionPlan("premium", "Premium", 1000m, 5, 20, 5000, 5000, 1000));
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await NewTenants(db).UpdateAsync(tenantId, new UpdateTenantRequest(
                Name: "Platform QA", Plan: "Premium", Status: TenantStatus.Active, Domain: null, OwnerName: null,
                Phone: null, TaxNumber: null, Currency: null, MaxInstallments: null, OverdueGraceDays: null,
                BillingPeriod: "Monthly"));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var tenant = await check.Tenants.SingleAsync(t => t.Id == tenantId);
            Assert.Equal("Premium", tenant.Plan);
            Assert.NotNull(tenant.SubscriptionEndsAtUtc);
        }
    }

    // ── H13: ödeme içeren tamamlama AccountingCollect ister ───────────────────────────────

    private sealed record ApptSeed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId, Guid AppointmentId);

    private static AppointmentService NewAppointments(GuzellikDbContext db, ICurrentUser actor)
    {
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), actor);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), actor, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), null!,
            new CapturingJobQueue(), new NoopAppNotificationService(), actor, adisyon, accounts);
    }

    private static async Task<ApptSeed> SeedAppointmentAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Izin QA", $"izin-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "IZIN MUSTERI", "0555 909 10 20", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Hizmet", 45, 500m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        // Onaylı satış: randevu oluşturma "hakkı olan müşteri" kuralına takılmasın.
        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 500m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();
        db.CustomerPackageSessions.Add(new CustomerPackageSession(tenant.Id, customer.Id, account.Id, Guid.Empty, service.Id, 5));
        var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
            DateTime.UtcNow.AddHours(2), DateTime.UtcNow.AddHours(2).AddMinutes(45), 0m, null);
        appointment.AssignNumber(10001);
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();

        return new ApptSeed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, appointment.Id);
    }

    /// <summary>
    /// ASIL İDDİA: tahsilat yetkisi OLMAYAN personel, randevuyu "ödeme ekleyerek" tamamlayarak
    /// tahsilat yazamaz. Reddedilen istekte randevu da tamamlanmaz, tahsilat da oluşmaz.
    /// </summary>
    [Fact]
    public async Task CompleteWithPayment_StaffWithoutCollectPermission_IsForbidden_AndNothingMutates()
    {
        var options = NewOptions();
        var seed = await SeedAppointmentAsync(options);
        // Randevu durum izni VAR, tahsilat izni YOK.
        var staffActor = new TestCurrentUser(UserRole.Staff, seed.TenantId, seed.BranchId, Permissions.AppointmentsStatus);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, staffActor).CompleteWithPaymentAsync(seed.TenantId, seed.AppointmentId,
            new CompleteAppointmentRequest(null,
                new CompleteAppointmentPaymentDto(250m, "cash", "Randevu tahsilatı", null, DateTime.UtcNow)));

        Assert.True(result.IsFailure, "Tahsilat yetkisi olmayan personel odeme yazabildi.");
        Assert.Equal("Forbidden", result.Error.Code);
        Assert.Empty(await db.AccountPayments.ToListAsync());
        var status = await db.Appointments.Where(a => a.Id == seed.AppointmentId).Select(a => a.Status).SingleAsync();
        Assert.NotEqual(AppointmentStatus.Completed, status);
    }

    /// <summary>Ödemesiz tamamlama aynı personel için ÇALIŞIR — kural fazla katı olmamalı.</summary>
    [Fact]
    public async Task CompleteWithoutPayment_StaffWithoutCollectPermission_IsAllowed()
    {
        var options = NewOptions();
        var seed = await SeedAppointmentAsync(options);
        var staffActor = new TestCurrentUser(UserRole.Staff, seed.TenantId, seed.BranchId, Permissions.AppointmentsStatus);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, staffActor)
            .CompleteWithPaymentAsync(seed.TenantId, seed.AppointmentId, new CompleteAppointmentRequest(null, null));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
    }

    // ── C2: onay replay'i İSTEK SAHİBİNİN kapsamıyla çalışır ─────────────────────────────

    /// <summary>Replay'e hangi token'ın verildiğini yakalar — "kimin yetkisiyle çalıştı" kanıtı.</summary>
    private sealed class TokenCapturingReplayer : IApprovalReplayer
    {
        public string? LastToken { get; private set; }
        public int Calls { get; private set; }

        public Task<Result<Guid?>> ReplayAsync(string payloadJson, string idempotencyKey, string requesterAccessToken, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastToken = requesterAccessToken;
            return Task.FromResult(Result<Guid?>.Success((Guid?)null));
        }
    }

    private sealed class ThrowingDispatcher : IApprovalDispatcher
    {
        public Task<Result<Guid?>> DispatchAsync(Guid tenantId, PendingOperationType type, string payloadJson, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Bu testte yalnız HttpReplay kullanılır.");
    }

    private sealed record ApprovalSeed(Guid TenantId, Guid BranchA, Guid BranchB, Guid StaffUserId, Guid ManagerUserId, Guid OperationId);

    private static async Task<ApprovalSeed> SeedApprovalAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Onay QA", $"onay-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branchA = tenant.AddBranch("Şube A", "İstanbul", true);
        var branchB = tenant.AddBranch("Şube B", "Ankara", false);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var staff = tenant.GrantAccess($"p-{Guid.NewGuid():N}"[..12] + "@qa.test", UserRole.Staff, branchA.Id, "Personel");
        staff.SetPermissions(new[] { Permissions.Appointments, Permissions.AppointmentsCreate });
        var manager = tenant.GrantAccess($"y-{Guid.NewGuid():N}"[..12] + "@qa.test", UserRole.InstitutionOwner, null, "Yönetici");
        db.TenantUsers.AddRange(staff, manager);
        await db.SaveChangesAsync();

        var op = new PendingOperation(tenant.Id, branchA.Id, staff.Id, "Personel",
            PendingOperationType.HttpReplay, "Randevu oluştur", "POST /api/admin/appointments", "{}");
        db.PendingOperations.Add(op);
        await db.SaveChangesAsync();

        return new ApprovalSeed(tenant.Id, branchA.Id, branchB.Id, staff.Id, manager.Id, op.Id);
    }

    private static PendingOperationService NewApprovals(GuzellikDbContext db, IApprovalReplayer replayer) =>
        new(db, new ThrowingDispatcher(), replayer, new NoopAuditLogger(), new NoopAppNotificationService(),
            new NoopRealtimeNotifier(), new ApprovalRequesterScope(db, TestTokens.Create()));

    /// <summary>
    /// ASIL İDDİA: replay ONAYLAYANIN değil, İSTEĞİ AÇAN personelin kapsamıyla çalışır. Üretilen
    /// token'ın kimlik/rol/şube claim'leri istek sahibine aittir; böylece uçtaki ve servisteki tüm
    /// kapsam kontrolleri doğru kimlik üzerinde yeniden değerlendirilir.
    /// </summary>
    [Fact]
    public async Task Approve_ReplaysWithRequesterScope_NotApproverAuthority()
    {
        var options = NewOptions();
        var seed = await SeedApprovalAsync(options);
        var replayer = new TokenCapturingReplayer();

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db, replayer)
                .ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerUserId, UserRole.InstitutionOwner);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        Assert.Equal(1, replayer.Calls);
        Assert.False(string.IsNullOrWhiteSpace(replayer.LastToken));

        var jwt = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(replayer.LastToken);
        Assert.Equal(seed.StaffUserId.ToString(), jwt.Claims.First(c => c.Type == "sub").Value);           // İSTEK SAHİBİ
        Assert.Equal(UserRole.Staff.ToString(), jwt.Claims.First(c => c.Type == "role").Value);            // onaylayanın rolü DEĞİL
        Assert.Equal(seed.BranchA.ToString(), jwt.Claims.First(c => c.Type == "branch_id").Value);         // isteğin şubesi
        Assert.Equal(seed.OperationId.ToString(),
            jwt.Claims.First(c => c.Type == IApprovalReplayer.ReplayClaimType).Value);                     // kapı bunu görüp yeniden kuyruğa almaz
        // İzinler istek sahibinin GÜNCEL izinleridir (yönetici izinleri değil).
        var permissions = jwt.Claims.Where(c => c.Type == "permission").Select(c => c.Value).ToArray();
        Assert.Contains(Permissions.AppointmentsCreate, permissions);
        Assert.DoesNotContain(Permissions.AccountingAdisyon, permissions);
    }

    /// <summary>İstek sahibinin erişimi kapatılmışsa onay UYGULANMAZ ve kayıt Pending kalır (sıfır mutasyon).</summary>
    [Fact]
    public async Task Approve_WhenRequesterDeactivated_IsRejectedWithoutReplay()
    {
        var options = NewOptions();
        var seed = await SeedApprovalAsync(options);
        var replayer = new TokenCapturingReplayer();

        await using (var db = NewDb(options))
        {
            var staff = await db.TenantUsers.SingleAsync(u => u.Id == seed.StaffUserId);
            staff.Disable();
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db, replayer)
                .ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerUserId, UserRole.InstitutionOwner);
            Assert.True(result.IsFailure, "Pasif personelin istegi onaylanabildi.");
        }

        Assert.Equal(0, replayer.Calls);
        await using (var check = NewDb(options))
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
            Assert.Equal(PendingOperationStatus.Pending, op.Status);   // Processing'de ASILI KALMADI
        }
    }

    /// <summary>Personel başka şubeye alındıysa bekleyen istek UYGULANMAZ (şube kapsamı değişmez).</summary>
    [Fact]
    public async Task Approve_WhenRequesterMovedToAnotherBranch_IsRejectedWithoutReplay()
    {
        var options = NewOptions();
        var seed = await SeedApprovalAsync(options);
        var replayer = new TokenCapturingReplayer();

        await using (var db = NewDb(options))
        {
            var staff = await db.TenantUsers.SingleAsync(u => u.Id == seed.StaffUserId);
            staff.ChangeScope(UserRole.Staff, seed.BranchB);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db, replayer)
                .ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerUserId, UserRole.InstitutionOwner);
            Assert.True(result.IsFailure, "Sube degisikligine ragmen istek onaylanabildi.");
        }

        Assert.Equal(0, replayer.Calls);
        await using (var check = NewDb(options))
        {
            Assert.Equal(PendingOperationStatus.Pending,
                (await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId)).Status);
        }
    }

    // ── H12: bileşik izin kararı TEK NOKTADA, çağrı yerleri rol-bağımsız ──────────────────

    public static TheoryData<UserRole, string[], bool> CompositePermissionMatrix => new()
    {
        // rol,                       izinler,                                                     satış yapabilir mi?
        { UserRole.Staff,             new[] { Permissions.Appointments },                          false },
        { UserRole.Staff,             new[] { Permissions.Appointments, Permissions.AccountingAdisyon }, true },
        { UserRole.BranchManager,     Array.Empty<string>(),                                       true },
        { UserRole.InstitutionOwner,  Array.Empty<string>(),                                       true },
    };

    /// <summary>
    /// ASIL İDDİA: "satış içeren randevu adisyon izni ister" kuralı ÇAĞRI YERİNDE role bakmadan
    /// uygulanır; rol semantiği tek karar noktasındadır (Permissions.IsGrantedTo).
    ///
    /// <para>
    /// Denetim bu kuralın yalnız Staff yolunda yazılı olduğunu bildirdi. Kuralı "role-independent
    /// reddet" diye birebir uygulamak yönetici rollerin izin listesi BOŞ olduğu için onları tümüyle
    /// kilitlerdi (şube yöneticisi zaten /api/admin/adisyonlar'dan doğrudan adisyon açabiliyor ve rol
    /// tablosunda CashWrite yetkisi var). Doğru çözüm ASP.NET Core'un yetkilendirme rehberindeki
    /// desendir: karar tek bir noktada verilir, çağrı yerleri yalnız gereken İZNİ söyler. Bu test
    /// hem personel kısıtını hem yönetici erişimini aynı anda sabitler.
    /// </para>
    /// </summary>
    [Theory]
    [MemberData(nameof(CompositePermissionMatrix))]
    public async Task CreateWithSale_CompositePermission_IsEnforcedForEveryRole(
        UserRole role, string[] permissions, bool expectAllowed)
    {
        var options = NewOptions();
        var seed = await SeedAppointmentAsync(options);
        var actor = new TestCurrentUser(role, seed.TenantId, seed.BranchId, permissions);

        await using var db = NewDb(options);
        var result = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
            new CreateAppointmentWithSaleRequest(
                new CreateAppointmentRequest(seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId,
                    DateTime.UtcNow.AddHours(6), DateTime.UtcNow.AddHours(6).AddMinutes(45), 0m, null),
                new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId)));

        if (expectAllowed)
        {
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }
        else
        {
            Assert.True(result.IsFailure, $"{role} adisyon izni olmadan satis acabildi.");
            Assert.Equal("Forbidden", result.Error.Code);
            Assert.Empty(await db.Adisyonlar.ToListAsync());
        }
    }

    /// <summary>Karar noktasının kendisi: rol modeli tek yerde ve beklendiği gibi.</summary>
    [Theory]
    [InlineData(UserRole.Staff, false, false)]
    [InlineData(UserRole.BranchManager, false, true)]
    [InlineData(UserRole.InstitutionOwner, false, true)]
    [InlineData(UserRole.Staff, true, true)]      // platform admin bayrağı her rolü geçer
    public void IsGrantedTo_EncodesTheRoleModelInOnePlace(UserRole role, bool isPlatformAdmin, bool expected)
    {
        var granted = Array.Empty<string>();
        Assert.Equal(expected, Permissions.IsGrantedTo(role, isPlatformAdmin, granted, Permissions.AccountingAdisyon));
    }

    // ── H14: simülasyon ödeme anahtarı forge EDİLEMEZ ─────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: dışarıdan üretilen form anahtarı kabul edilmez. Anahtar eskiden yalnız
    /// <c>sim_{conversationId}_{kuruş}</c> idi; işlem kimliği tahmin edilebildiği için kullanıcı
    /// kendi anahtarını üretip ödeme yapmadan "başarılı" sonuç aldırabiliyordu.
    /// </summary>
    [Theory]
    [InlineData("sim_chk-abc-123_100000")]                       // imzasız (eski biçim)
    [InlineData("sim_chk-abc-123_100000_deadbeefdeadbeefdeadbeefdeadbeef")]  // yanlış imza
    [InlineData("sim_chk-abc-123_1")]                            // düşük tutar denemesi
    public async Task SimulationGateway_ForgedToken_IsRejected(string forgedToken)
    {
        var gateway = new GuzellikMerkezi.Infrastructure.Payments.SimulationPaymentGateway("qa-signing-secret");

        var result = await gateway.RetrieveCheckoutAsync(forgedToken);

        Assert.True(result.IsSuccess);                 // taşıma başarılı ama ödeme DEĞİL
        Assert.False(result.Value!.Succeeded, "Sahte anahtar basarili odeme uretti.");
        Assert.Equal("SIM_BAD_TOKEN", result.Value.ErrorCode);
    }

    /// <summary>Sunucunun kendi ürettiği anahtar çalışmaya devam eder (kural fazla katı olmamalı).</summary>
    [Fact]
    public async Task SimulationGateway_ServerIssuedToken_IsAccepted()
    {
        var gateway = new GuzellikMerkezi.Infrastructure.Payments.SimulationPaymentGateway("qa-signing-secret");
        var init = await gateway.InitCheckoutAsync(new GuzellikMerkezi.Application.Features.Billing.CheckoutInitRequest(
            "chk-abc-123", 1000m, "Paket", "buyer", "Ad", "Soyad", "a@b.test", "0555", "11111111111",
            "Adres", "İstanbul", "127.0.0.1", "https://panel.test/donus"));
        Assert.True(init.IsSuccess, init.IsFailure ? init.Error.Message : null);

        var result = await gateway.RetrieveCheckoutAsync(init.Value!.CheckoutToken);

        Assert.True(result.Value!.Succeeded);
        Assert.Equal("chk-abc-123", result.Value.ConversationId);
        Assert.Equal(1000m, result.Value.PaidAmountTry);
    }

    /// <summary>Farklı sırla üretilen anahtar da reddedilir (sır sızmadıkça forge edilemez).</summary>
    [Fact]
    public async Task SimulationGateway_TokenSignedWithAnotherSecret_IsRejected()
    {
        var attacker = new GuzellikMerkezi.Infrastructure.Payments.SimulationPaymentGateway("attacker-secret");
        var init = await attacker.InitCheckoutAsync(new GuzellikMerkezi.Application.Features.Billing.CheckoutInitRequest(
            "chk-abc-123", 1000m, "Paket", "buyer", "Ad", "Soyad", "a@b.test", "0555", "11111111111",
            "Adres", "İstanbul", "127.0.0.1", "https://panel.test/donus"));

        var server = new GuzellikMerkezi.Infrastructure.Payments.SimulationPaymentGateway("qa-signing-secret");
        var result = await server.RetrieveCheckoutAsync(init.Value!.CheckoutToken);

        Assert.False(result.Value!.Succeeded);
    }

    // ── H16: personel tekil GET'i self-scope uygular ──────────────────────────────────────

    private static StaffService NewStaff(GuzellikDbContext db, ICurrentUser actor) =>
        new(db, new PlainPasswordHasher(), new AlwaysAllowUsageService(), new NoopAuditLogger());

    /// <summary>
    /// ASIL İDDİA: personel, BAŞKA bir personelin kaydını tekil GET ile okuyamaz. DTO e-posta,
    /// telefon, prim oranı ve izin listesi taşıdığı için bu bir bordro/PII sızıntısıydı.
    /// </summary>
    [Fact]
    public async Task GetStaffById_StaffRequestingAnotherStaff_IsNotFound()
    {
        var options = NewOptions();
        Guid tenantId, branchId, otherStaffId, requesterUserId, ownStaffId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Kapsam QA", $"kapsam-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var requesterUser = tenant.GrantAccess($"p-{Guid.NewGuid():N}"[..12] + "@qa.test", UserRole.Staff, branch.Id, "Personel");
            db.TenantUsers.Add(requesterUser);
            await db.SaveChangesAsync();

            var own = new StaffMember(tenant.Id, branch.Id, "Kendisi", "Uzman");
            own.LinkTenantUser(requesterUser.Id);
            var other = new StaffMember(tenant.Id, branch.Id, "Meslektas", "Uzman");
            other.SetCommissionRate(25m);
            db.StaffMembers.AddRange(own, other);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            branchId = branch.Id;
            otherStaffId = other.Id;
            ownStaffId = own.Id;
            requesterUserId = requesterUser.Id;
        }

        await using (var db = NewDb(options))
        {
            var actor = new TestCurrentUser(UserRole.Staff, tenantId, branchId) { UserId = requesterUserId };
            var service = NewStaff(db, actor);

            var foreign = await service.GetAsync(tenantId, otherStaffId, default, requesterUserId);
            Assert.True(foreign.IsFailure, "Personel meslektasinin kaydini okuyabildi.");
            Assert.Equal("NotFound", foreign.Error.Code);

            // KENDİ kaydı okunabilir (kural fazla katı olmamalı).
            var own = await service.GetAsync(tenantId, ownStaffId, default, requesterUserId);
            Assert.True(own.IsSuccess, own.IsFailure ? own.Error.Message : null);

            // Yönetici (kapsamsız çağrı) herkesi görmeye devam eder.
            var manager = await service.GetAsync(tenantId, otherStaffId);
            Assert.True(manager.IsSuccess, manager.IsFailure ? manager.Error.Message : null);
        }
    }
}

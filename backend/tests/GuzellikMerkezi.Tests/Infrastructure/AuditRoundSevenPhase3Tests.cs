using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DERİN DENETİM — FAZ 3 (provenance / yaşam döngüsü).
///
/// <list type="bullet">
/// <item><b>H4</b> — Randevuya AÇIKÇA seçilmiş paket seansı tükendiğinde kod sessizce "aynı
/// hizmetten herhangi bir seans"a kayıyor ve provenance'ı da o pakete yazıyordu.</item>
/// <item><b>H5</b> — Adisyon iptalinde hediye çeki bakiyesi şube/tenant süzgeci yüzünden "yok"
/// sayılıp sessizce iade edilmiyordu.</item>
/// <item><b>H7</b> — Sonucu doğrulanamayan onay sonsuza dek Processing'de kalıyordu: her tekrar
/// idempotency rezervasyonuna çarpıp "uygulanmış olabilir" diyordu, çıkış yolu yoktu.</item>
/// <item><b>M3</b> — Stoklu ürün silinince envanter değeri hareketsiz kayboluyordu.</item>
/// <item><b>M4</b> — Yanlış tamamlanan randevu için geri alma yolu yoktu; tüketilen seans
/// müşteride kayıp kalıyordu.</item>
/// </list>
/// </summary>
public sealed class AuditRoundSevenPhase3Tests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(
        DbContextOptions<GuzellikDbContext> options, ICurrentUser? actor = null, IDateTimeProvider? clock = null) =>
        new(options, null, actor ?? new TestCurrentUser(), clock, null, TestSearchIndex.Create());

    private static AppointmentService NewAppointments(GuzellikDbContext db, ICurrentUser actor)
    {
        var accounts = new CustomerAccountService(db, new NoopAuditLogger(), actor);
        var adisyon = new AdisyonService(db, new NoopAuditLogger(), actor, accounts, new AllowAllFeatureService());
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), null!,
            new CapturingJobQueue(), new NoopAppNotificationService(), actor, adisyon, accounts);
    }

    private sealed record Seed(
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId,
        Guid AccountId, Guid PackageAId, Guid PackageBId, Guid SessionAId, Guid SessionBId);

    /// <summary>
    /// Müşterinin AYNI hizmete ait İKİ paketi vardır (A ve B). H4/M4 iddiaları bu ayrımı gerektirir:
    /// yanlış pakete kayma ancak iki aday varken görülebilir.
    /// </summary>
    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Faz3 QA", $"faz3-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "FAZ3 MUSTERI", "0555 414 51 61", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 45, 1000m, "Epilasyon");
        db.ServiceDefinitions.Add(service);
        var packageA = new ServicePackage(tenant.Id, branch.Id, "Paket A", 5000m, 0m, 0);
        var packageB = new ServicePackage(tenant.Id, branch.Id, "Paket B", 5000m, 0m, 0);
        db.ServicePackages.AddRange(packageA, packageB);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, packageA.Id, "Paket A", 5000m, 0m);
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        var sessionA = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, packageA.Id, service.Id, 1);
        var sessionB = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, packageB.Id, service.Id, 5);
        db.CustomerPackageSessions.AddRange(sessionA, sessionB);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
            account.Id, packageA.Id, packageB.Id, sessionA.Id, sessionB.Id);
    }

    private static async Task<Guid> AddAppointmentAsync(
        DbContextOptions<GuzellikDbContext> options, Seed seed, Guid? boundSessionId, decimal price)
    {
        await using var db = NewDb(options);
        var appointment = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId,
            DateTime.UtcNow.AddHours(2), DateTime.UtcNow.AddHours(2).AddMinutes(45), price);
        if (boundSessionId is { } sid) appointment.LinkToPackageSession(sid);
        db.Appointments.Add(appointment);
        await db.SaveChangesAsync();
        return appointment.Id;
    }

    // ── H4: açık seçim bir komut sözleşmesidir ────────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: randevuya AÇIKÇA A paketi bağlıyken A tükendiyse tamamlama, B paketinden
    /// düşerek "başarılı" olmaz — çakışma bildirilir ve HİÇBİR seans tüketilmez.
    /// </summary>
    [Fact]
    public async Task Complete_BoundSessionExhausted_DoesNotSilentlyConsumeAnotherPackage()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        var appointmentId = await AddAppointmentAsync(options, seed, seed.SessionAId, 0m);

        // A paketi arada tükenir (başka bir randevu kullanmıştır).
        await using (var db = NewDb(options))
        {
            var a = await db.CustomerPackageSessions.SingleAsync(s => s.Id == seed.SessionAId);
            Assert.True(a.TryConsume());
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options, actor))
        {
            var result = await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));

            Assert.True(result.IsFailure, "Tukenmis bagli pakette tamamlama sessizce baska paketten dustu.");
            Assert.Equal("Conflict", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            // B paketine DOKUNULMADI: provenance başka pakete kaymadı.
            var b = await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == seed.SessionBId);
            Assert.Equal(0, b.UsedSessions);

            // Randevu da tamamlanmadı — bağ hâlâ A'yı gösteriyor.
            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.NotEqual(AppointmentStatus.Completed, appointment.Status);
            Assert.Equal(seed.SessionAId, appointment.SourceCustomerPackageSessionId);
        }
    }

    /// <summary>
    /// KARŞIT DURUM (kural fazla geniş olmasın): hiç seçim yapılmamış ÜCRETSİZ randevuda
    /// fallback korunur — uygun ilk seanstan düşülür ve bağ o seansa yazılır.
    /// </summary>
    [Fact]
    public async Task Complete_NoBoundSession_FreeAppointment_StillFallsBackToUsableSession()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        var appointmentId = await AddAppointmentAsync(options, seed, null, 0m);

        await using (var db = NewDb(options, actor))
        {
            var result = await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Completed, appointment.Status);
            Assert.NotNull(appointment.SourceCustomerPackageSessionId);

            var consumed = await check.CustomerPackageSessions.AsNoTracking()
                .SingleAsync(s => s.Id == appointment.SourceCustomerPackageSessionId);
            Assert.Equal(1, consumed.UsedSessions);
        }
    }

    // ── M4: yanlış tamamlamanın geri alınması ─────────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: yanlış tamamlanan randevu geri alınabilir ve tüketilen seans MÜŞTERİYE İADE
    /// edilir; randevu yeniden tamamlanabilir duruma döner.
    /// </summary>
    [Fact]
    public async Task VoidCompletion_RestoresConsumedSession_AndReopensAppointment()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        var appointmentId = await AddAppointmentAsync(options, seed, seed.SessionBId, 0m);

        await using (var db = NewDb(options, actor))
        {
            var completed = await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(completed.IsSuccess, completed.IsFailure ? completed.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var b = await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == seed.SessionBId);
            Assert.Equal(1, b.UsedSessions);   // tamamlama seansı tüketti
        }

        await using (var db = NewDb(options, actor))
        {
            var voided = await NewAppointments(db, actor).VoidCompletionAsync(seed.TenantId, appointmentId,
                new VoidAppointmentCompletionRequest("Personel yanlis randevuyu tamamladi"));
            Assert.True(voided.IsSuccess, voided.IsFailure ? voided.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var b = await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == seed.SessionBId);
            Assert.Equal(0, b.UsedSessions);   // HAK İADE EDİLDİ

            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Confirmed, appointment.Status);
            // Bağ korunur: yeniden tamamlandığında AYNI paketten düşsün.
            Assert.Equal(seed.SessionBId, appointment.SourceCustomerPackageSessionId);
        }
    }

    /// <summary>
    /// Geri alma ZORUNLU GEREKÇE ister ve gerekçesiz istek hiçbir şey değiştirmez.
    /// </summary>
    [Fact]
    public async Task VoidCompletion_WithoutReason_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        var appointmentId = await AddAppointmentAsync(options, seed, seed.SessionBId, 0m);

        await using (var db = NewDb(options, actor))
        {
            await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
        }

        await using (var db = NewDb(options, actor))
        {
            var voided = await NewAppointments(db, actor).VoidCompletionAsync(seed.TenantId, appointmentId,
                new VoidAppointmentCompletionRequest("  "));
            Assert.True(voided.IsFailure);
            Assert.Equal("Validation", voided.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Completed, appointment.Status);
            var b = await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == seed.SessionBId);
            Assert.Equal(1, b.UsedSessions);
        }
    }

    /// <summary>
    /// YETKİ AYRI: durum güncelleme izni olan personel tamamlamayı GERİ ALAMAZ — tüketilmiş hakkı
    /// iade eden bir düzeltmedir.
    /// </summary>
    [Fact]
    public async Task VoidCompletion_StaffWithOnlyStatusPermission_IsForbidden()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var owner = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        var appointmentId = await AddAppointmentAsync(options, seed, seed.SessionBId, 0m);

        await using (var db = NewDb(options, owner))
        {
            await NewAppointments(db, owner).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
        }

        var staff = new TestCurrentUser(UserRole.Staff, seed.TenantId, seed.BranchId,
            "Appointments", "Appointments.Status");

        await using (var db = NewDb(options, staff))
        {
            var voided = await NewAppointments(db, staff).VoidCompletionAsync(seed.TenantId, appointmentId,
                new VoidAppointmentCompletionRequest("Yanlis tamamlandi"));
            Assert.True(voided.IsFailure, "Durum izniyle tamamlama geri alinabildi.");
            Assert.Equal("Forbidden", voided.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var b = await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == seed.SessionBId);
            Assert.Equal(1, b.UsedSessions);
        }
    }

    /// <summary>
    /// PARA KAPISI: tamamlama bağlı satışı cariye işlediyse geri alma reddedilir — borcun/kasanın
    /// tek geri alma yolu satış iptalidir; iki ayrı geri alma yolu muhasebeyi bozardı.
    /// </summary>
    [Fact]
    public async Task VoidCompletion_WhenCompletionApprovedBoundSale_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        Guid appointmentId;

        await using (var db = NewDb(options, actor))
        {
            var created = await NewAppointments(db, actor).CreateWithSaleAsync(seed.TenantId,
                new CreateAppointmentWithSaleRequest(
                    new CreateAppointmentRequest(seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId,
                        DateTime.UtcNow.AddHours(4), DateTime.UtcNow.AddHours(4).AddMinutes(45), 0m, null),
                    new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId)));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            appointmentId = created.Value!.Id;
        }

        await using (var db = NewDb(options, actor))
        {
            var completed = await NewAppointments(db, actor).ChangeStatusAsync(seed.TenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(completed.IsSuccess, completed.IsFailure ? completed.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var sale = await check.Adisyonlar.AsNoTracking()
                .SingleAsync(a => a.AutoApproveOnFirstAppointment);
            Assert.Equal(AdisyonStatus.Approved, sale.Status);   // tamamlama satışı cariye işledi
        }

        await using (var db = NewDb(options, actor))
        {
            var voided = await NewAppointments(db, actor).VoidCompletionAsync(seed.TenantId, appointmentId,
                new VoidAppointmentCompletionRequest("Yanlis tamamlandi, geri alinsin"));
            Assert.True(voided.IsFailure, "Para hareketi ayaktayken tamamlama geri alinabildi.");
            Assert.Equal("Conflict", voided.Error.Code);
            Assert.Contains("satış", voided.Error.Message);
        }

        await using (var check = NewDb(options))
        {
            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Completed, appointment.Status);
        }
    }

    /// <summary>
    /// Tamamlanmamış randevuda geri alma anlamsızdır — sessizce "başarılı" dönmez.
    /// </summary>
    [Fact]
    public async Task VoidCompletion_NotCompletedAppointment_IsRejected()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var actor = new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId);
        var appointmentId = await AddAppointmentAsync(options, seed, seed.SessionBId, 0m);

        await using var db = NewDb(options, actor);
        var voided = await NewAppointments(db, actor).VoidCompletionAsync(seed.TenantId, appointmentId,
            new VoidAppointmentCompletionRequest("Gereksiz geri alma"));
        Assert.True(voided.IsFailure);
        Assert.Equal("Conflict", voided.Error.Code);
    }

    // ── H7: takılı onayın çıkış yolu ──────────────────────────────────────────────────────

    /// <summary>
    /// TAKILI ONAY KURULUMU: sonucu doğrulanamamış bir replay bırakır — kayıt Processing'de
    /// (zaman aşımını geçmiş) ve idempotency rezervasyonu "çözülmemiş" durumda.
    /// </summary>
    private static async Task<(Guid TenantId, Guid OperationId, Guid ManagerId)> SeedStuckApprovalAsync(
        DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Faz3 Onay", $"faz3onay-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var staff = tenant.GrantAccess($"personel-{Guid.NewGuid():N}"[..16] + "@qa.test", UserRole.Staff, null, "Personel");
        var manager = tenant.GrantAccess($"yonetici-{Guid.NewGuid():N}"[..16] + "@qa.test", UserRole.InstitutionOwner, null, "Yönetici");
        db.TenantUsers.AddRange(staff, manager);
        await db.SaveChangesAsync();

        var op = new PendingOperation(tenant.Id, null, staff.Id, "Personel",
            PendingOperationType.HttpReplay, "Tahsilat kaydı", "POST /api/admin/tahsilatlar", "{}", DateTime.MinValue);
        op.BeginProcessing(manager.Id);
        db.PendingOperations.Add(op);

        // Sonucu belirsiz kalan rezervasyon (StatusCode = 0 → IsPending).
        db.ProcessedClientRequests.Add(new ProcessedClientRequest(
            tenant.Id, Guid.Empty, $"sys:pendingop:{op.Id:N}", "DISPATCH", "/approvals/HttpReplay", 0, null, null));
        await db.SaveChangesAsync();

        // SAHİPLENMEYİ BAYATLAT. Elle Touch(geçmiş) yetmez: SaveChanges damgayı "şimdi" ile ezer
        // (bkz. GuzellikDbContext.ApplyAuditInfo). Geçmişe ayarlı saatle ayrı bir bağlamda yazılır —
        // gerçekte de sahiplenme dakikalar önce yapılmış olurdu.
        var past = DateTime.UtcNow - PendingOperation.ProcessingTimeout - TimeSpan.FromMinutes(1);
        await using (var stale = NewDb(options, null, new FixedClock(past)))
        {
            var tracked = await stale.PendingOperations.SingleAsync(x => x.Id == op.Id);
            tracked.Touch(past);
            await stale.SaveChangesAsync();
        }

        return (tenant.Id, op.Id, manager.Id);
    }

    private static PendingOperationService NewApprovals(GuzellikDbContext db) =>
        new(db, null!, null!, new NoopAuditLogger(), new NoopAppNotificationService(), new NoopRealtimeNotifier());

    /// <summary>
    /// ASIL İDDİA: takılı işlem sonsuza dek Processing'de kalmaz. Yetkili hedef kaydı kontrol edip
    /// "uygulanmış" derse işlem Approved'a kapanır ve iş TEKRARLANMAZ (rezervasyon tamamlanır).
    /// </summary>
    [Fact]
    public async Task ResolveStuck_Applied_ClosesOperationAndSealsIdempotencyKey()
    {
        var options = NewOptions();
        var (tenantId, operationId, managerId) = await SeedStuckApprovalAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, managerId,
                new ResolveStuckOperationRequest(true, "Tahsilat cari kartinda gorundu, dogrulandi"),
                UserRole.InstitutionOwner);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal(PendingOperationStatus.Approved, result.Value!.Status);
        }

        await using (var check = NewDb(options))
        {
            var op = await check.PendingOperations.AsNoTracking().SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Approved, op.Status);

            // Anahtar "uygulandı" damgalandı → olası bir tekrar işi ikinci kez uygulamaz.
            var reservation = await check.ProcessedClientRequests.AsNoTracking()
                .SingleAsync(x => x.IdempotencyKey == $"sys:pendingop:{operationId:N}");
            Assert.False(reservation.IsPending);
        }
    }

    /// <summary>
    /// Diğer yön: yetkili "uygulanmamış" derse işlem yeniden onaylanabilir duruma döner ve
    /// rezervasyon SERBEST bırakılır — dürüst tekrar artık duvara çarpmaz.
    /// </summary>
    [Fact]
    public async Task ResolveStuck_NotApplied_ReopensOperationAndReleasesKey()
    {
        var options = NewOptions();
        var (tenantId, operationId, managerId) = await SeedStuckApprovalAsync(options);

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, managerId,
                new ResolveStuckOperationRequest(false, "Cari kartta hicbir hareket yok"),
                UserRole.InstitutionOwner);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var op = await check.PendingOperations.AsNoTracking().SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Pending, op.Status);

            Assert.Null(await check.ProcessedClientRequests.AsNoTracking()
                .FirstOrDefaultAsync(x => x.IdempotencyKey == $"sys:pendingop:{operationId:N}"));
        }
    }

    /// <summary>
    /// SÜRMEKTE OLAN replay EZİLMEZ: zaman aşımını doldurmamış sahiplenmede elle çözüm reddedilir.
    /// </summary>
    [Fact]
    public async Task ResolveStuck_FreshClaim_IsRejected()
    {
        var options = NewOptions();
        var (tenantId, operationId, managerId) = await SeedStuckApprovalAsync(options);

        // Sahiplenmeyi TAZELE: replay az önce başlamış gibi.
        await using (var db = NewDb(options))
        {
            var op = await db.PendingOperations.SingleAsync(x => x.Id == operationId);
            op.Touch(DateTime.UtcNow);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, managerId,
                new ResolveStuckOperationRequest(true, "Aceleyle kapatmaya calisiyorum"),
                UserRole.InstitutionOwner);
            Assert.True(result.IsFailure, "Suren replay uzerine elle cozum yazilabildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var op = await check.PendingOperations.AsNoTracking().SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Processing, op.Status);
        }
    }

    /// <summary>
    /// DEFTERLE ÇELİŞKİ REDDEDİLİR: rezervasyon "uygulandı" diyorken yetkili "uygulanmadı" derse
    /// anahtar silinmez — aksi hâlde iş ikinci kez uygulanabilirdi.
    /// </summary>
    [Fact]
    public async Task ResolveStuck_NotApplied_ButLedgerSaysApplied_IsRejected()
    {
        var options = NewOptions();
        var (tenantId, operationId, managerId) = await SeedStuckApprovalAsync(options);

        await using (var db = NewDb(options))
        {
            var reservation = await db.ProcessedClientRequests
                .SingleAsync(x => x.IdempotencyKey == $"sys:pendingop:{operationId:N}");
            reservation.Complete(200, null, Guid.CreateVersion7().ToString());
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, managerId,
                new ResolveStuckOperationRequest(false, "Bence uygulanmadi"),
                UserRole.InstitutionOwner);
            Assert.True(result.IsFailure, "Defter 'uygulandi' derken anahtar serbest birakilabildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var reservation = await check.ProcessedClientRequests.AsNoTracking()
                .SingleAsync(x => x.IdempotencyKey == $"sys:pendingop:{operationId:N}");
            Assert.False(reservation.IsPending);
            var op = await check.PendingOperations.AsNoTracking().SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Processing, op.Status);
        }
    }

    /// <summary>
    /// Elle çözüm YÖNETİCİ kararıdır: personel kendi işlemini "uygulandı" ilan edip onay kapısını
    /// atlatamaz.
    /// </summary>
    [Fact]
    public async Task ResolveStuck_Staff_IsForbidden()
    {
        var options = NewOptions();
        var (tenantId, operationId, _) = await SeedStuckApprovalAsync(options);

        await using var db = NewDb(options);
        var staffId = await db.TenantUsers.AsNoTracking().Where(u => u.Role == UserRole.Staff)
            .Select(u => u.Id).SingleAsync();

        var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, staffId,
            new ResolveStuckOperationRequest(true, "Ben yaptim sayilsin"), UserRole.Staff);
        Assert.True(result.IsFailure, "Personel takili islemi kendisi kapatabildi.");
        Assert.Equal("Forbidden", result.Error.Code);
    }

    /// <summary>
    /// Gerekçe zorunludur: kim, neye bakarak karar verdi — denetim kaydında kalmalı.
    /// </summary>
    [Fact]
    public async Task ResolveStuck_WithoutNote_IsRejected()
    {
        var options = NewOptions();
        var (tenantId, operationId, managerId) = await SeedStuckApprovalAsync(options);

        await using var db = NewDb(options);
        var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, managerId,
            new ResolveStuckOperationRequest(true, " "), UserRole.InstitutionOwner);
        Assert.True(result.IsFailure);
        Assert.Equal("Validation", result.Error.Code);
    }

    /// <summary>
    /// DTO "takıldı" bilgisini TAŞIR: yönetici arayüzü bayat sahiplenmeyi ayırt edebilmeli,
    /// aksi hâlde kayıt sessizce "işleniyor" görünüp orada kalırdı.
    /// </summary>
    [Fact]
    public async Task PendingOperationDto_ExposesStuckFlag()
    {
        var options = NewOptions();
        var (tenantId, operationId, managerId) = await SeedStuckApprovalAsync(options);

        await using var db = NewDb(options);
        var dto = await NewApprovals(db).GetAsync(tenantId, operationId, managerId, UserRole.InstitutionOwner);
        Assert.True(dto.IsSuccess, dto.IsFailure ? dto.Error.Message : null);
        Assert.True(dto.Value!.IsStuck, "Bayat sahiplenme DTO'da takili gorunmuyor.");
    }

    // ── Gerçek veritabanı: kilit + atomiklik iddiaları ────────────────────────────────────

    /// <summary>
    /// M4 / GERÇEK VERİTABANI: aynı randevu için EŞZAMANLI iki geri alma isteğinde seans TAM
    /// OLARAK BİR KEZ iade edilir. InMemory sağlayıcıda gerçek kilit/transaction yoktur; bu iddia
    /// ancak MariaDB'de doğrulanabilir — aksi hâlde iki istek de "başarılı" olup müşteriye iki
    /// seans hediye edilirdi.
    /// </summary>
    [MySqlFact]
    public async Task VoidCompletion_ConcurrentCalls_RestoreSessionExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, appointmentId, sessionId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz3 SQL", $"faz3sql-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "FAZ3 SQL MUSTERI", "0555 717 81 91", null);
            db.Customers.Add(customer);
            var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(tenant.Id, branch.Id, "Lazer", 45, 1000m, "Epilasyon");
            db.ServiceDefinitions.Add(service);
            var package = new ServicePackage(tenant.Id, branch.Id, "Paket", 5000m, 0m, 0);
            db.ServicePackages.Add(package);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, package.Id, "Paket", 5000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            var session = new CustomerPackageSession(tenant.Id, customer.Id, account.Id, package.Id, service.Id, 5);
            db.CustomerPackageSessions.Add(session);
            var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id,
                DateTime.UtcNow.AddHours(2), DateTime.UtcNow.AddHours(2).AddMinutes(45), 0m);
            appointment.LinkToPackageSession(session.Id);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            appointmentId = appointment.Id;
            sessionId = session.Id;
        }

        var actor = new TestCurrentUser(UserRole.InstitutionOwner, tenantId, null);

        await using (var db = database.NewContext())
        {
            var completed = await NewAppointments(db, actor).ChangeStatusAsync(tenantId, appointmentId,
                new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, null));
            Assert.True(completed.IsSuccess, completed.IsFailure ? completed.Error.Message : null);
        }

        await using (var check = database.NewContext())
            Assert.Equal(1, (await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == sessionId)).UsedSessions);

        async Task<bool> VoidOnceAsync()
        {
            await using var db = database.NewContext();
            var result = await NewAppointments(db, actor).VoidCompletionAsync(tenantId, appointmentId,
                new VoidAppointmentCompletionRequest("Yanlis tamamlandi, geri alinsin"));
            return result.IsSuccess;
        }

        var outcomes = await Task.WhenAll(VoidOnceAsync(), VoidOnceAsync());
        Assert.Equal(1, outcomes.Count(ok => ok));   // tam olarak biri kazanır

        await using (var check = database.NewContext())
        {
            // SEANS BİR KEZ İADE EDİLDİ — 0'ın altına düşmedi, iki kez de iade edilmedi.
            var session = await check.CustomerPackageSessions.AsNoTracking().SingleAsync(s => s.Id == sessionId);
            Assert.Equal(0, session.UsedSessions);

            var appointment = await check.Appointments.AsNoTracking().SingleAsync(a => a.Id == appointmentId);
            Assert.Equal(AppointmentStatus.Confirmed, appointment.Status);
        }
    }

    /// <summary>
    /// H7 / GERÇEK VERİTABANI: elle çözüm KİLİTLENMEYİ GERÇEKTEN AÇAR. Çözümden sonra aynı
    /// idempotency anahtarı taze rezerve edilebilir — yani işlem bir daha denenebilir hâle gelir.
    /// Kilit/commit davranışı gerektiği için iddia MariaDB'de doğrulanır.
    /// </summary>
    [MySqlFact]
    public async Task ResolveStuck_NotApplied_UnblocksIdempotencyKeyOnRealDatabase()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, operationId, managerId;
        string key;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz3 Onay SQL", $"faz3osql-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var staff = tenant.GrantAccess($"p-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.Staff, null, "Personel");
            var manager = tenant.GrantAccess($"y-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.InstitutionOwner, null, "Yönetici");
            db.TenantUsers.AddRange(staff, manager);
            await db.SaveChangesAsync();

            var op = new PendingOperation(tenant.Id, null, staff.Id, "Personel",
                PendingOperationType.HttpReplay, "Tahsilat kaydı", "POST /api/admin/tahsilatlar", "{}", DateTime.MinValue);
            op.BeginProcessing(manager.Id);
            db.PendingOperations.Add(op);

            key = $"sys:pendingop:{op.Id:N}";
            db.ProcessedClientRequests.Add(new ProcessedClientRequest(
                tenant.Id, Guid.Empty, key, "DISPATCH", "/approvals/HttpReplay", 0, null, null));
            await db.SaveChangesAsync();

            // Sahiplenmeyi ham SQL ile bayatlat: damgalama mantığına dokunmadan zamanı geriye al.
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE pending_operations SET UpdatedAtUtc = {0} WHERE Id = {1}",
                DateTime.UtcNow - PendingOperation.ProcessingTimeout - TimeSpan.FromMinutes(1),
                op.Id.ToString());

            tenantId = tenant.Id;
            operationId = op.Id;
            managerId = manager.Id;
        }

        // Çözümden ÖNCE: anahtar "çözülmemiş" → yeni deneme duvara çarpar.
        await using (var db = database.NewContext())
        {
            var before = await OperationIdempotency.TryBeginAsync(db, tenantId, key, "DISPATCH", "/approvals/HttpReplay", default);
            Assert.Equal(OperationIdempotency.ClaimKind.Unresolved, before.Kind);
        }

        await using (var db = database.NewContext())
        {
            var result = await NewApprovals(db).ResolveStuckAsync(tenantId, operationId, managerId,
                new ResolveStuckOperationRequest(false, "Tahsilat kaydi hicbir yerde yok"),
                UserRole.InstitutionOwner);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.AsNoTracking().SingleAsync(x => x.Id == operationId);
            Assert.Equal(PendingOperationStatus.Pending, op.Status);

            // Çözümden SONRA: anahtar serbest → işlem gerçekten yeniden denenebilir.
            var after = await OperationIdempotency.TryBeginAsync(check, tenantId, key, "DISPATCH", "/approvals/HttpReplay", default);
            Assert.Equal(OperationIdempotency.ClaimKind.Started, after.Kind);
        }
    }

    // ── M3: stoklu ürün silinemez ─────────────────────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: bakiyesi olan ürün silinemez — envanter değeri hareketsiz kaybolmasın.
    /// </summary>
    [Fact]
    public async Task DeleteProduct_WithRemainingStock_IsRejected()
    {
        var options = NewOptions();
        Guid tenantId, productId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Faz3 Stok", $"faz3stok-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var product = new Product(tenant.Id, branch.Id, "Serum", ProductCategory.SkinCare, "adet", 100m, 250m, 7m, 1m);
            db.Products.Add(product);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            productId = product.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await new StockService(db, new NoopAuditLogger()).DeleteAsync(tenantId, productId);
            Assert.True(result.IsFailure, "Stogu olan urun silinebildi.");
            Assert.Equal("Conflict", result.Error.Code);
        }

        await using (var check = NewDb(options))
            Assert.NotNull(await check.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId));
    }

    // ── H5: hediye çeki bakiyesi süzgeç yüzünden kaybolmaz ────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: satış iptalinde, indirime bağlı hediye çeki SOFT-DELETE edilmiş olsa bile
    /// harcanan bakiyesi geri açılır. Global süzgeç yüzünden kart "yok" sayılırsa müşteri hem
    /// indirimini hem çekini kaybederdi.
    /// </summary>
    [Fact]
    public async Task ReverseAdisyon_SoftDeletedGiftCard_StillRestoresBalance()
    {
        var options = NewOptions();
        Guid tenantId, adisyonId, giftCardId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Faz3 Cek", $"faz3cek-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "CEK MUSTERI", "0555 515 61 71", null);
            db.Customers.Add(customer);
            // StoredValue: bakiyesi harcandıkça düşen gerçek hediye çeki — iade edilip edilmediği
            // ancak bu türde ölçülebilir (kuponlarda yalnız kullanım sayacı vardır).
            var card = new GiftCard(tenant.Id, branch.Id, $"CEK{Guid.NewGuid():N}"[..10].ToUpperInvariant(),
                GiftCardKind.StoredValue, 500m, null, 1, null, customer.Id);
            card.Redeem(200m, DateTime.UtcNow);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();

            var adisyon = new Adisyon(tenant.Id, branch.Id, customer.Id, null, "Cek testi");
            adisyon.AddItem(AdisyonItemType.Discount, card.Id, "Hediye çeki", 1, 200m, null, false);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();

            // Kart sonradan SOFT-DELETE edilir: global süzgeç onu sorgudan düşürür.
            db.GiftCards.Remove(card);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            adisyonId = adisyon.Id;
            giftCardId = card.Id;
        }

        await using (var db = NewDb(options))
        {
            var adisyon = await db.Adisyonlar.Include(a => a.Items).SingleAsync(a => a.Id == adisyonId);
            await new AdisyonEffectsReversal(db, new FixedClock(DateTime.UtcNow)).ReverseAsync(tenantId, adisyon);
            await db.SaveChangesAsync();
        }

        await using (var check = NewDb(options))
        {
            var card = await check.GiftCards.AsNoTracking().IgnoreQueryFilters().SingleAsync(g => g.Id == giftCardId);
            Assert.Equal(0, card.UsedCount);      // kullanım geri alındı
            Assert.Equal(500m, card.Balance);     // harcanan bakiye müşteriye döndü
        }
    }

    /// <summary>
    /// Kart GERÇEKTEN yoksa iptal DURUR: yarım geri alma (indirim geri alınmış ama çek bakiyesi
    /// kayıp) sessizce uygulanmaz.
    /// </summary>
    [Fact]
    public async Task ReverseAdisyon_MissingGiftCardRow_StopsCancellation()
    {
        var options = NewOptions();
        Guid tenantId, adisyonId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Faz3 Cek2", $"faz3cek2-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "CEK2 MUSTERI", "0555 616 71 81", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var adisyon = new Adisyon(tenant.Id, branch.Id, customer.Id, null, "Kayip cek");
            adisyon.AddItem(AdisyonItemType.Discount, Guid.CreateVersion7(), "Silinmiş hediye çeki", 1, 150m, null, false);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            adisyonId = adisyon.Id;
        }

        await using (var db = NewDb(options))
        {
            var adisyon = await db.Adisyonlar.Include(a => a.Items).SingleAsync(a => a.Id == adisyonId);
            await Assert.ThrowsAsync<GuzellikMerkezi.Domain.Exceptions.DomainException>(
                () => new AdisyonEffectsReversal(db, new FixedClock(DateTime.UtcNow)).ReverseAsync(tenantId, adisyon));
        }
    }

    /// <summary>
    /// KARŞIT DURUM: bakiyesi sıfırlanan ürün normal şekilde silinebilir (kural fazla geniş değil).
    /// </summary>
    [Fact]
    public async Task DeleteProduct_WithZeroStock_Succeeds()
    {
        var options = NewOptions();
        Guid tenantId, productId;

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Faz3 Stok0", $"faz3s0-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var product = new Product(tenant.Id, branch.Id, "Bos Serum", ProductCategory.SkinCare, "adet", 100m, 250m, 0m, 1m);
            db.Products.Add(product);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            productId = product.Id;
        }

        await using (var db = NewDb(options))
        {
            var result = await new StockService(db, new NoopAuditLogger()).DeleteAsync(tenantId, productId);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }
    }
}

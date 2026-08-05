using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.CustomerPortal;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DEPLOY BLOCKER REGRESYONLARI — GERÇEK MariaDB (5 Ağu 2026, altıncı tur).
///
/// <list type="number">
/// <item>İPTALİ GERİ ALINMIŞ SATIŞIN İADESİ MÜŞTERİ LİSTESİNDE İKİ KEZ DÜŞÜLÜYORDU: tutar hem
/// <c>CustomerAccount.RefundedAmount</c> alanına yazılıyor hem iade satırı canlı kalıyordu.
/// Ham SQL yolu yalnız ilişkisel sağlayıcıda çalışır → InMemory bunu gösteremez.</item>
/// <item>GENERIC ONAY DISPATCH'İNDE IDEMPOTENCY YOKTU: tahsilat/gider/stok hareketi commit
/// edildikten sonra süreç çökerse, bayat sahiplenme yeniden denendiğinde AYNI hareket ikinci kez
/// oluşuyordu. Yarış ve kilit davranışı yalnız gerçek veritabanında görülebilir.</item>
/// <item>PORTAL RANDEVU NUMARASI KİLİTSİZ MAX(Number)+1 İLE ÜRETİLİYORDU: eşzamanlı online
/// taleplerde benzersiz indeks ikinciyi reddediyor ve müşteri 500 görüyordu.</item>
/// </list>
/// </summary>
public sealed class DeployBlockerRoundSixMySqlTests
{
    // ═════════════════════════════════════════════════════════════════════════════════════
    // 1) İptali geri alınmış satışın iadesi TEK KEZ düşülür
    // ═════════════════════════════════════════════════════════════════════════════════════

    private static CustomerAccountService NewAccounts(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static CustomerService NewCustomers(GuzellikDbContext db) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), TestSearchIndex.Create(), new CapturingJobQueue());

    private sealed record RefundSeed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid AccountId);

    /// <summary>1.000 TL tahsil edilmiş bir satış kurar.</summary>
    private static async Task<RefundSeed> SeedPaidSaleAsync(MySqlTestDatabase database, string customerName, string phone)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Iade QA", $"iade-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, customerName, phone, null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 1000m, 0m);
        account.RegisterPayment(1000m, "cash", null, DateTime.UtcNow.AddDays(-5));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        return new RefundSeed(tenant.Id, branch.Id, customer.Id, account.Id);
    }

    /// <summary>Satışı 400 TL iadeyle iptal eder, sonra iadeyi KORUYARAK geri alır.</summary>
    private static async Task CancelWithRefundThenRestoreAsync(MySqlTestDatabase database, RefundSeed seed)
    {
        await using (var db = database.NewContext())
        {
            var cancelled = await NewAccounts(db).CancelSaleAsync(seed.TenantId, seed.AccountId,
                new CancelSaleRequest("müşteri vazgeçti", RefundedAmount: 400m, RefundMethod: "cash"));
            Assert.True(cancelled.IsSuccess, cancelled.IsFailure ? cancelled.Error.Message : null);
        }

        await using (var db = database.NewContext())
        {
            // VoidRefund YOK → iade korunur: para gerçekten çıktı, kasa defterinde durmalı.
            var restored = await NewAccounts(db).RestoreSaleAsync(seed.TenantId, seed.AccountId);
            Assert.True(restored.IsSuccess, restored.IsFailure ? restored.Error.Message : null);
        }
    }

    /// <summary>
    /// ASIL İDDİA: 1.000 tahsilat − 400 iade = 600 TL. Hata varken müşteri listesi 200 gösteriyordu
    /// (aynı iade hem <c>RefundedAmount</c> hem <c>refund_transactions</c> üzerinden düşülüyordu).
    /// </summary>
    [MySqlFact]
    public async Task RestoredSaleRefund_IsDeductedOnce_InCustomerList()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedPaidSaleAsync(database, "IADE MUSTERI", "0555 111 22 33");
        await CancelWithRefundThenRestoreAsync(database, seed);

        await using (var check = database.NewContext())
        {
            // Sahne doğru kuruldu mu: iade satırı CANLI ve cari alanı da dolu (çift kaynak).
            var account = await check.CustomerAccounts.SingleAsync(a => a.Id == seed.AccountId);
            Assert.Equal(400m, account.RefundedAmount);
            Assert.Equal(400m, (await check.RefundTransactions.SingleAsync()).Amount);
        }

        await using (var db = database.NewContext())
        {
            var list = await NewCustomers(db).ListAsync(seed.TenantId, new CustomerListQuery());
            Assert.True(list.IsSuccess, list.IsFailure ? list.Error.Message : null);
            var row = Assert.Single(list.Value!.Items);
            Assert.Equal(600m, row.TotalSpent);
        }

        // AYNI GERÇEK, DİĞER OKUMA YOLLARI: kart istatistiği ve dönemsiz harcama kartı da 600 demeli.
        await using (var db = database.NewContext())
        {
            var stats = await NewCustomers(db).GetSpendingStatsAsync(seed.TenantId, days: null);
            Assert.True(stats.IsSuccess);
            Assert.Equal(600m, stats.Value!.TotalSpent);
        }
    }

    /// <summary>
    /// HARCAMAYA GÖRE SIRALAMA, SATIRDA GÖSTERİLEN NET TUTARLA UYUMLU OLMALI. Sıralama yalnız canlı
    /// carilere bakıp iadeyi <c>RefundedAmount</c> üzerinden düşüyordu; iptali geri alınmış satışta
    /// bu, listedeki tutarla çelişen bir sıra üretiyordu.
    /// </summary>
    [MySqlFact]
    public async Task SpentSort_MatchesTheNetAmountShownInTheList()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedPaidSaleAsync(database, "IADELI MUSTERI", "0555 111 22 33");
        await CancelWithRefundThenRestoreAsync(database, seed);

        // Aynı kurumda ikinci müşteri: 500 TL ödedi, iadesi yok → iadeli müşterinin (600) ALTINDA olmalı.
        await using (var db = database.NewContext())
        {
            var second = new Customer(seed.TenantId, seed.BranchId, "AZ HARCAYAN", "0555 444 55 66", null);
            db.Customers.Add(second);
            await db.SaveChangesAsync();
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, second.Id, null, "Küçük paket", 500m, 0m);
            account.RegisterPayment(500m, "cash", null, DateTime.UtcNow.AddDays(-2));
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var list = await NewCustomers(db).ListAsync(seed.TenantId,
                new CustomerListQuery(Sort: CustomerListSort.Spent));
            Assert.True(list.IsSuccess, list.IsFailure ? list.Error.Message : null);

            var rows = list.Value!.Items.ToArray();
            Assert.Equal(2, rows.Length);
            // Sıra harcamaya göre azalan: 600 > 500. (Hata varken iadeli müşteri 200 hesaplanıp
            // ikinci sıraya düşüyordu — satırda ise 600 yazıyordu.)
            Assert.Equal(seed.CustomerId, rows[0].Id);
            Assert.Equal(600m, rows[0].TotalSpent);
            Assert.Equal(500m, rows[1].TotalSpent);
            Assert.True(rows[0].TotalSpent >= rows[1].TotalSpent, "Sıralama gösterilen net tutarla çelişiyor.");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════════════
    // 2) Generic approval dispatch — tam bir kez uygula
    // ═════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Gerçek bir mutasyonu taklit eder: her çağrıda tabloya SATIR EKLER. "Tam bir kez uygulandı"
    /// iddiası, satır sayısıyla kanıtlanır.
    /// </summary>
    private sealed class CountingDispatcher : IApprovalDispatcher
    {
        private readonly MySqlTestDatabase _database;
        private readonly Guid _tenantId;
        private readonly Guid _branchId;
        private int _calls;

        public CountingDispatcher(MySqlTestDatabase database, Guid tenantId, Guid branchId)
        {
            _database = database;
            _tenantId = tenantId;
            _branchId = branchId;
        }

        public int Calls => Volatile.Read(ref _calls);

        /// <summary>Mutasyon commit edilir ama çağırana YANIT DÖNMEZ (süreç çöktü / bağlantı koptu).</summary>
        public bool CrashAfterCommitOnce { get; init; }

        /// <summary>Hedef iş kuralında durur; hiçbir şey uygulanmaz.</summary>
        public bool DefiniteFailure { get; init; }

        private int _crashes;

        public async Task<Result<Guid?>> DispatchAsync(Guid tenantId, PendingOperationType type, string payloadJson, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _calls);
            // Gerçek dispatch iş yapar: eşzamanlı ikinci çağrıya kapının kapalı olduğunu görecek zaman tanı.
            await Task.Delay(250, cancellationToken);

            if (DefiniteFailure) return Result<Guid?>.Failure(Error.Validation("iş kuralı reddi"));

            // MUTASYON: gider satırı ekle (para etkileyen, sayılabilir bir hareket).
            await using var db = _database.NewContext();
            var expense = new BusinessExpense(_tenantId, _branchId, ExpenseCategory.Other, 250m,
                DateTime.UtcNow, ExpensePaymentMethod.Cash, "Onaylanan gider");
            db.BusinessExpenses.Add(expense);
            await db.SaveChangesAsync(cancellationToken);

            if (CrashAfterCommitOnce && Interlocked.Increment(ref _crashes) == 1)
                throw new InvalidOperationException("süreç çöktü (commit sonrası)");

            return Result<Guid?>.Success(expense.Id);
        }
    }

    private sealed class ThrowingReplayer : IApprovalReplayer
    {
        public Task<Result<Guid?>> ReplayAsync(string payloadJson, string idempotencyKey, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Bu testte HttpReplay kullanılmaz.");
    }

    private static PendingOperationService NewApprovals(GuzellikDbContext db, IApprovalDispatcher dispatcher) =>
        new(db, dispatcher, new ThrowingReplayer(), new NoopAuditLogger(),
            new NoopAppNotificationService(), new NoopRealtimeNotifier());

    private sealed record ApprovalSeed(Guid TenantId, Guid BranchId, Guid OperationId, Guid ManagerId);

    private static async Task<ApprovalSeed> SeedApprovalAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Onay Idempotency", $"onay-idem-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var staff = tenant.GrantAccess($"personel-{Guid.NewGuid():N}"[..16] + "@qa.test", UserRole.Staff, branch.Id, "Personel");
        var manager = tenant.GrantAccess($"yonetici-{Guid.NewGuid():N}"[..16] + "@qa.test", UserRole.InstitutionOwner, null, "Yönetici");
        db.TenantUsers.AddRange(staff, manager);
        await db.SaveChangesAsync();

        // GENERIC dispatch türü (HttpReplay DEĞİL): korumanın eksik olduğu yol tam olarak buydu.
        var op = new PendingOperation(tenant.Id, branch.Id, staff.Id, "Personel",
            PendingOperationType.CreateExpense, "Gider kaydı", "POST /api/admin/expenses", "{}");
        db.PendingOperations.Add(op);
        await db.SaveChangesAsync();

        return new ApprovalSeed(tenant.Id, branch.Id, op.Id, manager.Id);
    }

    /// <summary>Sahiplenmeyi bayatlatır (zaman aşımı) — çökmüş sürecin bıraktığı kayıt böyle kurtarılır.</summary>
    private static async Task MakeClaimStaleAsync(MySqlTestDatabase database, Guid operationId)
    {
        await using var db = database.NewContext();
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE pending_operations SET UpdatedAtUtc = {0} WHERE Id = {1}",
            DateTime.UtcNow.AddMinutes(-30), operationId.ToString());
    }

    private static Task<int> ExpenseCountAsync(MySqlTestDatabase database, Guid tenantId)
    {
        var db = database.NewContext();
        return db.BusinessExpenses.AsNoTracking().CountAsync(e => e.TenantId == tenantId)
            .ContinueWith(t => { db.Dispose(); return t.Result; }, TaskScheduler.Default);
    }

    /// <summary>
    /// ASIL İDDİA: mutasyon commit edildikten SONRA süreç çökerse (bekleyen kayıt Approved
    /// yapılamadan), zaman aşımıyla yapılan yeniden deneme AYNI hareketi ikinci kez OLUŞTURMAZ.
    /// </summary>
    [MySqlFact]
    public async Task GenericDispatch_CrashAfterCommit_RetryDoesNotDuplicateTheMutation()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedApprovalAsync(database);
        var dispatcher = new CountingDispatcher(database, seed.TenantId, seed.BranchId) { CrashAfterCommitOnce = true };

        // 1) İlk onay: gider yazıldı, sonra süreç çöktü → sonuç bilinmiyor.
        await using (var db = database.NewContext())
        {
            var first = await NewApprovals(db, dispatcher).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId);
            Assert.True(first.IsFailure);
        }
        Assert.Equal(1, await ExpenseCountAsync(database, seed.TenantId));

        // Sahiplenme BIRAKILMAZ: Pending'e dönerse ikinci onay işi tekrar uygulardı.
        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
            Assert.Equal(PendingOperationStatus.Processing, op.Status);
        }

        // 2) Bayat sahiplenmeyi kurtar ve yeniden dene.
        await MakeClaimStaleAsync(database, seed.OperationId);
        await using (var db = database.NewContext())
        {
            var retry = await NewApprovals(db, dispatcher).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId);
            // İlk deneme rezervasyonu "sonuç belirsiz" bıraktı → tekrar İŞ YAPMADAN durur.
            Assert.True(retry.IsFailure);
            Assert.Equal(IApprovalReplayer.UnknownOutcomeCode, retry.Error.Code);
        }

        // ASIL KANIT: dispatcher ikinci kez ÇAĞRILMADI ve gider tek satır kaldı.
        Assert.Equal(1, dispatcher.Calls);
        Assert.Equal(1, await ExpenseCountAsync(database, seed.TenantId));
    }

    /// <summary>
    /// Bayat Processing kaydı, hiçbir şey uygulanmamışsa (dispatcher hiç çağrılmadan çökme)
    /// yeniden denenebilir ve iş TAM BİR KEZ uygulanır.
    /// </summary>
    [MySqlFact]
    public async Task GenericDispatch_StaleProcessingWithoutSideEffect_IsRecoveredExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedApprovalAsync(database);
        var dispatcher = new CountingDispatcher(database, seed.TenantId, seed.BranchId);

        // Çökmüş süreç: kayıt Processing'de bırakılmış, henüz hiçbir şey uygulanmamış.
        await using (var db = database.NewContext())
        {
            var op = await db.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
            op.BeginProcessing(seed.ManagerId, false);
            await db.SaveChangesAsync();
        }
        await MakeClaimStaleAsync(database, seed.OperationId);

        await using (var db = database.NewContext())
        {
            var recovered = await NewApprovals(db, dispatcher).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId);
            Assert.True(recovered.IsSuccess, recovered.IsFailure ? recovered.Error.Message : null);
        }

        Assert.Equal(1, dispatcher.Calls);
        Assert.Equal(1, await ExpenseCountAsync(database, seed.TenantId));

        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
            Assert.Equal(PendingOperationStatus.Approved, op.Status);
        }
    }

    /// <summary>İki yönetici aynı anda onaylarsa mutasyon TAM BİR KEZ oluşur.</summary>
    [MySqlFact]
    public async Task GenericDispatch_ConcurrentApprove_AppliesMutationExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedApprovalAsync(database);
        var dispatcher = new CountingDispatcher(database, seed.TenantId, seed.BranchId);

        async Task<Result<PendingOperationDto>> ApproveAsync()
        {
            await using var db = database.NewContext();
            return await NewApprovals(db, dispatcher).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId);
        }

        var results = await Task.WhenAll(ApproveAsync(), ApproveAsync());

        Assert.Equal(1, results.Count(r => r.IsSuccess));
        Assert.Equal(1, results.Count(r => r.IsFailure));
        Assert.Equal(1, dispatcher.Calls);
        Assert.Equal(1, await ExpenseCountAsync(database, seed.TenantId));

        await using var check = database.NewContext();
        var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
        Assert.Equal(PendingOperationStatus.Approved, op.Status);
    }

    /// <summary>Onay ile RET yarışırsa tek karar kalır; mutasyon yine en fazla bir kez uygulanır.</summary>
    [MySqlFact]
    public async Task GenericDispatch_ApproveAndRejectRace_LeavesSingleDecision()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedApprovalAsync(database);
        var dispatcher = new CountingDispatcher(database, seed.TenantId, seed.BranchId);

        async Task<bool> ApproveAsync()
        {
            await using var db = database.NewContext();
            return (await NewApprovals(db, dispatcher).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId)).IsSuccess;
        }

        async Task<bool> RejectAsync()
        {
            await using var db = database.NewContext();
            return (await NewApprovals(db, dispatcher)
                .RejectAsync(seed.TenantId, seed.OperationId, seed.ManagerId, new RejectPendingOperationRequest("olmaz"))).IsSuccess;
        }

        var outcomes = await Task.WhenAll(ApproveAsync(), RejectAsync());
        Assert.True(outcomes.Count(x => x) <= 1, "Hem onay hem ret başarılı oldu: tek karar kalmalıydı.");

        await using var check = database.NewContext();
        var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
        Assert.NotEqual(PendingOperationStatus.Pending, op.Status);
        // Onay kazandıysa tek gider, ret kazandıysa hiç gider olmalı — asla iki tane.
        Assert.True(await ExpenseCountAsync(database, seed.TenantId) <= 1);
    }

    /// <summary>
    /// KESİN İŞ KURALI REDDİNDE anahtar SERBEST BIRAKILIR: düzeltilip yeniden onaylanabilmeli
    /// (idempotency koruması meşru tekrarı kalıcı olarak bloklamamalı).
    /// </summary>
    [MySqlFact]
    public async Task GenericDispatch_DefiniteRejection_ReleasesTheKeyForAnHonestRetry()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedApprovalAsync(database);

        await using (var db = database.NewContext())
        {
            var rejected = new CountingDispatcher(database, seed.TenantId, seed.BranchId) { DefiniteFailure = true };
            var first = await NewApprovals(db, rejected).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId);
            Assert.True(first.IsFailure);
        }

        // Kayıt Pending'e bırakıldı (kesin reddedildi) → yeniden onaylanabilir.
        await using (var check = database.NewContext())
        {
            var op = await check.PendingOperations.SingleAsync(x => x.Id == seed.OperationId);
            Assert.Equal(PendingOperationStatus.Pending, op.Status);
        }

        var dispatcher = new CountingDispatcher(database, seed.TenantId, seed.BranchId);
        await using (var db = database.NewContext())
        {
            var retry = await NewApprovals(db, dispatcher).ApproveAsync(seed.TenantId, seed.OperationId, seed.ManagerId);
            Assert.True(retry.IsSuccess, retry.IsFailure ? retry.Error.Message : null);
        }

        Assert.Equal(1, dispatcher.Calls);
        Assert.Equal(1, await ExpenseCountAsync(database, seed.TenantId));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════
    // 2b) Önceden onaylanmış bağlı satışta tahsilat KENDİ carisine gider
    // ═════════════════════════════════════════════════════════════════════════════════════

    private static AdisyonService NewAdisyon(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private static AppointmentService NewAppointments(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AppointmentService(db, new AlwaysAllowUsageService(), new NoopAuditLogger(),
            null!, new CapturingJobQueue(), new NoopAppNotificationService(), user, NewAdisyon(db),
            new CustomerAccountService(db, new NoopAuditLogger(), user));
    }

    private sealed record BoundSaleSeed(
        Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId, Guid OldDebtAccountId);

    /// <summary>Müşteriye ESKİ ve BORÇLU bir cari kurar — yanlış hedef seçilirse para oraya kayar.</summary>
    private static async Task<BoundSaleSeed> SeedCustomerWithOldDebtAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Bagli Satis", $"bagli-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "BAGLI MUSTERI", "0555 616 71 81", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Hizmet", 45, 1000m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        // ESKİ BORÇ: hiç ödenmemiş, bu yüzden "borcu olan en eski cari" fallback'inin ilk adayı.
        var oldDebt = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Eski paket", 5000m, 0m);
        db.CustomerAccounts.Add(oldDebt);
        await db.SaveChangesAsync();

        return new BoundSaleSeed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, oldDebt.Id);
    }

    /// <summary>Randevu + bekleyen satış açar ve satışı ELLE onaylar (randevu tamamlanmadan).</summary>
    private static async Task<(Guid AppointmentId, Guid SaleId, Guid SaleAccountId)> CreateAndApproveSaleAsync(
        MySqlTestDatabase database, BoundSaleSeed seed, int hourOffset)
    {
        Guid appointmentId, saleId;
        await using (var db = database.NewContext())
        {
            var request = new CreateAppointmentWithSaleRequest(
                new CreateAppointmentRequest(seed.BranchId, seed.CustomerId, seed.StaffId, seed.ServiceId,
                    DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(45), 0m, null),
                new AppointmentCatalogSaleDto(seed.ServiceId, null, seed.StaffId));

            var created = await NewAppointments(db).CreateWithSaleAsync(seed.TenantId, request);
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            appointmentId = created.Value!.Id;

            saleId = await db.Appointments.AsNoTracking()
                .Where(a => a.Id == appointmentId).Select(a => a.SourceAdisyonId!.Value).SingleAsync();
        }

        // SATIŞ RANDEVUDAN ÖNCE ELLE ONAYLANIR: otomatik onay artık tetiklenmez, dolayısıyla
        // tamamlamada dönen "otomatik onaylanan cari" BOŞ kalır — hatanın tetikleyicisi budur.
        await using (var db = database.NewContext())
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, saleId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var accountId = await check.Adisyonlar.AsNoTracking()
                .Where(a => a.Id == saleId).Select(a => a.CustomerAccountId).SingleAsync();
            Assert.NotNull(accountId);
            return (appointmentId, saleId, accountId!.Value);
        }
    }

    /// <summary>
    /// ASIL İDDİA: bağlı satış DAHA ÖNCE onaylanmış olsa bile randevu tahsilatı O SATIŞIN carisine
    /// yazılır. Eskiden otomatik onay tetiklenmediği için hedef boş kalıyor ve para müşterinin
    /// borçlu ESKİ carisine yazılıyordu (yeni satış ödenmemiş görünüyordu).
    /// </summary>
    [MySqlFact]
    public async Task CompleteWithPayment_PreApprovedBoundSale_PaysItsOwnAccount_NotTheOldDebt()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedCustomerWithOldDebtAsync(database);
        var (appointmentId, _, saleAccountId) = await CreateAndApproveSaleAsync(database, seed, 3);

        await using (var db = database.NewContext())
        {
            var complete = new CompleteAppointmentRequest(null,
                new CompleteAppointmentPaymentDto(1000m, "cash", "Randevu tahsilatı", null, DateTime.UtcNow));
            var done = await NewAppointments(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId, complete);
            Assert.True(done.IsSuccess, done.IsFailure ? done.Error.Message : null);
        }

        await using (var check = database.NewContext())
        {
            var accounts = await check.CustomerAccounts.Include(a => a.Payments)
                .Where(a => a.CustomerId == seed.CustomerId).ToListAsync();

            var saleAccount = accounts.Single(a => a.Id == saleAccountId);
            var oldDebt = accounts.Single(a => a.Id == seed.OldDebtAccountId);

            Assert.Equal(1000m, saleAccount.Payments.Sum(p => p.Amount));   // parası kendi satışında
            Assert.Equal(0m, oldDebt.Payments.Sum(p => p.Amount));          // eski borca DOKUNULMADI
        }
    }

    /// <summary>
    /// İstemci, randevunun bağlı satışıyla UYUŞMAYAN bir cari gönderirse istek reddedilir ve
    /// hiçbir şey yazılmaz (randevu da tamamlanmaz) — hata istemci eliyle geri gelmemeli.
    /// </summary>
    [MySqlFact]
    public async Task CompleteWithPayment_ClientAccountConflictingWithBoundSale_IsRejected()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedCustomerWithOldDebtAsync(database);
        var (appointmentId, _, saleAccountId) = await CreateAndApproveSaleAsync(database, seed, 3);

        await using (var db = database.NewContext())
        {
            var complete = new CompleteAppointmentRequest(null,
                new CompleteAppointmentPaymentDto(1000m, "cash", "Randevu tahsilatı",
                    seed.OldDebtAccountId, DateTime.UtcNow));
            var done = await NewAppointments(db).CompleteWithPaymentAsync(seed.TenantId, appointmentId, complete);

            Assert.True(done.IsFailure, "Baska satisin carisi hedef gosterilebildi.");
            Assert.Equal("Validation", done.Error.Code);
        }

        await using (var check = database.NewContext())
        {
            // Ne tahsilat ne de tamamlama uygulandı.
            Assert.Empty(await check.AccountPayments.AsNoTracking().ToListAsync());
            var status = await check.Appointments.AsNoTracking()
                .Where(a => a.Id == appointmentId).Select(a => a.Status).SingleAsync();
            Assert.NotEqual(AppointmentStatus.Completed, status);
            Assert.NotEqual(Guid.Empty, saleAccountId);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════════════
    // 2c) Taksit bakımı: çoklu hedef ATOMİK (hepsi ya da hiçbiri)
    // ═════════════════════════════════════════════════════════════════════════════════════

    /// <summary>Sapmış cari kurar: plan 8.500'de kalmış, toplam 8.750'ye çıkmış.</summary>
    private static async Task<Guid> SeedDriftedAccountAsync(
        MySqlTestDatabase database, Guid tenantId, Guid branchId, Guid customerId, string name)
    {
        await using var db = database.NewContext();
        var account = new CustomerAccount(tenantId, branchId, customerId, null, name, 8500m, 0m);
        account.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(20)));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();
        account.ChangeTotal(8750m, 0m);      // plan bilerek yeniden kurulmadı
        await db.SaveChangesAsync();
        return account.Id;
    }

    private sealed record PlanSnapshot(decimal Total, Guid[] Ids, string[] Statuses, DateOnly[] DueDates);

    private static async Task<PlanSnapshot> ReadPlanAsync(MySqlTestDatabase database, Guid accountId)
    {
        await using var db = database.NewContext();
        var rows = await db.Installments.AsNoTracking()
            .Where(i => i.CustomerAccountId == accountId)
            .OrderBy(i => i.No)
            .Select(i => new { i.Id, i.Amount, i.Status, i.DueDate })
            .ToListAsync();
        return new PlanSnapshot(
            rows.Sum(r => r.Amount),
            rows.Select(r => r.Id).ToArray(),
            rows.Select(r => r.Status.ToString()).ToArray(),
            rows.Select(r => r.DueDate).ToArray());
    }

    /// <summary>
    /// ASIL İDDİA: hedeflerden BİRİ bile doğrulamayı geçemezse, doğrulamayı geçen hedefte de
    /// HİÇBİR değişiklik kalmaz. Eskiden her hedef ayrı transaction'da commit ediliyordu: A
    /// düzeltilip yazılıyor, B patlıyor, açılış duruyor ama A'daki para etkileyen değişiklik
    /// kalıcı oluyordu. Gerçek transaction davranışı yalnız MariaDB'de görülebilir.
    /// </summary>
    [MySqlFact]
    public async Task InstallmentMaintenance_OneTargetFails_LeavesTheOtherTargetUntouched()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedCustomerWithOldDebtAsync(database);

        var goodId = await SeedDriftedAccountAsync(database, seed.TenantId, seed.BranchId, seed.CustomerId, "Saglam hedef");
        var badId = await SeedDriftedAccountAsync(database, seed.TenantId, seed.BranchId, seed.CustomerId, "Uyusmayan hedef");

        // Tahsilat da eklensin: "tahsilatlar değişmedi" iddiası ölçülebilsin.
        await using (var db = database.NewContext())
        {
            var account = await db.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == goodId);
            account.RegisterPayment(2000m, "cash", null, DateTime.UtcNow.AddDays(-1));
            await db.SaveChangesAsync();
        }

        var before = await ReadPlanAsync(database, goodId);
        Assert.Equal(8500m, before.Total);

        await using (var db = database.NewContext())
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                    // Geçerli hedef (beklenen tuple TUTUYOR).
                    new DatabaseBootstrap.InstallmentPlanRepairTarget(
                        goodId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4),
                    // Uyuşmayan hedef: PlanTotal beklentisi YANLIŞ.
                    new DatabaseBootstrap.InstallmentPlanRepairTarget(
                        badId, seed.TenantId, 8750m, 0m, 8750m, 1m, 4)]));
        }

        // ASIL KANIT: geçerli hedefte KISMİ MUTASYON KALMADI.
        var after = await ReadPlanAsync(database, goodId);
        Assert.Equal(8500m, after.Total);              // plan hizalanmadı (8750 OLMADI)
        Assert.Equal(before.Ids, after.Ids);           // taksit kimlikleri aynı
        Assert.Equal(before.Statuses, after.Statuses); // durumlar aynı
        Assert.Equal(before.DueDates, after.DueDates); // vadeler aynı

        await using (var check = database.NewContext())
        {
            var payments = await check.AccountPayments.AsNoTracking()
                .Where(p => p.CustomerAccountId == goodId).ToListAsync();
            Assert.Equal(2000m, payments.Sum(p => p.Amount));   // tahsilatlar değişmedi
            // Diğer hedef de el değmemiş.
            var badPlan = await ReadPlanAsync(database, badId);
            Assert.Equal(8500m, badPlan.Total);
        }
    }

    /// <summary>Bütün hedefler doğrulamayı geçerse hepsi TEK transaction'da hizalanır.</summary>
    [MySqlFact]
    public async Task InstallmentMaintenance_AllTargetsValid_RepairsAllInOneTransaction()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedCustomerWithOldDebtAsync(database);
        var firstId = await SeedDriftedAccountAsync(database, seed.TenantId, seed.BranchId, seed.CustomerId, "Hedef 1");
        var secondId = await SeedDriftedAccountAsync(database, seed.TenantId, seed.BranchId, seed.CustomerId, "Hedef 2");

        await using (var db = database.NewContext())
        {
            var repaired = await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                new DatabaseBootstrap.InstallmentPlanRepairTarget(firstId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4),
                new DatabaseBootstrap.InstallmentPlanRepairTarget(secondId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4)]);
            Assert.Equal(2, repaired);
        }

        Assert.Equal(8750m, (await ReadPlanAsync(database, firstId)).Total);
        Assert.Equal(8750m, (await ReadPlanAsync(database, secondId)).Total);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════
    // 3) Portal randevu numarası — eşzamanlılıkta benzersiz ve hatasız
    // ═════════════════════════════════════════════════════════════════════════════════════

    private static CustomerPortalService NewPortal(GuzellikDbContext db) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), new AllowAllFeatureService(),
            new NoopAppNotificationService(), null!);

    private sealed record NumberSeed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid StaffId, Guid ServiceId);

    private static async Task<NumberSeed> SeedForNumberingAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Numara QA", $"numara-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "NUMARA MUSTERI", "0555 313 41 51", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Uzman", "Uzman");
        db.StaffMembers.Add(staff);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Hizmet", 30, 100m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        return new NumberSeed(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id);
    }

    private static Appointment NewAppointment(NumberSeed seed, int hourOffset, Guid? customerId = null) =>
        new(seed.TenantId, seed.BranchId, customerId ?? seed.CustomerId, seed.StaffId, seed.ServiceId,
            DateTime.UtcNow.AddHours(hourOffset), DateTime.UtcNow.AddHours(hourOffset).AddMinutes(30), 0m, null);

    /// <summary>
    /// NUMARA ÇAKIŞMASI YENİDEN DENENİR: kilitsiz bir yol aynı numarayı ikinci kez üretse bile
    /// kayıt yeni numarayla yazılır — istemciye 500 dönmez.
    /// </summary>
    [MySqlFact]
    public async Task SaveWithNumberRetry_DuplicateNumber_IsRecovered()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedForNumberingAsync(database);

        await using (var db = database.NewContext())
        {
            var first = NewAppointment(seed, 2);
            first.AssignNumber(10001);
            db.Appointments.Add(first);
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var clash = NewAppointment(seed, 5);
            clash.AssignNumber(10001);                    // bilerek ÇAKIŞAN numara
            db.Appointments.Add(clash);
            await AppointmentNumbering.SaveWithNumberRetryAsync(db, seed.TenantId, clash, CancellationToken.None);
            Assert.Equal(10002, clash.Number);
        }

        await using (var check = database.NewContext())
        {
            var numbers = await check.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.TenantId == seed.TenantId).Select(a => a.Number).ToListAsync();
            Assert.Equal(2, numbers.Distinct().Count());
        }
    }

    /// <summary>
    /// ASIL İDDİA: NUMARAYLA İLGİSİZ kalıcılık hatası YUTULMAZ. Eski döngü her
    /// <c>DbUpdateException</c>'ı "numara çakıştı" sanıp üç kez tekrarlıyor, asıl hatayı gizliyordu.
    /// Burada bütünlük ihlali var (olmayan müşteriye FK) ama numara boşta — istisna yükselmeli.
    /// </summary>
    [MySqlFact]
    public async Task SaveWithNumberRetry_UnrelatedIntegrityError_IsNotSwallowed()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedForNumberingAsync(database);

        await using var db = database.NewContext();
        var orphan = NewAppointment(seed, 3, customerId: Guid.CreateVersion7());   // FK ihlali
        orphan.AssignNumber(10001);
        db.Appointments.Add(orphan);

        await Assert.ThrowsAnyAsync<DbUpdateException>(() =>
            AppointmentNumbering.SaveWithNumberRetryAsync(db, seed.TenantId, orphan, CancellationToken.None));
    }

    /// <summary>
    /// ASIL İDDİA: aynı kuruma gelen 16 eşzamanlı online randevu talebinin HİÇBİRİ hata almaz ve
    /// üretilen #RNDV numaraları benzersizdir. Kilitsiz MAX(Number)+1 ile bu istekler aynı numarayı
    /// seçip benzersiz indekse takılıyor, müşteriye 500 dönüyordu.
    /// </summary>
    [MySqlFact]
    public async Task PortalBooking_ConcurrentRequests_ProduceUniqueNumbersWithoutErrors()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, branchId, serviceId;
        var customerIds = new List<Guid>();
        var staffIds = new List<Guid>();
        const int concurrency = 16;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Portal Yarış", $"portal-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            tenantId = tenant.Id;
            branchId = branch.Id;

            var service = new ServiceDefinition(tenant.Id, branch.Id, "Online Hizmet", 30, 500m, "Cilt");
            db.ServiceDefinitions.Add(service);

            // Her istek AYRI müşteri + AYRI personel kullanır: slot kapasitesi ve "aynı anda en fazla
            // 3 açık randevu" freni testin konusu değil, numara yarışı test ediliyor.
            for (var i = 0; i < concurrency; i++)
            {
                var customer = new Customer(tenant.Id, branch.Id, $"PORTAL MUSTERI {i}", $"0555 000 {i:00} {i:00}", null);
                db.Customers.Add(customer);
                customerIds.Add(customer.Id);
                var staff = new StaffMember(tenant.Id, branch.Id, $"Uzman {i}", "Uzman");
                db.StaffMembers.Add(staff);
                staffIds.Add(staff.Id);
            }
            await db.SaveChangesAsync();
            serviceId = service.Id;
        }

        var startUtc = DateTime.UtcNow.AddDays(2).Date.AddHours(9);

        async Task<Result<PortalAppointmentDto>> BookAsync(int index)
        {
            await using var db = database.NewContext();
            return await NewPortal(db).CreateAppointmentAsync(customerIds[index],
                new CreatePortalAppointmentRequest(branchId, staffIds[index], serviceId, startUtc, null));
        }

        var results = await Task.WhenAll(Enumerable.Range(0, concurrency).Select(BookAsync));

        var failures = results.Where(r => r.IsFailure).Select(r => r.Error.Message).ToArray();
        Assert.True(failures.Length == 0, $"Eşzamanlı portal randevusunda hata: {string.Join(" | ", failures)}");

        await using (var check = database.NewContext())
        {
            var numbers = await check.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.TenantId == tenantId)
                .Select(a => a.Number)
                .ToListAsync();

            Assert.Equal(concurrency, numbers.Count);
            Assert.All(numbers, n => Assert.NotNull(n));
            Assert.Equal(concurrency, numbers.Distinct().Count());
            // Taban 10000 → beklenen aralık 10001..10000+N.
            Assert.All(numbers, n => Assert.InRange(n!.Value, 10001, 10000 + concurrency));
        }
    }
}

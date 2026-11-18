using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ŞUBE SİLME (kullanıcı isteği 18 Kas 2026: "şube silme olsun; silerse fiyat ona göre güncellensin"). Değişmezler:
/// (1) hiçbir kayıt silinmez — şubenin bütün satırları seçilen şubeye aktarılır (denetim kaydı hariç), (2) şube yumuşak
/// silinir ve paket tutarı bir şube eksik hesaplanır, (3) varsayılan ve tek şube silinemez, (4) hedef aynı kurumun
/// silinmeyen başka bir şubesi olmalı, (5) önizleme aktarılacak kayıtları ve yeni tutarı söyler.
/// </summary>
public sealed class BranchDeleteTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private sealed class Passthrough : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }

    private static BranchService Branches(GuzellikDbContext db) =>
        new(db, new AlwaysAllowUsageService(),
            new BillingService(db, new PaymentTestDoubles.DisabledResolver(), new Passthrough(), new NoopAuditLogger(),
                new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner), NullLogger<BillingService>.Instance),
            new TestCurrentUser(UserRole.InstitutionOwner), new NoopAuditLogger());

    internal sealed record Seed(Guid TenantId, Guid Main, Guid Kadikoy, Guid Besiktas, Guid Customer, Guid Staff, Guid Appointment, Guid Adisyon, Guid User);

    /// <summary>Üç şubeli (Merkez varsayılan) ücretli kurum; Kadıköy'de müşteri, personel, kullanıcı, randevu, adisyon.</summary>
    internal static Seed Populate(GuzellikDbContext db, bool perBranch = true)
    {
        var plan = new SubscriptionPlan($"ba-{Guid.NewGuid():N}"[..16], "BeautyAsist", 1_000m, -1, -1, -1, -1, 0, yearlyPriceTRY: 10_000m);
        plan.SetPricingModel(chargePerBranch: perBranch, null, null, 10m);
        db.SubscriptionPlans.Add(plan);
        var tenant = new Tenant("Şube Silme QA", $"sube-sil-{Guid.NewGuid():N}"[..20], "BeautyAsist", TenantStatus.Trial);
        var main = tenant.AddBranch("Merkez", "İzmir", true);
        var kadikoy = tenant.AddBranch("Kadıköy", "İstanbul", false);
        var besiktas = tenant.AddBranch("Beşiktaş", "İstanbul", false);
        var user = tenant.GrantAccess("sube@ornek.test", UserRole.BranchManager, kadikoy.Id, "Şube Yöneticisi");
        db.Tenants.Add(tenant);
        db.Branches.AddRange(main, kadikoy, besiktas);
        db.TenantUsers.Add(user);
        tenant.StartSubscription(plan, BillingPeriod.Monthly, DateTime.UtcNow.AddDays(-10));

        var customer = new Customer(tenant.Id, kadikoy.Id, "MÜŞTERİ KADIKÖY", "0555 111 22 33", null);
        var staff = new StaffMember(tenant.Id, kadikoy.Id, "Uzman Deniz", "Uzman");
        var start = DateTime.UtcNow.AddDays(2);
        var service = new ServiceDefinition(tenant.Id, kadikoy.Id, "Cilt Bakımı", 60, 100m, "Cilt");
        db.ServiceDefinitions.Add(service);
        var appointment = new Appointment(tenant.Id, kadikoy.Id, customer.Id, staff.Id, service.Id, start, start.AddHours(1), 100);
        var adisyon = new Adisyon(tenant.Id, kadikoy.Id, customer.Id, null, null);
        db.Customers.Add(customer);
        db.Customers.Add(new Customer(tenant.Id, besiktas.Id, "MÜŞTERİ BEŞİKTAŞ", "0555 444 55 66", null));
        db.StaffMembers.Add(staff);
        db.Appointments.Add(appointment);
        db.Adisyonlar.Add(adisyon);
        return new Seed(tenant.Id, main.Id, kadikoy.Id, besiktas.Id, customer.Id, staff.Id, appointment.Id, adisyon.Id, user.Id);
    }

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, bool perBranch = true)
    {
        await using var db = NewDb(options);
        var seed = Populate(db, perBranch);
        await db.SaveChangesAsync();
        return seed;
    }

    [Fact]
    public async Task Preview_ListsTheRecordsToMove_AndThePriceWithOneBranchLess()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        await using var db = NewDb(options);

        var preview = (await Branches(db).DeletePreviewAsync(seed.TenantId, seed.Kadikoy)).Value!;
        Assert.True(preview.CanDelete);
        Assert.Null(preview.Blocker);
        Assert.Equal(("Kadıköy", 1, 1, 1, 1, 1, 1), (preview.Name, preview.Customers, preview.Staff, preview.Users, preview.Appointments, preview.UpcomingAppointments, preview.Sales));
        var impact = preview.Impact!;
        Assert.Equal(3, impact.Branches);
        Assert.Equal(impact.CurrentMonthly.Total / 3 * 2, impact.NextMonthly.Total);
        Assert.True(impact.NextYearly.Total < impact.CurrentMonthly.Total * 12);

        // Varsayılan şube silinemez; şubesi tek olan kurumda da silinemez.
        var main = (await Branches(db).DeletePreviewAsync(seed.TenantId, seed.Main)).Value!;
        Assert.False(main.CanDelete);
        Assert.Contains("Varsayılan şube silinemez", main.Blocker);
        Assert.Equal(Error.NotFound("Şube bulunamadı.").Code, (await Branches(db).DeletePreviewAsync(seed.TenantId, Guid.NewGuid())).Error.Code);
    }

    [Fact]
    public async Task Preview_WithoutPerBranchPricing_HasNoPriceImpact_AndTheOnlyBranchIsBlocked()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, perBranch: false);
        await using (var db = NewDb(options))
        {
            Assert.Null((await Branches(db).DeletePreviewAsync(seed.TenantId, seed.Kadikoy)).Value!.Impact);
            Assert.Null(await Branches(db).Billing().GetBranchRemovalImpactAsync(Guid.NewGuid()));
        }

        await using (var db = NewDb(options))
        {
            var tenant = new Tenant("Tek Şube", $"tek-{Guid.NewGuid():N}"[..16], "BeautyAsist", TenantStatus.Trial);
            var only = tenant.AddBranch("Merkez", "İzmir", false);
            db.Tenants.Add(tenant);
            db.Branches.Add(only);
            await db.SaveChangesAsync();
            var preview = (await Branches(db).DeletePreviewAsync(tenant.Id, only.Id)).Value!;
            Assert.Equal((false, "Kurumun tek şubesi silinemez."), (preview.CanDelete, preview.Blocker));
            Assert.Equal("Conflict", (await Branches(db).DeleteAsync(tenant.Id, only.Id, new DeleteBranchRequest(only.Id))).Error.Code);
        }
    }

    [Fact]
    public async Task Delete_MovesEveryRecord_SoftDeletesTheBranch_AndTheNextPriceDrops()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        decimal before;
        await using (var db = NewDb(options))
        {
            before = (await Branches(db).DeletePreviewAsync(seed.TenantId, seed.Kadikoy)).Value!.Impact!.CurrentMonthly.Total;
            var result = await Branches(db).DeleteAsync(seed.TenantId, seed.Kadikoy, new DeleteBranchRequest(seed.Main));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.Equal((seed.Kadikoy, seed.Main), (result.Value!.DeletedBranchId, result.Value.TargetBranchId));
            Assert.True(result.Value.MovedRecords >= 5);
        }

        await using var check = NewDb(options);
        // Kayıtlar silinmedi, Merkez'e geçti; Beşiktaş'ın kaydı yerinde.
        Assert.Equal(seed.Main, (await check.Customers.IgnoreQueryFilters().SingleAsync(c => c.Id == seed.Customer)).BranchId);
        Assert.Equal(seed.Main, (await check.StaffMembers.IgnoreQueryFilters().SingleAsync(s => s.Id == seed.Staff)).BranchId);
        Assert.Equal(seed.Main, (await check.Appointments.IgnoreQueryFilters().SingleAsync(a => a.Id == seed.Appointment)).BranchId);
        Assert.Equal(seed.Main, (await check.Adisyonlar.IgnoreQueryFilters().SingleAsync(a => a.Id == seed.Adisyon)).BranchId);
        Assert.Equal(seed.Main, (await check.TenantUsers.IgnoreQueryFilters().SingleAsync(u => u.Id == seed.User)).BranchId);
        Assert.Equal(seed.Besiktas, (await check.Customers.IgnoreQueryFilters().SingleAsync(c => c.FullName == "MÜŞTERİ BEŞİKTAŞ")).BranchId);
        Assert.Equal(0, await check.Customers.IgnoreQueryFilters().CountAsync(c => c.BranchId == seed.Kadikoy));

        // Şube yumuşak silindi: listede yok, fiyat sayımında yok; tutar bir şube eksik.
        Assert.True((await check.Branches.IgnoreQueryFilters().SingleAsync(b => b.Id == seed.Kadikoy)).IsDeleted);
        var list = (await Branches(check).ListAsync(seed.TenantId)).Value!;
        Assert.DoesNotContain(list, b => b.Id == seed.Kadikoy);
        Assert.Equal(2, (await BillingCountsQuery.CountAsync(check, seed.TenantId, CancellationToken.None)).Branches);
        var after = (await Branches(check).DeletePreviewAsync(seed.TenantId, seed.Besiktas)).Value!.Impact!.CurrentMonthly.Total;
        Assert.Equal(before / 3 * 2, after);

        // Silinen şube ikinci kez silinemez.
        Assert.Equal("NotFound", (await Branches(check).DeleteAsync(seed.TenantId, seed.Kadikoy, new DeleteBranchRequest(seed.Main))).Error.Code);
    }

    [Fact]
    public async Task Delete_RequiresATargetOfTheSameTenant_AndRefusesTheDefaultBranch()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var other = await SeedAsync(options);
        await using var db = NewDb(options);
        var branches = Branches(db);

        foreach (var target in new[] { seed.Kadikoy, other.Main, Guid.NewGuid() })
        {
            var refused = await branches.DeleteAsync(seed.TenantId, seed.Kadikoy, new DeleteBranchRequest(target));
            Assert.Equal("Validation", refused.Error.Code);
        }

        var main = await branches.DeleteAsync(seed.TenantId, seed.Main, new DeleteBranchRequest(seed.Kadikoy));
        Assert.Equal("Conflict", main.Error.Code);
        Assert.Contains("Varsayılan şube silinemez", main.Error.Message);
        Assert.Equal("NotFound", (await branches.DeleteAsync(seed.TenantId, Guid.NewGuid(), new DeleteBranchRequest(seed.Main))).Error.Code);

        // Hiçbir şey taşınmadı.
        Assert.Equal(seed.Kadikoy, (await db.Customers.IgnoreQueryFilters().SingleAsync(c => c.Id == seed.Customer)).BranchId);
    }

    [Fact]
    public void MergeColumns_ComeFromTheModel_AndKeepTheAuditLog()
    {
        using var db = NewDb(NewOptions());
        var columns = BranchMerge.Columns(db);
        Assert.Contains(("customers", "BranchId"), columns);
        Assert.Contains(("appointments", "BranchId"), columns);
        Assert.Contains(("tenant_users", "BranchId"), columns);
        Assert.DoesNotContain(columns, c => c.Table == "audit_logs" || c.Table == "branches");
        Assert.Equal(columns.Count, columns.Distinct().Count());
    }
}

/// <summary>Şube silme gerçek MySQL'de: ham SQL ile toplu taşıma tek transaction'da (InMemory izleyici yolunu sınar).</summary>
public sealed class BranchDeleteMySqlTests
{
    [MySqlFact]
    public async Task Delete_MovesRowsWithRawSql_AndLeavesTheAuditLogAlone()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        BranchDeleteTests.Seed seed;
        Guid auditId;
        await using (var db = database.NewContext())
        {
            seed = BranchDeleteTests.Populate(db);
            await db.SaveChangesAsync();
            var audit = new AuditLog(seed.TenantId, seed.Kadikoy, null, null, null, "Test", "Branch", seed.Kadikoy, "Kadıköy'de yapıldı", null, null);
            db.AuditLogs.Add(audit);
            await db.SaveChangesAsync();
            auditId = audit.Id;
        }

        await using (var db = database.NewContext())
        {
            var service = new BranchService(db, new AlwaysAllowUsageService(),
                new BillingService(db, new PaymentTestDoubles.DisabledResolver(), new BranchDeleteTestsEncryption(), new NoopAuditLogger(),
                    new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner), NullLogger<BillingService>.Instance),
                new TestCurrentUser(UserRole.InstitutionOwner), new NoopAuditLogger());
            var result = await service.DeleteAsync(seed.TenantId, seed.Kadikoy, new DeleteBranchRequest(seed.Besiktas));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
            Assert.True(result.Value!.MovedRecords >= 5);
        }

        await using var check = database.NewContext();
        Assert.Equal(seed.Besiktas, (await check.Customers.IgnoreQueryFilters().SingleAsync(c => c.Id == seed.Customer)).BranchId);
        Assert.Equal(seed.Besiktas, (await check.Appointments.IgnoreQueryFilters().SingleAsync(a => a.Id == seed.Appointment)).BranchId);
        Assert.Equal(seed.Besiktas, (await check.StaffMembers.IgnoreQueryFilters().SingleAsync(s => s.Id == seed.Staff)).BranchId);
        Assert.Equal(seed.Besiktas, (await check.TenantUsers.IgnoreQueryFilters().SingleAsync(u => u.Id == seed.User)).BranchId);
        Assert.Equal(seed.Kadikoy, (await check.AuditLogs.IgnoreQueryFilters().SingleAsync(a => a.Id == auditId)).BranchId);
        Assert.True((await check.Branches.IgnoreQueryFilters().SingleAsync(b => b.Id == seed.Kadikoy)).IsDeleted);
        Assert.Equal(2, (await BillingCountsQuery.CountAsync(check, seed.TenantId, CancellationToken.None)).Branches);
    }

    private sealed class BranchDeleteTestsEncryption : IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }
}

internal static class BranchServiceTestExtensions
{
    /// <summary>Testte BranchService'in fiyat hesaplayıcısına erişim (önizlemedeki etkiyle aynı kaynak).</summary>
    public static IBillingService Billing(this BranchService service) =>
        (IBillingService)typeof(BranchService).GetField("_billing", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(service)!;
}

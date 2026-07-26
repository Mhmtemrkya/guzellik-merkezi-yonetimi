using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// KVKK açık rıza mesajının doğru anda kuyruğa girdiğini doğrular.
///
/// Kritik davranış: onay kutusu işaretlenmeden müşteri eklenirse WhatsApp isteği KUYRUĞA
/// yazılır (istek yolunda gönderim yapılmaz); onaylı eklenirse hiç yazılmaz. Toplu uçta
/// zaten onaylı kayıtlar sessizce atlanır ve sayımı raporlanır.
/// (Telefon alanı domain seviyesinde zorunlu olduğundan "telefonsuz" dal yalnızca eski/aktarılmış
/// kayıtlar için savunma amaçlıdır; buradan üretilemez.)
/// </summary>
public sealed class CustomerKvkkRequestTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search) =>
        new(options, null, new TestCurrentUser(), null, null, search);

    private static CustomerService NewService(GuzellikDbContext db, ISearchIndexService search, IDurableJobQueue jobs) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), search, jobs);

    private static async Task<(Guid TenantId, Guid BranchId)> SeedTenantAsync(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search)
    {
        await using var db = NewDb(options, search);
        var tenant = new Tenant("KVKK QA", "kvkk-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return (tenant.Id, branch.Id);
    }

    private static UpsertCustomerRequest Customer(Guid branchId, string name, string phone, bool kvkkConsent) =>
        new(branchId, name, phone, null, null, Gender.Female, kvkkConsent, null);

    [Theory]
    [InlineData(false, 1)] // onay yok → istek kuyruğa girer
    [InlineData(true, 0)]  // onay alınmış → müşteri rahatsız edilmez
    public async Task CreateAsync_EnqueuesKvkkRequest_OnlyWhenConsentMissing(bool consent, int expectedJobs)
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);
        var jobs = new CapturingJobQueue();

        await using var db = NewDb(options, search);
        var result = await NewService(db, search, jobs)
            .CreateAsync(tenantId, Customer(branchId, "Deniz Yılmaz", "0555 111 22 33", consent));

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedJobs, jobs.Jobs.Count);
        if (expectedJobs > 0) Assert.Equal(DurableJobTypes.KvkkConsent, jobs.Jobs[0].JobType);
    }

    [Fact]
    public async Task SendKvkkRequestAsync_SkipsAlreadyApprovedRecords()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        Guid pendingId, approvedId;
        await using (var db = NewDb(options, search))
        {
            var service = NewService(db, search, new CapturingJobQueue());
            pendingId = (await service.CreateAsync(tenantId, Customer(branchId, "Bekleyen Kayıt", "0555 111 22 33", false))).Value!.Id;
            approvedId = (await service.CreateAsync(tenantId, Customer(branchId, "Onaylı Kayıt", "0532 444 55 66", true))).Value!.Id;
        }

        await using (var db = NewDb(options, search))
        {
            var jobs = new CapturingJobQueue();
            var result = await NewService(db, search, jobs).SendKvkkRequestAsync(
                tenantId, new SendKvkkRequestRequest(new[] { pendingId, approvedId }));

            Assert.True(result.IsSuccess);
            Assert.Equal(1, result.Value!.Queued);
            Assert.Equal(1, result.Value.AlreadyApproved);
            Assert.Single(jobs.Jobs);
            Assert.Equal(DurableJobTypes.KvkkConsent, jobs.Jobs[0].JobType);
        }
    }

    [Fact]
    public async Task SendKvkkRequestAsync_FailsWhenNoCustomerSelected()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, _) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var result = await NewService(db, search, new CapturingJobQueue())
            .SendKvkkRequestAsync(tenantId, new SendKvkkRequestRequest(Array.Empty<Guid>()));

        Assert.True(result.IsFailure);
    }
}

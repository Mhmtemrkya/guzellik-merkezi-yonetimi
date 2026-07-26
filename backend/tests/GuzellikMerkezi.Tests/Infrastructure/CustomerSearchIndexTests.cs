using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Şifreli ad/telefon üzerinde aramanın blind index ile doğru çalıştığını doğrular.
/// Bu akış "kritikbulgular #3"ün konusuydu: ciphertext üzerinde SQL Contains anlamsızdır.
/// </summary>
public sealed class CustomerSearchIndexTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search, ITenantContext? tenant = null) =>
        new(options, tenant, new TestCurrentUser(), null, null, search);

    private static CustomerService NewService(GuzellikDbContext db, ISearchIndexService search, UserRole role = UserRole.InstitutionOwner) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), new TestCurrentUser(role), new AllowAllFeatureService(), search, new CapturingJobQueue());

    private static async Task<(Guid TenantId, Guid BranchId)> SeedTenantAsync(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search, string slug = "qa-beauty")
    {
        await using var db = NewDb(options, search);
        var tenant = new Tenant("QA Beauty", slug, "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return (tenant.Id, branch.Id);
    }

    private static UpsertCustomerRequest Customer(Guid branchId, string name, string phone, string? email = null) =>
        new(branchId, name, phone, email, null, Gender.Female, true, null);

    [Theory]
    // Ön-ek araması: kullanıcı tam adı yazmak zorunda değil.
    [InlineData("meh", "Mehmet KAYA")]
    [InlineData("kaya", "Mehmet KAYA")]
    [InlineData("mehmet kaya", "Mehmet KAYA")]
    // Türkçe katlama: kullanıcı Türkçe karakter yazmadan da bulabilmeli.
    [InlineData("sey", "Şeyma GÖKÇE")]
    [InlineData("gokce", "Şeyma GÖKÇE")]
    [InlineData("ŞEY", "Şeyma GÖKÇE")]
    public async Task Search_FindsCustomer(string term, string expectedName)
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using (var db = NewDb(options, search))
        {
            var service = NewService(db, search);
            Assert.True((await service.CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "0555 111 22 33"))).IsSuccess);
            Assert.True((await service.CreateAsync(tenantId, Customer(branchId, "Şeyma Gökçe", "0532 444 55 66"))).IsSuccess);
            Assert.True((await service.CreateAsync(tenantId, Customer(branchId, "Ayşe Yılmaz", "0505 777 88 99"))).IsSuccess);
        }

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search).ListAsync(tenantId, new CustomerListQuery(Search: term));
            Assert.True(result.IsSuccess);
            var item = Assert.Single(result.Value!.Items);
            Assert.Equal(expectedName, item.FullName);
        }
    }

    [Theory]
    [InlineData("0555 111 22 33")] // kullanıcının yazdığı biçim
    [InlineData("5551112233")]     // sade
    [InlineData("555111")]         // kısmi ön-ek
    public async Task Search_FindsByPhoneRegardlessOfFormatting(string term)
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using (var db = NewDb(options, search))
        {
            var service = NewService(db, search);
            await service.CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "+90 555 111 22 33"));
            await service.CreateAsync(tenantId, Customer(branchId, "Ayşe Yılmaz", "0505 777 88 99"));
        }

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search).ListAsync(tenantId, new CustomerListQuery(Search: term));
            var item = Assert.Single(result.Value!.Items);
            Assert.Equal("Mehmet KAYA", item.FullName);
        }
    }

    [Fact]
    public async Task Search_DoesNotLeakOtherTenantsCustomers()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantA, branchA) = await SeedTenantAsync(options, search, "tenant-a");
        var (tenantB, branchB) = await SeedTenantAsync(options, search, "tenant-b");

        await using (var db = NewDb(options, search))
        {
            var service = NewService(db, search);
            await service.CreateAsync(tenantA, Customer(branchA, "Mehmet Kaya", "0555 111 22 33"));
            await service.CreateAsync(tenantB, Customer(branchB, "Mehmet Kaya", "0555 111 22 33"));
        }

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search).ListAsync(tenantA, new CustomerListQuery(Search: "mehmet"));
            var item = Assert.Single(result.Value!.Items);
            Assert.Equal(tenantA, item.TenantId);
        }
    }

    [Fact]
    public async Task SearchIndex_ContainsNoPlaintext()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using (var db = NewDb(options, search))
            await NewService(db, search).CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "05551112233", "mehmet@qa.test"));

        await using (var db = NewDb(options, search))
        {
            var index = await db.Customers.AsNoTracking().Select(x => x.SearchIndex).SingleAsync();
            Assert.False(string.IsNullOrEmpty(index));
            // İndeks yalnızca hash parçalarından oluşmalı — hiçbir düz metin parçası görünmemeli.
            Assert.DoesNotContain("mehmet", index, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("kaya", index, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("5551112233", index, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Search_StillWorksBeforeBackfill()
    {
        // Migration uygulandı ama backfill henüz çalışmadı: SearchIndex NULL. Arama sessizce BOŞ dönmemeli;
        // eski tam-tarama davranışına düşüp doğru sonucu vermelidir.
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using (var legacyDb = new GuzellikDbContext(options)) // indeks servisi YOK → SearchIndex null kalır
        {
            legacyDb.Customers.Add(new Customer(tenantId, branchId, "Mehmet Kaya", "05551112233"));
            await legacyDb.SaveChangesAsync();
        }

        await using (var db = NewDb(options, search))
        {
            Assert.True(await db.Customers.AnyAsync(x => x.SearchIndex == null));
            var result = await NewService(db, search).ListAsync(tenantId, new CustomerListQuery(Search: "mehmet"));
            Assert.Single(result.Value!.Items);
        }
    }

    [Fact]
    public async Task Create_RejectsDuplicatePhoneAcrossFormats()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var service = NewService(db, search);

        Assert.True((await service.CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "0555 111 22 33"))).IsSuccess);

        // Aynı numara farklı yazımla → yine mükerrer sayılmalı.
        var duplicate = await service.CreateAsync(tenantId, Customer(branchId, "Başka Kişi", "+90 555 111 2233"));
        Assert.True(duplicate.IsFailure);

        // Farklı numara → sorunsuz eklenmeli (indeks yanlış pozitif üretmiyor).
        Assert.True((await service.CreateAsync(tenantId, Customer(branchId, "Ayşe Yılmaz", "0505 777 88 99"))).IsSuccess);
    }

    [Fact]
    public async Task Update_ReindexesSoOldValueNoLongerMatches()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        Guid customerId;
        await using (var db = NewDb(options, search))
        {
            var created = await NewService(db, search).CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "05551112233"));
            customerId = created.Value!.Id;
        }

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search).UpdateAsync(tenantId, customerId, Customer(branchId, "Zeynep Demir", "05551112233"));
            Assert.True(result.IsSuccess);
        }

        await using (var db = NewDb(options, search))
        {
            var service = NewService(db, search);
            Assert.Empty((await service.ListAsync(tenantId, new CustomerListQuery(Search: "mehmet"))).Value!.Items);
            Assert.Single((await service.ListAsync(tenantId, new CustomerListQuery(Search: "zeynep"))).Value!.Items);
        }
    }

    [Fact]
    public async Task Search_ReturnsEmptyForUnknownTerm()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using (var db = NewDb(options, search))
            await NewService(db, search).CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "05551112233"));

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search).ListAsync(tenantId, new CustomerListQuery(Search: "veli"));
            Assert.Empty(result.Value!.Items);
            Assert.Equal(0, result.Value.TotalCount);
        }
    }

    [Fact]
    public async Task StaffViewer_SeesMaskedPhoneInSearchResults()
    {
        // Personel telefonu yalnızca son 4 hane görür — arama yolu bu maskeyi atlamamalı.
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using (var db = NewDb(options, search))
            await NewService(db, search).CreateAsync(tenantId, Customer(branchId, "Mehmet Kaya", "05551112233"));

        await using (var db = NewDb(options, search))
        {
            var result = await NewService(db, search, UserRole.Staff).ListAsync(tenantId, new CustomerListQuery(Search: "mehmet"));
            var item = Assert.Single(result.Value!.Items);
            Assert.DoesNotContain("5551112233", item.Phone);
            Assert.Contains("2233", item.Phone);
        }
    }
}

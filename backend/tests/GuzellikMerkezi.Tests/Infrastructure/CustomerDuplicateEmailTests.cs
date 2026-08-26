using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MÜKERRER E-POSTA ENGELİ.
///
/// <para>
/// Müşteri girişi kodu, kullanıcının yazdığı e-postanın kurum kayıtlarındaki adresle eşleşmesine
/// bağlıdır (bkz. CustomerOtpService). Aynı adres iki müşteride bulunursa hangi hesabın kodu
/// alacağı belirsizleşir — bu yüzden kural veri girişinde zorlanır.
/// </para>
/// <para>
/// E-posta ŞİFRELİ saklandığı için (AES-GCM, rastgele nonce) veritabanında UNIQUE index
/// kurulamaz; kontrol blind index adayları + bellekte tam eşitlikle yapılır. Bu testler o yolun
/// gerçekten çalıştığını doğrular.
/// </para>
/// </summary>
public sealed class CustomerDuplicateEmailTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, ISearchIndexService search) =>
        new(options, null, new TestCurrentUser(), null, null, search);

    private static CustomerService NewService(GuzellikDbContext db, ISearchIndexService search) =>
        new(db, new AlwaysAllowUsageService(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), search, new CapturingJobQueue());

    private static async Task<(Guid TenantId, Guid BranchId)> SeedTenantAsync(
        DbContextOptions<GuzellikDbContext> options, ISearchIndexService search)
    {
        await using var db = NewDb(options, search);
        var tenant = new Tenant("QA Beauty", "qa-dup-email", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return (tenant.Id, branch.Id);
    }

    private static UpsertCustomerRequest Customer(Guid branchId, string name, string phone, string? email) =>
        new(branchId, name, phone, email, null, Gender.Female, true, null);

    /// <summary>Aynı adresle ikinci müşteri açılamaz.</summary>
    [Fact]
    public async Task Create_WithDuplicateEmail_Fails()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var service = NewService(db, search);

        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Mehmet Kaya", "0555 111 22 33", "ortak@example.com"))).IsSuccess);

        var second = await service.CreateAsync(tenantId,
            Customer(branchId, "Ayse Yilmaz", "0532 444 55 66", "ortak@example.com"));

        Assert.True(second.IsFailure);
        Assert.Contains("e-posta", second.Error!.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Büyük/küçük harf ve baştaki-sondaki boşluk çakışmayı gizleyemez.</summary>
    [Theory]
    [InlineData("ORTAK@EXAMPLE.COM")]
    [InlineData("  ortak@example.com  ")]
    [InlineData("Ortak@Example.Com")]
    public async Task Create_DuplicateDetection_IgnoresCaseAndWhitespace(string variant)
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var service = NewService(db, search);

        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Mehmet Kaya", "0555 111 22 33", "ortak@example.com"))).IsSuccess);

        var second = await service.CreateAsync(tenantId,
            Customer(branchId, "Ayse Yilmaz", "0532 444 55 66", variant));

        Assert.True(second.IsFailure);
    }

    /// <summary>Farklı adresler serbest; e-posta BOŞ bırakmak da serbest (alan zorunlu değil).</summary>
    [Fact]
    public async Task Create_WithDifferentOrEmptyEmail_Succeeds()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var service = NewService(db, search);

        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Mehmet Kaya", "0555 111 22 33", "biri@example.com"))).IsSuccess);
        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Ayse Yilmaz", "0532 444 55 66", "digeri@example.com"))).IsSuccess);

        // BOŞ E-POSTA ÇAKIŞMA SAYILMAZ: aksi hâlde adresi olmayan ikinci müşteri hiç eklenemezdi.
        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Zeynep Ak", "0505 777 88 99", null))).IsSuccess);
        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Elif Demir", "0506 777 88 99", ""))).IsSuccess);
    }

    /// <summary>Güncellemede başka müşterinin adresi alınamaz.</summary>
    [Fact]
    public async Task Update_ToAnotherCustomersEmail_Fails()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var service = NewService(db, search);

        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Mehmet Kaya", "0555 111 22 33", "birinci@example.com"))).IsSuccess);
        var second = await service.CreateAsync(tenantId,
            Customer(branchId, "Ayse Yilmaz", "0532 444 55 66", "ikinci@example.com"));
        Assert.True(second.IsSuccess);

        var result = await service.UpdateAsync(tenantId, second.Value!.Id,
            Customer(branchId, "Ayse Yilmaz", "0532 444 55 66", "birinci@example.com"));

        Assert.True(result.IsFailure);
    }

    /// <summary>
    /// KENDİ adresiyle kaydetmek çakışma DEĞİLDİR. Aksi hâlde ad ya da not değiştiren bir
    /// müşteri, e-postasına hiç dokunmadığı hâlde kaydedilemez olurdu.
    /// </summary>
    [Fact]
    public async Task Update_KeepingOwnEmail_Succeeds()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var service = NewService(db, search);

        var created = await service.CreateAsync(tenantId,
            Customer(branchId, "Mehmet Kaya", "0555 111 22 33", "kendi@example.com"));
        Assert.True(created.IsSuccess);

        var result = await service.UpdateAsync(tenantId, created.Value!.Id,
            Customer(branchId, "Mehmet Kaya Yeni", "0555 111 22 33", "kendi@example.com"));

        Assert.True(result.IsSuccess);
    }

    /// <summary>
    /// KURUM SINIRI: başka bir kurumun müşterisi çakışma üretmez. Kurumlar birbirinin müşteri
    /// listesini göremez; buradan sızması "bu adres sistemde var" bilgisini açardı.
    /// </summary>
    [Fact]
    public async Task Create_SameEmailInAnotherTenant_Succeeds()
    {
        var options = NewOptions();
        var search = TestSearchIndex.Create();
        var (tenantId, branchId) = await SeedTenantAsync(options, search);

        await using var db = NewDb(options, search);
        var other = new Tenant("Diger Kurum", "qa-dup-email-2", "Premium", TenantStatus.Active);
        var otherBranch = other.AddBranch("Merkez", "İzmir", true);
        db.Tenants.Add(other);
        await db.SaveChangesAsync();

        var service = NewService(db, search);
        Assert.True((await service.CreateAsync(tenantId,
            Customer(branchId, "Mehmet Kaya", "0555 111 22 33", "ortak@example.com"))).IsSuccess);
        Assert.True((await service.CreateAsync(other.Id,
            Customer(otherBranch.Id, "Baska Musteri", "0532 444 55 66", "ortak@example.com"))).IsSuccess);
    }
}

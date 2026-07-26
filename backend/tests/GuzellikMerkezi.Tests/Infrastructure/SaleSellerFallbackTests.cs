using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// "Kim sattı" düşümü: satışta personel seçilmemişse satır, kaydı OLUŞTURAN kullanıcıya düşer.
///
/// Kurum yöneticisi personel listesinde olmadığı için kendi yaptığı satışlarda alan boş kalıyor ve
/// her yerde "Belirtilmemiş" yazıyordu. Bir kurumda birden fazla yönetici olabildiğinden etiket
/// ayırt edici olmalı: "Kurum Yöneticisi (Ad Soyad)". Oluşturan da bilinmiyorsa isim UYDURULMAZ.
/// </summary>
public sealed class SaleSellerFallbackTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options, Guid? actingUserId) =>
        new(options, null, new TestCurrentUser(UserRole.InstitutionOwner) { UserId = actingUserId }, null, null, TestSearchIndex.Create());

    private static CustomerAccountService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    /// <summary>Kurum + şube + müşteri + iki yönetici + bir personel kurar.</summary>
    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid OwnerUserId, Guid SecondOwnerUserId, Guid StaffId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options, null);
        var tenant = new Tenant("Satıcı QA", "satici-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        var owner = tenant.GrantAccess("owner@qa.test", UserRole.InstitutionOwner, null, "Ayşe Yılmaz");
        var secondOwner = tenant.GrantAccess("owner2@qa.test", UserRole.InstitutionOwner, null, "Mert Kaya");
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Test MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        var staff = new StaffMember(tenant.Id, branch.Id, "Elif Aydın", "Uzman", null);
        db.StaffMembers.Add(staff);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, owner.Id, secondOwner.Id, staff.Id);
    }

    private static CreateCustomerAccountRequest NewSale(Guid customerId, Guid branchId, string name) =>
        new(branchId, customerId, null, name, 1000m, 0m, 1, DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)), null);

    [Fact]
    public async Task Sale_ByInstitutionOwner_IsLabelledWithOwnerName()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options, seed.OwnerUserId))
        {
            var created = await NewService(db).CreateAsync(seed.TenantId, NewSale(seed.CustomerId, seed.BranchId, "Cilt Paketi"));
            Assert.True(created.IsSuccess);
            Assert.Equal("Kurum Yöneticisi (Ayşe Yılmaz)", created.Value!.SoldByStaffName);
        }

        // Liste yolu da aynı etiketi vermeli (müşteri kartı / katalog satış paneli buradan beslenir).
        await using (var db = NewDb(options, seed.OwnerUserId))
        {
            var list = await NewService(db).ListAsync(seed.TenantId, new PageRequest(1, 50, null), customerId: seed.CustomerId);
            Assert.True(list.IsSuccess);
            Assert.Equal("Kurum Yöneticisi (Ayşe Yılmaz)", Assert.Single(list.Value!.Items).SoldByStaffName);
        }
    }

    [Fact]
    public async Task Sales_ByDifferentOwners_AreDistinguishedByName()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options, seed.OwnerUserId))
            Assert.True((await NewService(db).CreateAsync(seed.TenantId, NewSale(seed.CustomerId, seed.BranchId, "Paket A"))).IsSuccess);
        await using (var db = NewDb(options, seed.SecondOwnerUserId))
            Assert.True((await NewService(db).CreateAsync(seed.TenantId, NewSale(seed.CustomerId, seed.BranchId, "Paket B"))).IsSuccess);

        await using (var db = NewDb(options, seed.OwnerUserId))
        {
            var list = await NewService(db).ListAsync(seed.TenantId, new PageRequest(1, 50, null), customerId: seed.CustomerId);
            var names = list.Value!.Items.ToDictionary(x => x.Name, x => x.SoldByStaffName);
            Assert.Equal("Kurum Yöneticisi (Ayşe Yılmaz)", names["Paket A"]);
            Assert.Equal("Kurum Yöneticisi (Mert Kaya)", names["Paket B"]);
        }
    }

    [Fact]
    public async Task Sale_WithSelectedStaff_KeepsStaffName()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        // Geçmiş satış: satan personel açıkça seçilir → düşüm devreye girmez.
        await using (var db = NewDb(options, seed.OwnerUserId))
        {
            var created = await NewService(db).CreateHistoricalAsync(seed.TenantId, new CreateHistoricalSaleRequest(
                seed.CustomerId, "Eski Paket", DateTime.UtcNow.AddYears(-1), 1000m, 1000m,
                SoldByStaffMemberId: seed.StaffId, BranchId: seed.BranchId));
            Assert.True(created.IsSuccess);
            Assert.Equal("Elif Aydın", created.Value!.SoldByStaffName);
        }
    }

    [Fact]
    public async Task Sale_WithUnknownCreator_StaysUnnamed()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        // Oluşturan kullanıcı bilinmiyor (CreatedBy null) → isim uydurulmaz, alan boş kalır.
        await using (var db = NewDb(options, null))
        {
            var created = await NewService(db).CreateAsync(seed.TenantId, NewSale(seed.CustomerId, seed.BranchId, "Kimliksiz Satış"));
            Assert.True(created.IsSuccess);
            Assert.True(string.IsNullOrWhiteSpace(created.Value!.SoldByStaffName));
        }
    }
}

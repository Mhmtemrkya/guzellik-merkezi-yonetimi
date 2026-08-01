using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// GİDER ÖZETİ VE KATEGORİ ADI REGRESYONLARI.
///
/// <para>
/// 1) Özet, onaysız giderleri gerçekleşmiş sayıyordu: kasa akışı, kâr-zarar ve raporlar
/// <c>IsApproved</c> süzerken bu uç süzmüyordu — aynı dönem için iki farklı gider rakamı
/// çıkıyordu (canlıda 10.200 ₺ fark).
/// </para>
/// <para>
/// 2) Kategori adı mükerrer kontrolü yalnız OLUŞTURMADA vardı. Ad AES-GCM ile rastgele nonce'la
/// şifrelendiği için DB'deki benzersiz indeks aynı düz metni yakalayamaz; güncelleme kapısı
/// olmayınca mevcut bir kategori başka kategorinin adına çevrilebiliyordu.
/// </para>
/// </summary>
public sealed class ExpenseSummaryAndCategoryTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static async Task<(Guid TenantId, Guid BranchId)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Gider QA", $"gider-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        return (tenant.Id, branch.Id);
    }

    /// <summary>Onay bekleyen gider özet toplamına GİRMEMELİ.</summary>
    [Fact]
    public async Task SummaryAsync_ExcludesUnapprovedExpenses()
    {
        var options = NewOptions();
        var (tenantId, branchId) = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var approved = new BusinessExpense(tenantId, branchId, ExpenseCategory.Rent, 1000m, DateTime.UtcNow.AddDays(-1));
            approved.Approve();
            var pending = new BusinessExpense(tenantId, branchId, ExpenseCategory.Other, 250m, DateTime.UtcNow.AddDays(-1));
            db.BusinessExpenses.AddRange(approved, pending);
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var service = new ExpenseService(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            var result = await service.SummaryAsync(tenantId, new ExpenseFilter(null, null, null, null));

            Assert.True(result.IsSuccess);
            Assert.Equal(1000m, result.Value!.TotalAmount);
            Assert.Equal(1, result.Value.Count);
            Assert.Equal(0m, result.Value.RefundAmount);
        }
    }

    /// <summary>Müşteri iadesi toplama girer AMA ayrıca raporlanır (liste ile fark açıklanabilsin).</summary>
    [Fact]
    public async Task SummaryAsync_ReportsRefundsSeparately()
    {
        var options = NewOptions();
        var (tenantId, branchId) = await SeedAsync(options);
        Guid customerId;

        await using (var db = NewDb(options))
        {
            var customer = new Customer(tenantId, branchId, "İade MÜŞTERİ", "0555 111 22 33", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();
            customerId = customer.Id;

            var approved = new BusinessExpense(tenantId, branchId, ExpenseCategory.Rent, 1000m, DateTime.UtcNow.AddDays(-1));
            approved.Approve();
            db.BusinessExpenses.Add(approved);
            db.RefundTransactions.Add(new RefundTransaction(
                tenantId, branchId, Guid.CreateVersion7(), customerId, 250m, "cash"));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var service = new ExpenseService(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            var result = await service.SummaryAsync(tenantId, new ExpenseFilter(null, null, null, null));

            Assert.True(result.IsSuccess);
            // İade toplamın İÇİNDE; ayrı alan farkı açıklar (gider listesi yalnız 1000 ₺ gösterir).
            Assert.Equal(1250m, result.Value!.TotalAmount);
            Assert.Equal(250m, result.Value.RefundAmount);
            Assert.Equal(1, result.Value.RefundCount);
        }
    }

    /// <summary>Güncelleme mevcut başka bir kategorinin adına çeviremez.</summary>
    [Fact]
    public async Task UpdateAsync_RejectsDuplicateCategoryName()
    {
        var options = NewOptions();
        var (tenantId, _) = await SeedAsync(options);

        Guid secondId;
        await using (var db = NewDb(options))
        {
            var service = new CustomExpenseCategoryService(db);
            var first = await service.CreateAsync(tenantId, new UpsertCustomExpenseCategoryRequest("Kira", true));
            Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Message : null);
            var second = await service.CreateAsync(tenantId, new UpsertCustomExpenseCategoryRequest("Elektrik", true));
            Assert.True(second.IsSuccess, second.IsFailure ? second.Error.Message : null);
            secondId = second.Value!.Id;
        }

        await using (var db = NewDb(options))
        {
            var service = new CustomExpenseCategoryService(db);
            // Büyük/küçük harf farkı da mükerrerdir.
            var renamed = await service.UpdateAsync(tenantId, secondId, new UpsertCustomExpenseCategoryRequest("kira", true));

            Assert.True(renamed.IsFailure, "Kategori başka bir kategorinin adına çevrilebildi.");
            Assert.Equal("Conflict", renamed.Error.Code);
        }
    }
}

using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// PAKET RAPORU YALNIZCA PAKETLERİ SAYAR.
///
/// Tekil (paketsiz) hizmet satışında da müşteride seans bakiyesi açılır; pakete bağlı olmadığı
/// için <c>ServicePackageId = Guid.Empty</c> yazılır. Paket raporu bu satırları süzmezse tek bir
/// HİZMET satışı "Toplam Paket" ve "Aktif Paket" sayaçlarını artırıyordu (gerçekten yaşandı).
/// Hizmet satışları ayrı blokta — GetServiceReportAsync — sayılır.
/// </summary>
public sealed class PackageReportScopeTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static CustomerAccountService NewService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private sealed record Seed(Guid TenantId, Guid CustomerId, Guid BranchId, Guid ServiceId, Guid PackageId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Rapor QA", "rapor-qa", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "Rapor MÜŞTERİ", "0555 000 11 22", null);
        db.Customers.Add(customer);

        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m, "Cilt");
        db.ServiceDefinitions.Add(service);

        var package = new ServicePackage(tenant.Id, branch.Id, "Cilt Paketi", 3000m, 0m, 0);
        db.ServicePackages.Add(package);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, customer.Id, branch.Id, service.Id, package.Id);
    }

    /// <summary>Paketsiz hizmet satışı paket sayaçlarını ARTIRMAMALI.</summary>
    [Fact]
    public async Task ServiceSale_DoesNotCountAsPackage()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            // Tekil hizmet satışı: cari paket bağı YOK + seans ServicePackageId = Guid.Empty.
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Cilt Bakımı", 500m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.Add(new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, account.Id, Guid.Empty, seed.ServiceId, 1));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var report = await NewService(db).GetReportAsync(seed.TenantId, months: 6);
            Assert.True(report.IsSuccess);
            Assert.Equal(0, report.Value!.PackageSalesCount);
            Assert.Equal(0, report.Value.ActiveSoldPackageCount);
            Assert.Equal(0, report.Value.SessionsTotal);
        }

        // Aynı satış HİZMET raporunda görünmeli — kaybolmuyor, doğru yerde sayılıyor.
        await using (var db = NewDb(options))
        {
            var service = await NewService(db).GetServiceReportAsync(seed.TenantId);
            Assert.True(service.IsSuccess);
            Assert.Equal(1, service.Value!.ServiceSalesCount);
            Assert.Equal(1, service.Value.ActiveSoldServiceCount);
        }
    }

    /// <summary>Gerçek paket satışı paket sayaçlarına GİRMELİ (süzgeç fazla kesmiyor).</summary>
    [Fact]
    public async Task PackageSale_StillCounts()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, seed.PackageId, "Cilt Paketi", 3000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.Add(new CustomerPackageSession(
                seed.TenantId, seed.CustomerId, account.Id, seed.PackageId, seed.ServiceId, 6));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var report = await NewService(db).GetReportAsync(seed.TenantId, months: 6);
            Assert.True(report.IsSuccess);
            Assert.Equal(1, report.Value!.PackageSalesCount);
            Assert.Equal(1, report.Value.ActiveSoldPackageCount);
            Assert.Equal(6, report.Value.SessionsTotal);
        }
    }

    /// <summary>Karışık dönem: 1 paket + 1 hizmet → paket sayacı yalnız paketi görür.</summary>
    [Fact]
    public async Task MixedSales_PackageCountExcludesService()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);

        await using (var db = NewDb(options))
        {
            var pkgAccount = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, seed.PackageId, "Cilt Paketi", 3000m, 0m);
            var svcAccount = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Cilt Bakımı", 500m, 0m);
            db.CustomerAccounts.AddRange(pkgAccount, svcAccount);
            await db.SaveChangesAsync();

            db.CustomerPackageSessions.AddRange(
                new CustomerPackageSession(seed.TenantId, seed.CustomerId, pkgAccount.Id, seed.PackageId, seed.ServiceId, 6),
                new CustomerPackageSession(seed.TenantId, seed.CustomerId, svcAccount.Id, Guid.Empty, seed.ServiceId, 1));
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var report = await NewService(db).GetReportAsync(seed.TenantId, months: 6);
            Assert.True(report.IsSuccess);
            Assert.Equal(1, report.Value!.PackageSalesCount);   // 2 değil
            Assert.Equal(6, report.Value.SessionsTotal);        // 7 değil

            // Hizmet raporu ikisini de sayar: paketin içindeki hizmet de bir hizmet satışıdır.
            var service = await NewService(db).GetServiceReportAsync(seed.TenantId);
            Assert.Equal(2, service.Value!.ServiceSalesCount);
        }
    }
}

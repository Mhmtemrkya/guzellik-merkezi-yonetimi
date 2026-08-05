using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// CARİ TAKSİT PLANI + SİLİNMİŞ ÜRÜNÜN STOK TERS KAYDI (mantık denetimi).
///
/// <list type="number">
/// <item>Cari toplamı elle değiştirilince YALNIZ TotalAmount güncelleniyordu; plan eski toplama
/// göre kalıyordu. Taksit/açık alacak raporları plan toplamını kullandığı için aradaki fark
/// hiçbir yerde görünmüyordu (canlıda 8.750 cari ↔ 8.500 plan = 250 TL kayıp alacak).</item>
/// <item>Taksitlendirme ucunda negatif sayı doğrulaması yoktu: akış önce planın tamamını siliyor,
/// yeni taksitleri yalnız sayı &gt; 0 iken kuruyordu → -1 planı yok edip başarılı dönüyordu.</item>
/// <item>Ürün, geçmiş satış bağı denetlenmeden silinebiliyor; iptal/geri alma yolunda varsayılan
/// süzgeç onu gizlediği için STOK GERİ EKLENMİYORDU.</item>
/// </list>
/// </summary>
public sealed class AccountPlanAndStockReversalTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static CustomerAccountService NewAccounts(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static AdisyonService NewAdisyon(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Plan QA", $"plan-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "PLAN MÜŞTERİ", "0555 222 33 44", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id);
    }

    private static async Task<Guid> SeedAccountWithPlanAsync(
        DbContextOptions<GuzellikDbContext> options, Seed seed, decimal total, int installments)
    {
        await using var db = NewDb(options);
        var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Paket satışı", total, 0m);
        account.RebuildInstallments(installments, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(15)));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();
        return account.Id;
    }

    /// <summary>Toplam değişince plan da yeniden kurulur: cari toplamı ile plan toplamı ayrışmaz.</summary>
    [Fact]
    public async Task UpdateAccount_ChangingTotal_RebuildsInstallmentPlan()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await SeedAccountWithPlanAsync(options, seed, 8500m, 4);

        await using (var db = NewDb(options))
        {
            var result = await NewAccounts(db).UpdateAsync(seed.TenantId, accountId,
                new UpdateCustomerAccountRequest("Paket satışı", 8750m, 0m, true, null));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == accountId);
            Assert.Equal(8750m, account.TotalAmount);
            Assert.Equal(4, account.Installments.Count);
            // Kayıp alacak yok: plan toplamı cari toplamına eşit.
            Assert.Equal(8750m, account.Installments.Sum(i => i.Amount));
        }
    }

    /// <summary>Toplam DEĞİŞMEDİYSE plana dokunulmaz (ad/not güncellemesi planı bozmamalı).</summary>
    [Fact]
    public async Task UpdateAccount_WithoutTotalChange_KeepsPlanUntouched()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await SeedAccountWithPlanAsync(options, seed, 8500m, 4);

        Guid[] before;
        await using (var db = NewDb(options))
        {
            before = await db.Installments.Where(i => i.CustomerAccountId == accountId)
                .OrderBy(i => i.DueDate).Select(i => i.Id).ToArrayAsync();
        }

        await using (var db = NewDb(options))
        {
            var result = await NewAccounts(db).UpdateAsync(seed.TenantId, accountId,
                new UpdateCustomerAccountRequest("Yeni ad", 8500m, 0m, true, "not"));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var after = await check.Installments.Where(i => i.CustomerAccountId == accountId)
                .OrderBy(i => i.DueDate).Select(i => i.Id).ToArrayAsync();
            Assert.Equal(before, after);
        }
    }

    /// <summary>Negatif taksit sayısı reddedilir; mevcut plan olduğu gibi kalır.</summary>
    [Fact]
    public async Task Reschedule_WithNegativeInstallmentCount_IsRejectedAndKeepsPlan()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        var accountId = await SeedAccountWithPlanAsync(options, seed, 8000m, 4);

        await using (var db = NewDb(options))
        {
            var result = await NewAccounts(db).RescheduleAsync(seed.TenantId, accountId,
                new RescheduleAccountRequest(-1, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30))));
            Assert.True(result.IsFailure, "Negatif taksit sayısı kabul edildi: plan silinir, yenisi kurulmaz.");
            Assert.Equal("Validation", result.Error.Code);
        }

        await using (var check = NewDb(options))
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == accountId);
            Assert.Equal(4, account.Installments.Count);
            Assert.Equal(8000m, account.Installments.Sum(i => i.Amount));
        }
    }

    /// <summary>
    /// GERİDE KALAN SAPMA ONARILIR: plan toplamı cari toplamının altında kalmış kayıtlar açılışta
    /// hizalanır (taksit sayısı ve ilk vade korunur), hizalı kayda DOKUNULMAZ (idempotent).
    /// </summary>
    [Fact]
    public async Task RepairInstallmentPlanDrift_AlignsOnlyDriftedAccounts()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid driftedId, healthyId;
        DateOnly firstDue;

        await using (var db = NewDb(options))
        {
            // SAPMIŞ KAYIT: plan 8.500'e kuruldu, sonra toplam 8.750 oldu ama plan güncellenmedi
            // (düzeltmeden önceki UpdateAsync davranışı — canlıdaki 250 TL fark).
            var drifted = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Sapmış satış", 8500m, 0m);
            drifted.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(20)));
            db.CustomerAccounts.Add(drifted);
            await db.SaveChangesAsync();
            drifted.ChangeTotal(8750m, 0m);              // plan bilerek yeniden kurulmadı
            await db.SaveChangesAsync();
            driftedId = drifted.Id;
            firstDue = drifted.Installments.Min(i => i.DueDate);

            var healthy = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Sağlam satış", 6000m, 0m);
            healthy.RebuildInstallments(3, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(10)));
            db.CustomerAccounts.Add(healthy);
            await db.SaveChangesAsync();
            healthyId = healthy.Id;
        }

        Guid[] healthyPlanBefore;
        await using (var db = NewDb(options))
        {
            healthyPlanBefore = await db.Installments.Where(i => i.CustomerAccountId == healthyId)
                .OrderBy(i => i.DueDate).Select(i => i.Id).ToArrayAsync();
        }

        await using (var db = NewDb(options))
        {
            // Bakım artık HEDEFLİDİR: cari kimliği + beklenen (onarım öncesi) değerler verilir.
            var repaired = await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                new DatabaseBootstrap.InstallmentPlanRepairTarget(
                    driftedId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4)]);
            Assert.Equal(1, repaired);
        }

        await using (var check = NewDb(options))
        {
            var drifted = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == driftedId);
            Assert.Equal(4, drifted.Installments.Count);                       // taksit sayısı korunur
            Assert.Equal(8750m, drifted.Installments.Sum(i => i.Amount));      // kayıp alacak kapandı
            Assert.Equal(firstDue, drifted.Installments.Min(i => i.DueDate));  // ilk vade korunur

            // Sağlam kayıt hiç ellenmedi (satır kimlikleri aynı) → tekrar çalıştırmak zararsız.
            var healthyPlanAfter = await check.Installments.Where(i => i.CustomerAccountId == healthyId)
                .OrderBy(i => i.DueDate).Select(i => i.Id).ToArrayAsync();
            Assert.Equal(healthyPlanBefore, healthyPlanAfter);
        }

        // İDEMPOTENT: aynı ayarla ikinci açılış (rolling deploy'un ikinci instance'ı ya da bir
        // sonraki restart) HATA VERMEZ — kilit altında taze okunan plan zaten hedef değerdedir,
        // yapacak iş yoktur. Eskiden burada istisna atılıyor ve SERVİS AÇILMIYORDU.
        await using (var db = NewDb(options))
        {
            var again = await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [
                new DatabaseBootstrap.InstallmentPlanRepairTarget(
                    driftedId, seed.TenantId, 8750m, 0m, 8750m, 8500m, 4)]);
            Assert.Equal(1, again);
        }

        await using (var check = NewDb(options))
        {
            var drifted = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == driftedId);
            Assert.Equal(8750m, drifted.Installments.Sum(i => i.Amount));   // ikinci koşu bir şey değiştirmedi
        }
    }

    /// <summary>
    /// AYNI ONARIM GERÇEK VERİTABANINDA: aday taraması sunucuda çalışan bir alt-sorgu (COUNT + SUM)
    /// içerir. Çevrilemezse açılıştaki try/catch uyarı loglayıp SESSİZCE geçerdi — yani canlıda
    /// hiçbir şey onarılmazdı. InMemory sağlayıcı bunu göstermez.
    /// </summary>
    [MySqlFact]
    public async Task RepairInstallmentPlanDrift_RunsOnRealDatabase()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid driftedId, driftedTenantId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Sapma QA", $"sapma-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            var customer = new Customer(tenant.Id, branch.Id, "SAPMA MÜŞTERİ", "0555 909 80 70", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Sapmış satış", 8500m, 0m);
            account.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(20)));
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            account.ChangeTotal(8750m, 0m);      // plan bilerek yeniden kurulmadı
            await db.SaveChangesAsync();
            driftedId = account.Id;
            driftedTenantId = tenant.Id;
        }

        DatabaseBootstrap.InstallmentPlanRepairTarget Target() => new(
            driftedId, driftedTenantId, 8750m, 0m, 8750m, 8500m, 4);

        await using (var db = database.NewContext())
        {
            Assert.Equal(1, await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(db, null, [Target()]));
        }

        await using (var check = database.NewContext())
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == driftedId);
            Assert.Equal(4, account.Installments.Count);
            Assert.Equal(8750m, account.Installments.Sum(i => i.Amount));
        }

        // Sapma kapandı → aynı ayarla ikinci açılış İDEMPOTENT başarıdır (servis açılmalı).
        await using (var again = database.NewContext())
        {
            Assert.Equal(1, await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(again, null, [Target()]));
        }
    }

    /// <summary>Satış sonrası ürün silinse bile adisyon silinince stok GERİ EKLENİR.</summary>
    [Fact]
    public async Task DeleteApprovedAdisyon_WithDeletedProduct_StillRestoresStock()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId, productId;

        await using (var db = NewDb(options))
        {
            var product = new Product(seed.TenantId, seed.BranchId, "Şampuan", ProductCategory.Other, "adet",
                cost: 50m, salePrice: 100m, currentStock: 10m, minStockLevel: 0m);
            db.Products.Add(product);
            await db.SaveChangesAsync();
            productId = product.Id;

            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Product, product.Id, "Şampuan", 2, 100m, null, false));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;
        }

        await using (var db = NewDb(options))
        {
            var approved = await NewAdisyon(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            var product = await db.Products.SingleAsync(p => p.Id == productId);
            Assert.Equal(8m, product.CurrentStock);
        }

        // Ürün katalogdan kaldırılır (geçmiş satış bağı denetlenmiyor).
        await using (var db = NewDb(options))
        {
            var product = await db.Products.SingleAsync(p => p.Id == productId);
            product.SoftDelete();
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var deleted = await NewAdisyon(db).DeleteAsync(seed.TenantId, adisyonId);
            Assert.True(deleted.IsSuccess, deleted.IsFailure ? deleted.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var product = await check.Products.IgnoreQueryFilters().SingleAsync(p => p.Id == productId);
            Assert.Equal(10m, product.CurrentStock);
        }
    }
}

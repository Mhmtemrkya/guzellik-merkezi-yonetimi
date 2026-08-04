using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ADİSYON ONAYI — CARİ HESAP SEÇİMİ.
///
/// <para>
/// KURAL: fişte SATIŞ kalemi (paket/hizmet/ürün) varsa satış KENDİ cari kartını açar; satış
/// kalemi olmayan fiş (yalnız tahsilat / ek kalem) mevcut aktif cariye yazılır. Eskiden peşin
/// satış da mevcut cariye yazılıyordu: geçmişi olan müşteride yeni satış aylar önceki bir kartın
/// toplamını şişiriyor, Ön Muhasebe → Cari Hesaplar'da o satışa ait kart hiç görünmüyordu.
/// </para>
///
/// <para>
/// Mevcut cariye yazma yolu (ek kalem) hâlâ cariyi büyütüp taksit planını yeniden kuruyor
/// (<c>RebuildInstallments</c>). Bu yol canlıda <c>DbUpdateConcurrencyException</c> ("expected to
/// affect 1 row(s), but actually affected 0") ile 500 veriyordu: plan yeniden kurulurken üretilen
/// YENİ taksitler INSERT değil UPDATE olarak gönderiliyordu. Regresyon koruması burada durur.
/// </para>
///
/// <para>
/// InMemory sağlayıcı etkilenen satır sayısını doğrulamadığı için hata yalnız gerçek
/// MySQL/MariaDB'de görülür. Sunucu yoksa test atlanır.
/// </para>
/// </summary>
public sealed class AdisyonApproveExistingAccountMySqlTests
{
    private static AdisyonService NewService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user,
            new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid ServiceId, Guid AccountId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Cari Taksit", $"cari-taksit-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "TAKSİTLİ MÜŞTERİ", "0555 777 88 99", null);
        db.Customers.Add(customer);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 1250m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        // Müşterinin ZATEN açık bir carisi ve 4 taksitlik planı var.
        var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Önceki paket", 20000m, 0m);
        account.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(10)));
        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, service.Id, account.Id);
    }

    /// <summary>Fişi açar, tek kalem ekler ve onaylar; onay sonucunu döndürür.</summary>
    private static async Task<Guid> ApproveWithSingleItemAsync(
        MySqlTestDatabase database, Seed seed, AdisyonItemType type, Guid? refId, string description)
    {
        Guid adisyonId;
        await using (var db = database.NewContext())
        {
            var service = NewService(db);
            var created = await service.CreateAsync(seed.TenantId,
                new CreateAdisyonRequest(seed.BranchId, seed.CustomerId, null, null, ForceNew: true));
            Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
            adisyonId = created.Value!.Id;

            var item = await service.AddItemAsync(seed.TenantId, adisyonId,
                new AddAdisyonItemRequest(type, refId, description, 1, 1250m, null, false));
            Assert.True(item.IsSuccess, item.IsFailure ? item.Error.Message : null);
        }

        await using (var db = database.NewContext())
        {
            var approved = await NewService(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }
        return adisyonId;
    }

    /// <summary>
    /// SATIŞ KALEMİ OLMAYAN fiş (ek kalem) mevcut taksitli cariye yazılır: cari toplamı artmalı,
    /// plan yeniden kurulmalı ve istek HATA VERMEMELİ (DbUpdateConcurrencyException regresyonu).
    /// </summary>
    [MySqlFact]
    public async Task Approve_ExtraCharge_OntoExistingAccountWithInstallments_Succeeds()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await ApproveWithSingleItemAsync(database, seed, AdisyonItemType.Extra, null, "Ek kalem");

        await using var check = database.NewContext();
        var account = await check.CustomerAccounts
            .Include(a => a.Installments)
            .SingleAsync(a => a.Id == seed.AccountId);
        // 20.000 + 1.250 = 21.250; plan aynı taksit sayısıyla yeniden kurulur.
        Assert.Equal(21250m, account.TotalAmount);
        Assert.Equal(4, account.Installments.Count);
        Assert.Equal(21250m, account.Installments.Sum(i => i.Amount));
    }

    /// <summary>
    /// HİZMET SATIŞI KENDİ CARİ KARTINI AÇAR: müşterinin eski carisi büyümez, satışın adını
    /// taşıyan yeni bir kart oluşur (Ön Muhasebe → Cari Hesaplar'da satış görünür olsun).
    /// </summary>
    [MySqlFact]
    public async Task Approve_ServiceSale_OpensOwnAccount_AndLeavesExistingUntouched()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await ApproveWithSingleItemAsync(database, seed, AdisyonItemType.Service, seed.ServiceId, "Cilt Bakımı");

        await using var check = database.NewContext();
        var accounts = await check.CustomerAccounts
            .Include(a => a.Installments)
            .Where(a => a.CustomerId == seed.CustomerId)
            .ToListAsync();

        Assert.Equal(2, accounts.Count);

        var existing = accounts.Single(a => a.Id == seed.AccountId);
        Assert.Equal(20000m, existing.TotalAmount);          // eski kart DOKUNULMAZ
        Assert.Equal(4, existing.Installments.Count);

        var sale = accounts.Single(a => a.Id != seed.AccountId);
        Assert.Equal(1250m, sale.TotalAmount);
        Assert.Equal("Cilt Bakımı", sale.Name);              // kart satışın adını taşır
    }
}

/// <summary>Hatayı EN DAR haliyle izole eder: yalnız yükle → planı yeniden kur → kaydet.</summary>
public sealed class RebuildInstallmentsMySqlTests
{
    [MySqlFact]
    public async Task RebuildInstallments_OnTrackedAccount_PersistsNewPlan()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid accountId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Plan QA", $"plan-qa-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
            var customer = new Customer(tenant.Id, branch.Id, "PLAN MÜŞTERİ", "0555 000 11 22", null);
            db.Customers.Add(customer);
            await db.SaveChangesAsync();
            var account = new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, "Paket", 20000m, 0m);
            account.RebuildInstallments(4, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(10)));
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            accountId = account.Id;
        }

        await using (var db = database.NewContext())
        {
            var account = await db.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == accountId);
            account.ChangeTotal(21250m, account.DepositAmount);
            account.RebuildInstallments(4, account.Installments.Min(i => i.DueDate));
            await db.SaveChangesAsync();
        }

        await using (var check = database.NewContext())
        {
            var account = await check.CustomerAccounts.Include(a => a.Installments).SingleAsync(a => a.Id == accountId);
            Assert.Equal(4, account.Installments.Count);
            Assert.Equal(21250m, account.Installments.Sum(i => i.Amount));
        }
    }
}

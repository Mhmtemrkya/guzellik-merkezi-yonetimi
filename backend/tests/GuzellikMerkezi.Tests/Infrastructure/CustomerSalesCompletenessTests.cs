using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.InMemory.Infrastructure.Internal;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// MÜŞTERİ KAPSAMINDA SATIŞ LİSTESİ TAMDIR — SESSİZ KESME YOK.
///
/// <para>
/// Web (<c>CariSalesWorkspace</c>) ve mobil (<c>customer_sales_panel</c>) bu ucu tek sayfa
/// <c>pageSize=500</c> ile çağırıyordu. 500'den fazla canlı satışı olan müşteride fazlası HİÇ
/// görünmüyor, üstelik panelin "Toplam Harcama / Tahsil Edilen" özetleri bu eksik listeden
/// hesaplandığı için rakam YANLIŞ ama hatasız görünüyordu. Sayfa boyutunu büyütmek uçurumu
/// taşır, kaldırmaz.
/// </para>
/// <para>
/// Sayfalamayı istemciye bırakmak da çözüm değil: her sayfa ayrı transaction demektir ve bu ucun
/// var oluş sebebi olan tek-anlık-görüntü garantisi (canlı + arşiv aynı andan) bozulurdu. Bu
/// yüzden kapsamlı çağrıda sayfa boyutu YOK SAYILIR ve liste sunucuda tamamlanır.
/// </para>
/// </summary>
public sealed class CustomerSalesCompletenessTests
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

    private sealed record Seed(Guid TenantId, Guid CustomerId, Guid OtherCustomerId, int SaleCount);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options, int saleCount)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Tam Liste", $"tam-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "ÇOK SATIŞLI", "0555 121 21 21", null);
        var other = new Customer(tenant.Id, branch.Id, "BAŞKA MÜŞTERİ", "0555 343 43 43", null);
        db.Customers.AddRange(customer, other);
        await db.SaveChangesAsync();

        for (var i = 0; i < saleCount; i++)
        {
            db.CustomerAccounts.Add(
                new CustomerAccount(tenant.Id, branch.Id, customer.Id, null, $"Satış {i + 1}", 100m, 0m));
        }
        // Kapsam kontrolü: başka müşterinin satışı listeye SIZMAMALI.
        db.CustomerAccounts.Add(
            new CustomerAccount(tenant.Id, branch.Id, other.Id, null, "Yabancı satış", 999m, 0m));
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, customer.Id, other.Id, saleCount);
    }

    /// <summary>
    /// ASIL İDDİA: istemci küçük bir sayfa boyutu istese bile müşterinin TÜM satışları döner.
    /// Düzeltmeden önce bu çağrı yalnız ilk sayfayı (burada 2 satır) döndürüyordu.
    /// </summary>
    [Fact]
    public async Task ListWithArchive_ForCustomer_ReturnsEverySale_IgnoringRequestedPageSize()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, saleCount: 7);

        await using var db = NewDb(options);
        // Bilerek KÜÇÜK sayfa: kesme olsaydı 7 yerine 2 dönerdi.
        var res = await NewService(db).ListWithArchiveAsync(
            seed.TenantId, new PageRequest(1, 2), seed.CustomerId);

        Assert.True(res.IsSuccess, res.IsFailure ? res.Error.Message : null);
        Assert.Equal(seed.SaleCount, res.Value!.Live.Items.Count);
        Assert.Equal(seed.SaleCount, res.Value.Live.TotalCount);
        // Kapsam korunur: yabancı satış sızmadı.
        Assert.All(res.Value.Live.Items, a => Assert.Equal(seed.CustomerId, a.CustomerId));
    }

    /// <summary>
    /// KAPSAMSIZ ÇAĞRI DA TAMDIR (Ön Muhasebe cari tablosu). Orada da canlı liste ve iptal arşivi
    /// AYRI isteklerle çekiliyordu; tablo müşteri bazında gruplanıp para topladığı için aynı
    /// iptal yarışı oradaki toplamları da bozabiliyordu. İstemci zaten tüm listeyi çekiyordu —
    /// tamlık yeni maliyet değil, tek anlık görüntü kazancıdır.
    /// </summary>
    [Fact]
    public async Task ListWithArchive_WithoutCustomer_AlsoReturnsEverySale()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options, saleCount: 7);

        await using var db = NewDb(options);
        // Küçük sayfa istense bile kurum geneli liste tam döner (7 + yabancı müşterinin 1'i).
        var res = await NewService(db).ListWithArchiveAsync(seed.TenantId, new PageRequest(1, 3));

        Assert.True(res.IsSuccess, res.IsFailure ? res.Error.Message : null);
        Assert.Equal(8, res.Value!.Live.Items.Count);
        Assert.Equal(8, res.Value.Live.TotalCount);
        Assert.Contains(res.Value.Live.Items, a => a.CustomerId == seed.OtherCustomerId);
    }
}

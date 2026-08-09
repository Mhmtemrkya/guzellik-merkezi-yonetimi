using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// SORGU ÇEVİRİ SONDASI — hangi <c>Contains</c> şekli MySql.EntityFrameworkCore'da çevrilebiliyor?
///
/// <para>
/// Bu bir davranış testi değil, SAĞLAYICI SÖZLEŞMESİ testidir. Depoda "yerel dizi Contains 500
/// verir" kuralı dolaşıyor ama kuralın SINIRI belirsizdi: onlarca yerde yerel Guid dizisi
/// kullanılıyor ve canlıda çalışıyor, buna karşın paket onayı 500 veriyordu. Sınırı tahmin etmek
/// yerine ÖLÇÜYORUZ; düzeltmenin ne kadar geniş olması gerektiğini bu test belirler.
/// </para>
///
/// <para>
/// Sağlayıcı sürümü yükseltilirken bu test kırılırsa kural değişmiş demektir — o zaman
/// <c>QueryExtensions</c> etrafındaki bellekte-süz deseni gözden geçirilmelidir.
/// </para>
/// </summary>
public sealed class ContainsTranslationProbeMySqlTests
{
    private sealed record Probe(Guid TenantId, Guid ServiceAId, Guid ServiceBId);

    private static async Task<Probe> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Sonda", $"sonda-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var a = new ServiceDefinition(tenant.Id, branch.Id, "A", 30, 100m, "Kat");
        var b = new ServiceDefinition(tenant.Id, branch.Id, "B", 30, 200m, "Kat");
        db.ServiceDefinitions.Add(a);
        db.ServiceDefinitions.Add(b);
        await db.SaveChangesAsync();
        return new Probe(tenant.Id, a.Id, b.Id);
    }

    /// <summary>Şekli çalıştırır; çevrilemiyorsa istisna mesajını döndürür, çalışıyorsa null.</summary>
    private static async Task<string?> TryAsync(Func<Task> query)
    {
        try
        {
            await query();
            return null;
        }
        catch (Exception ex)
        {
            // Şekle göre istisna TÜRÜ de değişiyor (çeviri hatası InvalidOperationException,
            // parametre bağlama hatası NullReferenceException) — tür de rapora girer.
            return $"{ex.GetType().Name}: {ex.Message}";
        }
    }

    [MySqlFact]
    public async Task Probe_WhichContainsShapesTranslate()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var probe = await SeedAsync(database);
        await using var db = database.NewContext();

        var results = new Dictionary<string, string?>();

        // 1) YEREL Guid dizisi — kodda en yaygın şekil.
        Guid[] localArray = [probe.ServiceAId, probe.ServiceBId];
        results["Guid[] yerel"] = await TryAsync(() =>
            db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == probe.TenantId && localArray.Contains(x.Id))
                .ToListAsync());

        // 2) YEREL List<Guid>
        var localList = new List<Guid> { probe.ServiceAId, probe.ServiceBId };
        results["List<Guid> yerel"] = await TryAsync(() =>
            db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == probe.TenantId && localList.Contains(x.Id))
                .ToListAsync());

        // 3) YEREL HashSet<Guid>
        var localSet = new HashSet<Guid> { probe.ServiceAId };
        results["HashSet<Guid> yerel"] = await TryAsync(() =>
            db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == probe.TenantId && localSet.Contains(x.Id))
                .ToListAsync());

        // 4) BELLEKTEKİ NESNE KOLEKSİYONU ÜZERİNDE Select(...) — paket onayının patlayan şekli.
        var items = new List<ServicePackageItem>
        {
            new(Guid.NewGuid(), probe.ServiceAId, 6, 100m),
            new(Guid.NewGuid(), probe.ServiceBId, 6, 200m),
        };
        results["koleksiyon.Select(...) gömülü"] = await TryAsync(() =>
            db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == probe.TenantId && items.Select(i => i.ServiceDefinitionId).Contains(x.Id))
                .ToListAsync());

        // 5) YEREL enum dizisi — depo notundaki personel 500'ünün şekli.
        UserRole[] localRoles = [UserRole.InstitutionOwner, UserRole.BranchManager];
        results["enum[] yerel"] = await TryAsync(() =>
            db.TenantUsers.AsNoTracking()
                .Where(u => u.TenantId == probe.TenantId && localRoles.Contains(u.Role))
                .ToListAsync());

        // 6) Select(...) ÖNCEDEN materyalize edilmiş (önerilen düzeltme şekli).
        var materialized = items.Select(i => i.ServiceDefinitionId).ToArray();
        results["Select(...).ToArray() sonra"] = await TryAsync(() =>
            db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == probe.TenantId && materialized.Contains(x.Id))
                .ToListAsync());

        var report = string.Join("\n", results.Select(kv =>
            $"  {kv.Key,-32} : {(kv.Value is null ? "ÇEVRİLDİ" : "PATLADI — " + kv.Value)}"));

        // ÖLÇÜLEN KURAL (MySql.EntityFrameworkCore 10.0.7): YEREL bir koleksiyonun `Contains`i
        // CANLI sorguda HİÇBİR şekilde çevrilemiyor — dizi de, List de, HashSet de, enum dizisi
        // de, gömülü Select de. Kimlikleri önce diziye almak DA çare değildir (6. şekil).
        //
        // Bu yüzden depodaki tek geçerli desen: ÖNCE `ToListAsync`, SONRA bellekte süz
        // (bkz. QueryExtensions.ToListByIdsAsync). Sağlayıcı yükseltmesi bu kuralı değiştirirse
        // test KIRILIR ve desen bilinçli olarak gözden geçirilir — sessizce geri gelmesin.
        //
        // NOT: `static readonly` bir dizi (ör. AppointmentService.OpenAppointmentStatuses) bu
        // kuralın DIŞINDADIR: EF onu parametreleştirmeyip sabit olarak gömer (`IN (…)`) ve
        // çalışır. Ayrım "yerel mi statik mi"dir, "dizi mi değil mi" değil.
        string[] mustThrow =
        [
            "Guid[] yerel", "List<Guid> yerel", "HashSet<Guid> yerel",
            "koleksiyon.Select(...) gömülü", "enum[] yerel", "Select(...).ToArray() sonra",
        ];
        foreach (var shape in mustThrow)
        {
            Assert.True(results[shape] is not null,
                $"'{shape}' artık ÇEVRİLİYOR — sağlayıcı kuralı değişmiş. Bellekte-süz desenini " +
                $"gözden geçirin, bu testi güncelleyin.\n{report}");
        }

        // Önerilen desenin gerçekten çalıştığı da ölçülür (yoksa test yalnız "her şey patlıyor"
        // der ve düzeltmenin doğruluğunu kanıtlamaz).
        var wanted = new HashSet<Guid> { probe.ServiceAId };
        var inMemory = (await db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == probe.TenantId)
                .Select(x => new { x.Id, x.Price })
                .ToListAsync())
            .Where(x => wanted.Contains(x.Id))
            .ToList();
        Assert.Single(inMemory);
        Assert.Equal(probe.ServiceAId, inMemory[0].Id);
    }
}

using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// KURUMUN VERİTABANINDAN GERÇEKTEN SİLİNMESİ.
///
/// <para>
/// Platform panelindeki "Sil" düğmesi eskiden yalnızca <c>tenant.Cancel()</c> çağırıyordu: kurum
/// listeden kayboluyor ama tüm satırları (müşteriler, randevular, tahsilatlar, şifreli kişisel
/// veriler) veritabanında kalıyordu. Artık gerçekten siliniyor.
/// </para>
///
/// <para>
/// <b>Neden gerçek MySQL şart?</b> Silme yolu ham SQL <c>DELETE</c> ve yabancı anahtar kısıtlarına
/// dayanıyor. InMemory sağlayıcı ne FK zorlar ne transaction uygular — orada bu testler
/// "geçerdi" ama <c>tenants</c> satırını silmeye çalışan gerçek sorgu <c>branches</c> ve
/// <c>tenant_users</c> üzerindeki <c>Restrict</c> kısıtına takılırdı. Sunucu yoksa test atlanır.
/// </para>
/// </summary>
public sealed class TenantHardDeleteMySqlTests
{
    private static TenantService NewService(GuzellikDbContext db) =>
        new(db, new PlainPasswordHasher(), new AllowAllFeatureService(), new NoopAuditLogger(), TestSearchIndex.Create());

    private sealed record Seed(Guid TenantId, Guid OtherTenantId, Guid CustomerId, Guid AppointmentId);

    /// <summary>
    /// İki kurum: silinecek olan (şube + kullanıcı + müşteri + personel + hizmet + randevu) ve
    /// DOKUNULMAMASI gereken bir komşu kurum.
    /// </summary>
    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();

        var tenant = new Tenant("Silinecek Kurum", $"sil-{Guid.NewGuid():N}"[..16], "Premium", TenantStatus.Active);
        tenant.AssignCode("BA-90");
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        tenant.GrantAccess("sahip@sil.test", UserRole.InstitutionOwner, null, "Sahip");

        var other = new Tenant("Kalacak Kurum", $"kal-{Guid.NewGuid():N}"[..16], "Premium", TenantStatus.Active);
        other.AssignCode("BA-91");
        var otherBranch = other.AddBranch("Merkez", "Ankara", true);
        other.GrantAccess("sahip@kal.test", UserRole.InstitutionOwner, null, "Diğer Sahip");

        db.Tenants.AddRange(tenant, other);
        await db.SaveChangesAsync();

        var staff = new StaffMember(tenant.Id, branch.Id, "Elif Demir", "Uzman", "+90 500 000 00 01");
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 45, 1000, "Bakım");
        var customer = new Customer(tenant.Id, branch.Id, "Ayşe Yılmaz", "+90 555 111 22 33", "ayse@ornek.com");
        db.StaffMembers.Add(staff);
        db.ServiceDefinitions.Add(service);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        var start = DateTime.UtcNow.Date.AddHours(10);
        var appointment = new Appointment(tenant.Id, branch.Id, customer.Id, staff.Id, service.Id, start, start.AddMinutes(45), 1000, null);
        db.Appointments.Add(appointment);

        // Komşu kurumun da müşterisi olsun: silme onu kapsamamalı.
        db.Customers.Add(new Customer(other.Id, otherBranch.Id, "Zeynep Ak", "+90 555 999 88 77", null));
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, other.Id, customer.Id, appointment.Id);
    }

    /// <summary>
    /// ASIL İDDİA: silme sonrası kuruma ait HİÇBİR satır kalmaz — kurum, şube, kullanıcı,
    /// müşteri, personel, hizmet ve randevu dahil.
    /// </summary>
    [MySqlFact]
    public async Task Delete_RemovesTenantAndAllItsRows()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            var result = await NewService(db).DeleteAsync(seed.TenantId);
            Assert.True(result.IsSuccess);
        }

        await using var check = database.NewContext();
        Assert.False(await check.Tenants.IgnoreQueryFilters().AnyAsync(x => x.Id == seed.TenantId));
        Assert.False(await check.Branches.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.TenantId));
        Assert.False(await check.TenantUsers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.TenantId));
        Assert.False(await check.Customers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.TenantId));
        Assert.False(await check.StaffMembers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.TenantId));
        Assert.False(await check.ServiceDefinitions.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.TenantId));
        Assert.False(await check.Appointments.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.TenantId));
    }

    /// <summary>
    /// KAPSAM: silme YALNIZ hedef kuruma dokunur. Ham SQL <c>DELETE</c>'lerde tenant süzgeci
    /// unutulursa tüm platformun verisi silinirdi — bu testin asıl işi o felaketi kilitlemek.
    /// </summary>
    [MySqlFact]
    public async Task Delete_DoesNotTouchOtherTenants()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            await NewService(db).DeleteAsync(seed.TenantId);
        }

        await using var check = database.NewContext();
        Assert.True(await check.Tenants.IgnoreQueryFilters().AnyAsync(x => x.Id == seed.OtherTenantId));
        Assert.True(await check.Branches.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.OtherTenantId));
        Assert.True(await check.TenantUsers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == seed.OtherTenantId));
        Assert.Equal(1, await check.Customers.IgnoreQueryFilters().CountAsync(x => x.TenantId == seed.OtherTenantId));
    }

    /// <summary>
    /// Silinen kurumun KODU yeniden dağıtılmaz: bir sonraki kurum en büyük numaranın üstünden
    /// devam eder. Aksi hâlde eski destek kayıtları yanlış kurumu gösterirdi.
    /// </summary>
    [MySqlFact]
    public async Task Delete_DoesNotFreeTheTenantCodeForReuse()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            await NewService(db).DeleteAsync(seed.TenantId);
        }

        // BA-90 silindi ama BA-91 (komşu kurum) duruyor → sıradaki kod BA-92 olmalı.
        await using var check = database.NewContext();
        var next = await TenantCodeAllocator.NextAsync(check);
        Assert.Equal("BA-92", next);
    }

    /// <summary>Zaten iptal edilmiş (eski soft-delete) kurumlar da kalıcı olarak silinebilir.</summary>
    [MySqlFact]
    public async Task Delete_WorksForAlreadyCancelledTenants()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            var tenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(x => x.Id == seed.TenantId);
            tenant.Cancel();
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var result = await NewService(db).DeleteAsync(seed.TenantId);
            Assert.True(result.IsSuccess);
        }

        await using var check = database.NewContext();
        Assert.False(await check.Tenants.IgnoreQueryFilters().AnyAsync(x => x.Id == seed.TenantId));
    }

    /// <summary>Olmayan kurumda 404 döner (sessizce "başarılı" demez).</summary>
    [MySqlFact]
    public async Task Delete_UnknownTenant_ReturnsNotFound()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        await using var db = database.NewContext();

        var result = await NewService(db).DeleteAsync(Guid.CreateVersion7());
        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
    }
}

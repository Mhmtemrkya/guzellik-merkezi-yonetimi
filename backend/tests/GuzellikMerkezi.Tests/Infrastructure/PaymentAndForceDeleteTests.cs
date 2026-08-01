using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// TAHSİLAT ÜST SINIRI + ZORLA SİLMEDE KALAN HAK (denetim raporu).
///
/// <para>1) Tahsilat ucu yalnız "Amount &gt; 0" kontrol ediyordu: kalan borcu aşan tutar sessizce
/// kredi bakiyeye yazılıyor, iki kasa aynı borcu aynı anda tahsil edebiliyordu. Arayüzün doğru
/// davranması backend için koruma değildir.</para>
///
/// <para>2) <c>force=true</c> ile onaylı adisyon silinirken kullanılmış seans satırı korunuyordu
/// ama KALAN hak da aktif kalıyordu: 10 seanslık pakette 1 seans kullanıldıysa satışın tüm
/// bedeli iade edilirken müşteride 9 bedelsiz seans kalıyordu.</para>
/// </summary>
public sealed class PaymentAndForceDeleteTests
{
    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static CustomerAccountService NewAccountService(GuzellikDbContext db) =>
        new(db, new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

    private static AdisyonService NewAdisyonService(GuzellikDbContext db)
    {
        var user = new TestCurrentUser(UserRole.InstitutionOwner);
        return new AdisyonService(db, new NoopAuditLogger(), user, new CustomerAccountService(db, new NoopAuditLogger(), user), new AllowAllFeatureService());
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId, Guid ServiceId);

    private static async Task<Seed> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);
        var tenant = new Tenant("Ödeme QA", $"odeme-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "ÖDEME MÜŞTERİ", "0555 111 22 33", null);
        db.Customers.Add(customer);
        var service = new ServiceDefinition(tenant.Id, branch.Id, "Cilt Bakımı", 60, 500m, "Cilt");
        db.ServiceDefinitions.Add(service);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id, service.Id);
    }

    /// <summary>Kalan borcu aşan tahsilat REDDEDİLİR (kredi bakiyeye sessizce yazılmaz).</summary>
    [Fact]
    public async Task RegisterPaymentAsync_RejectsAmountAboveRemaining()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid accountId;

        await using (var db = NewDb(options))
        {
            var account = new CustomerAccount(seed.TenantId, seed.BranchId, seed.CustomerId, null, "Paket", 1000m, 0m);
            db.CustomerAccounts.Add(account);
            await db.SaveChangesAsync();
            accountId = account.Id;
        }

        // Kalan borç kadar tahsilat geçer.
        await using (var db = NewDb(options))
        {
            var ok = await NewAccountService(db).RegisterPaymentAsync(seed.TenantId, accountId,
                new RegisterAccountPaymentRequest(400m, "cash", null, null));
            Assert.True(ok.IsSuccess, ok.IsFailure ? ok.Error.Message : null);
            Assert.Equal(600m, ok.Value!.RemainingAmount);
        }

        // Kalan 600 ₺ iken 1.000 ₺ tahsilat reddedilmeli (eskiden kabul edilip kredi yazılıyordu).
        await using (var db = NewDb(options))
        {
            var tooMuch = await NewAccountService(db).RegisterPaymentAsync(seed.TenantId, accountId,
                new RegisterAccountPaymentRequest(1000m, "cash", null, null));
            Assert.True(tooMuch.IsFailure, "Kalan borcu aşan tahsilat kabul edildi.");
            Assert.Equal("Validation", tooMuch.Error.Code);
        }

        // Kalanın tamamı (600 ₺) hâlâ tahsil edilebilmeli — sınır çok sıkı olmamalı.
        await using (var db = NewDb(options))
        {
            var exact = await NewAccountService(db).RegisterPaymentAsync(seed.TenantId, accountId,
                new RegisterAccountPaymentRequest(600m, "cash", null, null));
            Assert.True(exact.IsSuccess, exact.IsFailure ? exact.Error.Message : null);
            Assert.Equal(0m, exact.Value!.RemainingAmount);
        }
    }

    /// <summary>
    /// force=true ile silinen satışta kullanılmış seans satırı KORUNUR ama kalan hak KAPANIR:
    /// toplam = kullanılan. Aksi hâlde bedel iade edilirken müşteride bedelsiz seans kalıyordu.
    /// </summary>
    [Fact]
    public async Task ForceDelete_ClosesRemainingSessionsOnUsedRows()
    {
        var options = NewOptions();
        var seed = await SeedAsync(options);
        Guid adisyonId, sessionId;

        await using (var db = NewDb(options))
        {
            var adisyon = new Adisyon(seed.TenantId, seed.BranchId, seed.CustomerId, null, null);
            db.Adisyonlar.Add(adisyon);
            await db.SaveChangesAsync();
            db.AdisyonItems.Add(adisyon.AddItem(AdisyonItemType.Service, seed.ServiceId, "10 seanslık bakım", 1, 5000m, null, false));
            await db.SaveChangesAsync();
            adisyonId = adisyon.Id;

            var approved = await NewAdisyonService(db).ApproveAsync(seed.TenantId, adisyonId);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
        }

        // Satılan seansı 10'a çıkar ve 1'ini kullan (gerçek senaryo: 10 seanslık paket).
        await using (var db = NewDb(options))
        {
            var session = await db.CustomerPackageSessions.FirstAsync(s => s.TenantId == seed.TenantId);
            sessionId = session.Id;
            db.Entry(session).Property(x => x.TotalSessions).CurrentValue = 10;
            Assert.True(session.TryConsume());
            await db.SaveChangesAsync();
        }

        await using (var db = NewDb(options))
        {
            var deleted = await NewAdisyonService(db).DeleteAsync(seed.TenantId, adisyonId, force: true);
            Assert.True(deleted.IsSuccess, deleted.IsFailure ? deleted.Error.Message : null);
        }

        await using (var check = NewDb(options))
        {
            var session = await check.CustomerPackageSessions.SingleAsync(s => s.Id == sessionId);
            // Yapılan iş korunur…
            Assert.Equal(1, session.UsedSessions);
            // …ama ileriye dönük hak kapanır: bedeli iade edilen 9 seans aktif kalmamalı.
            Assert.Equal(1, session.TotalSessions);
            Assert.Equal(0, session.RemainingSessions);
        }
    }
}

using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// ÇOK KURUMLU HESAP SEÇTİĞİ KURUMA GİREBİLMELİ.
///
/// <para>
/// <c>/login-scope</c> aynı e-posta + role ait TÜM kurumları döndürüyor, ama giriş sorgusu
/// (e-posta + rol + aktif) kurum içermiyordu: DB'nin döndürdüğü İLK kayıt seçiliyor, ardından
/// "TenantId eşleşmiyor" diye reddediliyordu. Kullanıcı modalda ikinci kurumu seçtiğinde her
/// zaman "Kurum seçimi geçersiz" alıyordu — yeni eklenen çok kurumlu giriş özelliği pratikte
/// yalnız ilk kurumda çalışıyordu.
/// </para>
/// </summary>
public sealed class MultiTenantLoginTests
{
    private const string Email = "sahip@ornek.test";
    private const string Password = "Guzellik123!";

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static GuzellikDbContext NewDb(DbContextOptions<GuzellikDbContext> options) =>
        new(options, null, new TestCurrentUser(), null, null, TestSearchIndex.Create());

    private static AuthService NewService(GuzellikDbContext db) =>
        new(db, new PlainPasswordHasher(), new StubTokenService(), new FixedClock(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner),
            new AllowAllFeatureService(), null!);

    /// <summary>Aynı e-posta + rol ile İKİ kurumda sahiplik.</summary>
    private static async Task<(Guid FirstTenantId, Guid SecondTenantId, Guid SecondBranchId)> SeedAsync(
        DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = NewDb(options);

        var first = new Tenant("Birinci Kurum", $"birinci-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        first.AddBranch("Merkez", "İstanbul", true);
        var firstUser = first.GrantAccess(Email, UserRole.InstitutionOwner, null, "Deniz Kaya");
        firstUser.SetPasswordHash(Password);

        var second = new Tenant("İkinci Kurum", $"ikinci-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var secondBranch = second.AddBranch("Merkez", "Ankara", true);
        var secondUser = second.GrantAccess(Email, UserRole.InstitutionOwner, null, "Deniz Kaya");
        secondUser.SetPasswordHash(Password);

        db.Tenants.AddRange(first, second);
        await db.SaveChangesAsync();
        return (first.Id, second.Id, secondBranch.Id);
    }

    /// <summary>Kullanıcı İKİNCİ kurumu seçtiğinde giriş yapabilmeli ve oturum o kuruma açılmalı.</summary>
    [Fact]
    public async Task LoginAsync_SelectsUserOfRequestedTenant()
    {
        var options = NewOptions();
        var (firstTenantId, secondTenantId, secondBranchId) = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).LoginAsync(
            new LoginRequest(Email, Password, UserRole.InstitutionOwner, secondTenantId, secondBranchId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(secondTenantId, result.Value!.User.TenantId);
        Assert.NotEqual(firstTenantId, result.Value.User.TenantId);
    }

    /// <summary>İlk kurum da elbette çalışmaya devam etmeli (seçim gerçekten seçim olsun).</summary>
    [Fact]
    public async Task LoginAsync_StillWorksForFirstTenant()
    {
        var options = NewOptions();
        var (firstTenantId, _, _) = await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).LoginAsync(
            new LoginRequest(Email, Password, UserRole.InstitutionOwner, firstTenantId, null));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(firstTenantId, result.Value!.User.TenantId);
    }

    /// <summary>Kurum seçilmeden kuruma bağlı rolle giriş yapılamaz (yanlış kuruma düşmesin).</summary>
    [Fact]
    public async Task LoginAsync_WithoutTenantSelection_IsRejected()
    {
        var options = NewOptions();
        await SeedAsync(options);

        await using var db = NewDb(options);
        var result = await NewService(db).LoginAsync(
            new LoginRequest(Email, Password, UserRole.InstitutionOwner, null, null));

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
    }
}

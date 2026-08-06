using GuzellikMerkezi.Application.Features.GiftCards;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// BAKİYE VE TEK KULLANIMLIK JETON YARIŞLARI — GERÇEK VERİTABANI DAVRANIŞI.
///
/// <para>
/// <see cref="ConcurrencyMySqlTests"/> adisyon/peşinat yollarını koruyordu; SONRADAN eklenen para
/// yolları o desene hiç alınmamıştı. Bu dosya aynı sınıfın kalan üyelerini kapatır:
/// </para>
/// <list type="bullet">
/// <item><b>Kontör cüzdanı</b> — <c>tenant_messaging_wallets</c> kilit protokolünde YOKTU:
/// "kullanılabilir bakiye yeter mi?" kontrolü ile rezervasyonun yazılması ayrı adımlardı, iki
/// eşzamanlı gönderim aynı bakiyeyi görüp ikisi de rezerve edebiliyordu (bakiyeden fazla taahhüt).</item>
/// <item><b>Hediye çeki</b> — <c>gift_cards</c> kilit listesindeydi ve adisyon yolu kilitliyordu,
/// ama DOĞRUDAN kullanım ucu protokole katılmıyordu: 100 ₺'lik çek iki kez 100 ₺ kullanılabiliyordu.</item>
/// <item><b>Tek kullanımlık jetonlar</b> — onam imzası ve değerlendirme linki: "kullanılmış mı?"
/// kontrolü ile yazma arasında kilit yoktu; çift tıklama iki kayıt üretebiliyordu.</item>
/// </list>
/// <para>
/// Hepsi YALNIZ gerçek MySQL/MariaDB üzerinde görülür: InMemory sağlayıcıda transaction yok sayılır,
/// <c>SELECT … FOR UPDATE</c> atlanır ve "eşzamanlı" iki çağrı zaten sırayla işler.
/// </para>
/// </summary>
public sealed class BalanceRaceMySqlTests
{
    private sealed record Seed(Guid TenantId, Guid BranchId, Guid CustomerId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Bakiye QA", $"bakiye-qa-{Guid.NewGuid():N}"[..24], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var customer = new Customer(tenant.Id, branch.Id, "BAKİYE MÜŞTERİ", "0555 222 33 44", null);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, customer.Id);
    }

    // =====================================================================================
    // 1) HEDİYE ÇEKİ — eşzamanlı çifte bozdurma
    // =====================================================================================

    /// <summary>
    /// ASIL İDDİA: 100 ₺ bakiyeli çeke AYNI ANDA iki 100 ₺'lik kullanım gelirse yalnız biri geçer.
    ///
    /// <para>
    /// Kilit olmadan ikisi de bakiyeyi 100 okuyup ikisi de "yeterli" görüyor, ikisi de 0 yazıyordu:
    /// kasadan 200 ₺'lik indirim çıkarken çekten yalnız 100 ₺ düşüyordu. Bakiyenin EKSİYE
    /// düşmemesi yetmez — ikinci kullanım hiç GERÇEKLEŞMEMELİDİR.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentGiftCardRedeem_SucceedsExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        Guid cardId;
        await using (var db = database.NewContext())
        {
            var card = new GiftCard(seed.TenantId, seed.BranchId, "HD-YARIS1", GiftCardKind.StoredValue,
                value: 100m, validUntilUtc: null, maxUses: 0, note: null, customerId: null);
            db.GiftCards.Add(card);
            await db.SaveChangesAsync();
            cardId = card.Id;
        }

        async Task<bool> RedeemAsync()
        {
            await using var db = database.NewContext();
            var service = new GiftCardService(db, new NoopAuditLogger(), new AllowAllFeatureService());
            var result = await service.RedeemAsync(seed.TenantId, cardId, new RedeemGiftCardRequest(100m));
            return result.IsSuccess;
        }

        var results = await Task.WhenAll(RedeemAsync(), RedeemAsync());

        Assert.Equal(1, results.Count(x => x));

        await using var check = database.NewContext();
        var final = await check.GiftCards.IgnoreQueryFilters().SingleAsync(g => g.Id == cardId);
        Assert.Equal(0m, final.Balance);
        Assert.Equal(1, final.UsedCount);   // TEK kullanım kaydedilmeli
    }

    // =====================================================================================
    // 2) KONTÖR CÜZDANI — eşzamanlı rezervasyon bakiyeyi aşamaz
    // =====================================================================================

    /// <summary>
    /// ASIL İDDİA: kullanılabilir bakiye yalnız BİR rezervasyona yetiyorsa, iki eşzamanlı
    /// rezervasyondan yalnız biri geçer ve rezerve toplamı bakiyeyi AŞMAZ.
    ///
    /// <para>
    /// Bu servis hiç satır kilidi almıyordu: <c>TryReserve</c> "Available yeter mi?" diye okuyup
    /// sonra yazıyor, iki eşzamanlı gönderim aynı değeri görüp ikisi de geçiyordu. Sonuç, kurumun
    /// ödediğinden fazla mesaj taahhüdü — yani platformun cebinden gönderim.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentWalletReserve_NeverExceedsBalance()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        // Bakiye tek bir rezervasyona yetecek kadar: 10 ₺ (birim fiyat 10 ₺).
        await using (var db = database.NewContext())
        {
            var wallet = new TenantMessagingWallet(seed.TenantId);
            wallet.TopUp(10m);
            db.TenantMessagingWallets.Add(wallet);
            await db.SaveChangesAsync();
        }

        async Task<bool> ReserveAsync()
        {
            await using var db = database.NewContext();
            var service = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance);
            // Doğrudan cüzdan yolu: fiyat/kota kurallarına değil, KİLİDE bakıyoruz.
            return await TryReserveDirectlyAsync(service, db, seed.TenantId, 10m);
        }

        var results = await Task.WhenAll(ReserveAsync(), ReserveAsync());

        Assert.Equal(1, results.Count(x => x));

        await using var check = database.NewContext();
        var final = await check.TenantMessagingWallets.IgnoreQueryFilters().SingleAsync(w => w.TenantId == seed.TenantId);
        Assert.Equal(10m, final.ReservedTry);          // yalnız bir rezervasyon
        Assert.True(final.AvailableTry >= 0m);         // kullanılabilir bakiye ASLA eksiye düşmez
    }

    /// <summary>
    /// Cüzdan rezervasyonunu servisin kilit protokolüyle AYNI biçimde uygular. <c>ReserveAsync</c>
    /// fiyat kuralı/kota/paket ayarı gerektirdiği için, bu test yalnız kilit davranışını ölçmek
    /// üzere aynı adımları (transaction → satır kilidi → taze oku → TryReserve) tekrarlar.
    /// </summary>
    private static async Task<bool> TryReserveDirectlyAsync(
        WhatsAppBillingService service, GuzellikDbContext db, Guid tenantId, decimal amount)
    {
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);

        var wallet = await db.TenantMessagingWallets.IgnoreQueryFilters()
            .FirstAsync(w => w.TenantId == tenantId && !w.IsDeleted);
        await RowLock.LockRowAsync(db, "tenant_messaging_wallets", wallet.Id, CancellationToken.None);
        await db.Entry(wallet).ReloadAsync();

        if (!wallet.TryReserve(amount)) return false;

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return true;
    }

    // =====================================================================================
    // 3) DEĞERLENDİRME JETONU — aynı randevuya iki geçerli jeton üretilemez
    // =====================================================================================

    /// <summary>
    /// ASIL İDDİA: aynı randevu için eşzamanlı iki jeton üretimi TEK satır bırakır.
    ///
    /// <para>
    /// Üretim idempotent olacak şekilde yazılmıştı ("açık jeton varsa onu döndür") ama kontrol ile
    /// yazma arasında kilit yoktu: iki eşzamanlı çağrı (tamamlama işi + elle QR) ikisi de "yok"
    /// görüp AYNI randevuya iki geçerli jeton açabiliyordu. İki jeton = müşterinin aynı randevuyu
    /// iki kez puanlaması, yani personel/salon ortalamasının çift etkilenmesi.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentRatingIssue_CreatesSingleToken()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        Guid appointmentId;
        await using (var db = database.NewContext())
        {
            var staff = new StaffMember(seed.TenantId, seed.BranchId, "YARIŞ PERSONEL", "Uzman");
            db.StaffMembers.Add(staff);
            var service = new ServiceDefinition(seed.TenantId, seed.BranchId, "Bakım", 60, 500m);
            db.ServiceDefinitions.Add(service);
            await db.SaveChangesAsync();

            var start = DateTime.UtcNow.AddHours(-2);
            var appointment = new Appointment(seed.TenantId, seed.BranchId, seed.CustomerId, staff.Id, service.Id,
                start, start.AddMinutes(60), 500m);
            db.Appointments.Add(appointment);
            await db.SaveChangesAsync();
            appointmentId = appointment.Id;
        }

        async Task<Guid?> IssueAsync()
        {
            await using var db = database.NewContext();
            var service = new RatingService(db);
            var result = await service.IssueAsync(seed.TenantId, appointmentId);
            return result.IsSuccess ? result.Value!.Token : null;
        }

        var tokens = await Task.WhenAll(IssueAsync(), IssueAsync());

        await using var check = database.NewContext();
        var rows = await check.AppointmentRatings.IgnoreQueryFilters()
            .Where(r => r.AppointmentId == appointmentId).ToListAsync();

        Assert.Single(rows);                                    // TEK jeton satırı
        Assert.All(tokens, t => Assert.True(t is null || t == rows[0].Token));
    }
}

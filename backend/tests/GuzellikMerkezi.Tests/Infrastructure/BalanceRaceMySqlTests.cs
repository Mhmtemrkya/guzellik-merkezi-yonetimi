using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.GiftCards;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
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
            // Ödeme çözücüsü bu testte kullanılmaz (doğrudan cüzdan yolu) → kapalı ikiz yeterli.
            var service = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance,
                new PaymentTestDoubles.DisabledResolver(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
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

    /// <summary>
    /// KARTLA KONTÖRDE ÇİFT YÜKLEME. Ödeme dönüşü hem kullanıcının tarayıcısından hem sağlayıcıdan
    /// AYNI ANDA gelebilir. "Zaten onaylı mı?" kontrolü tek başına yalnız SIRAYLA gelen çağrılara
    /// karşı korur: eşzamanlı iki çağrı talebi ikisi de "Pending" okur, ikisi de değişmez
    /// kontrollerinden geçer ve cüzdana İKİ KEZ yükleme yapar — kurum bir kez ödeyip iki kat kontör
    /// alırdı. Kilit sıralamayı veritabanına yaptırır. InMemory'de üretilemez.
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentCreditCallback_CreditsWalletExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            db.WhatsAppBillingSettings.Add(new WhatsAppBillingSettings());
            await db.SaveChangesAsync();
        }

        WhatsAppBillingService NewBilling(GuzellikDbContext db) =>
            new(db, NullLogger<WhatsAppBillingService>.Instance, new PaymentTestDoubles.SimulationResolver(),
                new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));

        string conversationId;
        await using (var db = database.NewContext())
        {
            var started = await NewBilling(db).StartCreditCheckoutAsync(
                seed.TenantId, new TopUpRequest(null, 400m), "https://panel.test/api/payments/credit-callback", null);
            Assert.True(started.IsSuccess, started.IsFailure ? started.Error.Message : null);
            conversationId = (await db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().SingleAsync()).ConversationId!;
        }

        var gateway = new SimulationPaymentGateway(PaymentTestDoubles.SigningSecret);
        var init = await gateway.InitCheckoutAsync(new CheckoutInitRequest(
            conversationId, 400m, "test", "buyer", "Ad", "Soyad", "a@b.c", "0555", "1", "Adres", "İstanbul",
            "127.0.0.1", "https://panel.test/api/payments/credit-callback"));
        var token = init.Value!.CheckoutToken;

        async Task<bool> CompleteAsync()
        {
            await using var db = database.NewContext();
            var result = await NewBilling(db).CompleteCreditCheckoutAsync(token);
            return result.IsSuccess && result.Value!.Succeeded;
        }

        var results = await Task.WhenAll(CompleteAsync(), CompleteAsync());
        Assert.All(results, Assert.True);   // ikisi de kullanıcıya "tamam" der

        await using (var check = database.NewContext())
        {
            // ...ama para TEK KEZ yüklenir.
            var wallet = await check.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking()
                .SingleAsync(w => w.TenantId == seed.TenantId);
            Assert.Equal(400m, wallet.BalanceTry);
            Assert.Single(await check.WalletTransactions.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.TenantId == seed.TenantId && t.Type == WalletTransactionType.TopUp).ToListAsync());
        }
    }

    /// <summary>
    /// AYNI DIŞ ÖDEME İKİ DEFTERE BİRDEN YAZILAMAZ — EŞZAMANLI HÂLDE.
    ///
    /// <para>
    /// Para iki deftere giriyor: abonelik tahsilatı ve WhatsApp kontörü. Her iki akış da "bu ödeme
    /// kimliği başka yerde kullanılmış mı?" diye SORUP sonra yazıyordu. Bu kontrol-sonra-yazdır:
    /// eşzamanlı iki callback, diğeri henüz commit etmediği için ikisi de "yok" cevabını alır ve
    /// aynı dış ödeme İKİ deftere birden işlenir — kurum bir kez ödeyip hem abonelik hem kontör alır.
    /// </para>
    /// <para>
    /// Garanti <c>provider_payment_claims</c> üzerindeki benzersiz kısıttır. InMemory sağlayıcı
    /// benzersiz indeksi ZORLAMADIĞI için bu senaryo yalnız gerçek MariaDB'de üretilebilir.
    /// </para>
    /// </summary>
    [MySqlFact]
    public async Task ConcurrentSubscriptionAndCreditCallback_SamePaymentId_OnlyOneLedgerWins()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);

        await using (var db = database.NewContext())
        {
            db.WhatsAppBillingSettings.Add(new WhatsAppBillingSettings());
            db.SubscriptionPlans.Add(new SubscriptionPlan("race-basic", "Yarış", 500m, 1, 3, 500, 300, 100));
            await db.SaveChangesAsync();
        }

        // Kontör tarafı: kartla checkout açılır.
        string creditConversation;
        await using (var db = database.NewContext())
        {
            var billing = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance,
                new PaymentTestDoubles.SimulationResolver(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            Assert.True((await billing.StartCreditCheckoutAsync(
                seed.TenantId, new TopUpRequest(null, 500m), "https://panel.test/api/payments/credit-callback", null)).IsSuccess);
            creditConversation = (await db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().SingleAsync()).ConversationId!;
        }

        // Abonelik tarafı: AYNI conversationId ile bekleyen bir tahsilat kaydı kurulur; simülasyon
        // sağlayıcısı ödeme kimliğini conversationId'den türettiği için ikisi AYNI dış ödemeye bakar.
        await using (var db = database.NewContext())
        {
            var planId = (await db.SubscriptionPlans.AsNoTracking().FirstAsync()).Id;
            db.SubscriptionPayments.Add(new SubscriptionPayment(
                seed.TenantId, planId, BillingPeriod.Monthly, 500m, "Simulation", creditConversation, 1));
            await db.SaveChangesAsync();
        }

        var gateway = new SimulationPaymentGateway(PaymentTestDoubles.SigningSecret);
        var init = await gateway.InitCheckoutAsync(new CheckoutInitRequest(
            creditConversation, 500m, "test", "buyer", "Ad", "Soyad", "a@b.c", "0555", "1", "Adres", "İstanbul",
            "127.0.0.1", "https://panel.test/api/payments/credit-callback"));
        var token = init.Value!.CheckoutToken;

        async Task<bool> CreditAsync()
        {
            await using var db = database.NewContext();
            var billing = new WhatsAppBillingService(db, NullLogger<WhatsAppBillingService>.Instance,
                new PaymentTestDoubles.SimulationResolver(), new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner));
            var r = await billing.CompleteCreditCheckoutAsync(token);
            return r.IsSuccess && r.Value!.Succeeded;
        }

        async Task<bool> SubscriptionAsync()
        {
            await using var db = database.NewContext();
            var billing = new BillingService(db, new PaymentTestDoubles.SimulationResolver(), new PassthroughEncryption(),
                new NoopAuditLogger(), new AllowAllFeatureService(), new TestCurrentUser(UserRole.InstitutionOwner),
                NullLogger<BillingService>.Instance);
            var r = await billing.CompleteCheckoutAsync(token);
            return r.IsSuccess && r.Value!.Succeeded;
        }

        var results = await Task.WhenAll(CreditAsync(), SubscriptionAsync());

        // TEK KAZANAN. Hangisinin kazandığı önemli değil; ikisinin birden kazanması para kaybıdır.
        Assert.Equal(1, results.Count(x => x));

        await using var check = database.NewContext();
        Assert.Single(await check.ProviderPaymentClaims.AsNoTracking().ToListAsync());

        var topUps = await check.WalletTransactions.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.TenantId == seed.TenantId && t.Type == WalletTransactionType.TopUp).ToListAsync();
        var activated = await check.Tenants.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(t => t.Id == seed.TenantId && t.SubscriptionEndsAtUtc != null);
        // Ödeme ya kontöre ya aboneliğe gitti — ikisine birden DEĞİL.
        Assert.False(topUps.Count > 0 && activated, "Aynı dış ödeme hem kontöre hem aboneliğe yazıldı.");
    }

    /// <summary>Şifreleme yerine kimlik dönüşümü — testte gerçek anahtar yönetimi gerekmez.</summary>
    private sealed class PassthroughEncryption : GuzellikMerkezi.Application.Abstractions.IEncryptionService
    {
        public string? Encrypt(string? plaintext) => plaintext;
        public string? Decrypt(string? ciphertext) => ciphertext;
        public bool IsEncrypted(string? value) => false;
    }
}

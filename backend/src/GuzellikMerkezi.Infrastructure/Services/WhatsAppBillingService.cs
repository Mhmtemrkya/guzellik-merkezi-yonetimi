using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// MESAJ KREDİSİ faturalama motoru (WhatsApp + SMS ortak cüzdan). Tüm sorgular IgnoreQueryFilters +
/// explicit TenantId ile çalışır (arka plan işlerinde tenant kapsamı olmayabilir). Kredi maliyetleri
/// veritabanından çözülür: WhatsApp kategorileri <see cref="WhatsAppPricingRule"/>, SMS parçası
/// <see cref="WhatsAppBillingSettings.SmsCreditsPerPart"/>.
///
/// <para>
/// BİRİM: 12 Kas 2026'dan beri cüzdan ₺ değil KREDİ tutar (1 kredi = 1 WhatsApp hatırlatma).
/// Varlıklardaki <c>*Try</c> alanları dönüşüm öncesi donmuş geçmiştir; bu servis onları okumaz.
/// Kredi ile ₺ yalnız satın almada buluşur: paket/talep ₺ fiyat taşır, cüzdana kredi yüklenir.
/// </para>
/// </summary>
public sealed class WhatsAppBillingService : IWhatsAppBillingService
{
    private readonly GuzellikDbContext _db;
    private readonly ILogger<WhatsAppBillingService> _logger;
    private readonly IPaymentGatewayResolver _gateways;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;

    public WhatsAppBillingService(
        GuzellikDbContext db,
        ILogger<WhatsAppBillingService> logger,
        IPaymentGatewayResolver gateways,
        IAuditLogger audit,
        ICurrentUser currentUser)
    {
        _db = db;
        _logger = logger;
        _gateways = gateways;
        _audit = audit;
        _currentUser = currentUser;
    }

    private static DateTime MonthStart(DateTime now) => new(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

    // ==================== GÖNDERİM AKIŞI ====================

    public async Task<BillingDecision> ReserveAsync(Guid tenantId, WhatsAppMessageCategory category, bool live, CancellationToken ct = default)
    {
        // Simülasyon hiç ücretlendirilmez.
        if (!live) return BillingDecision.Free(category, WhatsAppBillingSource.Simulation);

        // Müşteri kaynaklı 24s serbest yanıt (Service) Meta'da ücretsiz.
        if (category == WhatsAppMessageCategory.Service) return BillingDecision.Free(category, WhatsAppBillingSource.Quota);

        var billing = await GetOrCreateBillingSettingsAsync(ct);
        if (!billing.BillingEnabled) return BillingDecision.Free(category, WhatsAppBillingSource.Quota); // pilot dönemi: ücretsiz

        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        var plan = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.SubscriptionPlan).FirstOrDefaultAsync(ct);

        var now = DateTime.UtcNow;
        var monthStart = MonthStart(now);

        var isMarketing = category == WhatsAppMessageCategory.Marketing;

        // Kampanya (Marketing) izni kapalıysa hiç gönderme (pahalı kategori istenmeden çalışmaz).
        if (isMarketing && settings is not { MarketingEnabled: true })
            return BillingDecision.Block(category, "Kampanya (Marketing) mesajları kapalı. WhatsApp ayarlarından açabilirsiniz.");

        // Bu ay ilgili kovada kotadan düşülmüş (ücretsiz) mesaj sayısı.
        var quotaBucket = isMarketing ? WhatsAppMessageCategory.Marketing : WhatsAppMessageCategory.Utility;
        var quotaUsed = await _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == tenantId && !m.IsDeleted
                          && m.Direction == WhatsAppMessageDirection.Outbound
                          && m.Category == quotaBucket
                          && m.BillingSource == WhatsAppBillingSource.Quota
                          && m.Status != WhatsAppMessageStatus.Failed
                          && m.CreatedAtUtc >= monthStart, ct);

        var quotaLimit = isMarketing ? (plan?.MaxMonthlyWhatsAppMarketing ?? 0) : (plan?.MaxMonthlyWhatsAppUtility ?? plan?.MaxMonthlyWhatsAppCount ?? 500);
        var quotaUnlimited = quotaLimit < 0;

        // 1) Pakete dahil kota müsaitse ücretsiz gönder.
        if (quotaUnlimited || quotaUsed < quotaLimit)
            return BillingDecision.Free(category, WhatsAppBillingSource.Quota);

        // 2) Kota doldu → mesaj kredisinden devam (yalnız izin varsa).
        if (!isMarketing && settings is not { AllowWalletOverage: true })
            return BillingDecision.Block(category,
                $"Aylık WhatsApp kotanız doldu ({quotaUsed}/{quotaLimit}). Kota bitince mesaj kredisinden devam etmeyi açın ya da üst pakete geçin.");

        // 0 maliyet "ücretsiz" DEĞİL "tanımsız" sayılır: yanlış girilmiş bir kural kotası biten
        // kurumu sınırsız ücretsiz gönderime açmasın.
        var cost = await GetCreditCostAsync(category, now, ct);
        if (cost is null or <= 0)
            return BillingDecision.Block(category, "WhatsApp kredi maliyeti tanımlı değil. Lütfen platform yöneticinizle iletişime geçin.");

        // 3) Aylık harcama tavanı (sürpriz harcama freni) — WhatsApp + SMS toplamı.
        var cap = ResolveSpendCap(settings, plan, billing);
        if (cap.HasValue)
        {
            var committed = await MonthlyWalletCommittedAsync(tenantId, monthStart, CreditChannel.WhatsApp, ct);
            if (committed + cost.Value > cap.Value)
                return BillingDecision.Block(category,
                    $"Aylık kredi harcama tavanına ulaşıldı ({FormatCredits(cap.Value)} kredi). Tavanı yükseltin ya da sonraki ayı bekleyin.");
        }

        // 4) Kredi rezervasyonu — KİLİT ALTINDA.
        //
        // "Yeter mi?" kontrolü ile rezervasyonun yazılması tek bir atomik adım olmalı: aksi hâlde
        // iki eşzamanlı gönderim aynı bakiyeyi görüp ikisi de geçiyor ve kullanılabilir bakiye
        // eksiye düşüyordu. Rezervasyon BURADA kalıcı yapılır; çağıran (DispatchAsync) mesaj
        // satırını yazana kadar kredi gerçekten ayrılmış olmalı.
        return await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(tenantId, ct);
            if (!wallet.TryReserve(CreditChannel.WhatsApp, cost.Value))
            {
                return BillingDecision.Block(category,
                    $"WhatsApp krediniz yetersiz (gerekli {FormatCredits(cost.Value)}, kullanılabilir {FormatCredits(wallet.AvailableFor(CreditChannel.WhatsApp))} kredi). Kredi yükleyin.");
            }

            await _db.SaveChangesAsync(ct);
            return BillingDecision.Charged(category, cost.Value);
        }, ct);
    }

    public Task RefundInlineAsync(Guid tenantId, WhatsAppMessage message, CancellationToken ct = default)
    {
        // Gönderim anında başarısızlık: rezervasyonu geri al ama SaveChanges'i çağırana bırak.
        return ReverseReservationAsync(message, save: false, ct);
    }

    public async Task CaptureAsync(WhatsAppMessage message, CancellationToken ct = default)
    {
        if (message.BillingSource != WhatsAppBillingSource.Wallet || message.ChargedCredits <= 0) return;

        await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(message.TenantId, ct);
            wallet.Capture(CreditChannel.WhatsApp, message.ChargedCredits);
            _db.WalletTransactions.Add(new WalletTransaction(
                message.TenantId, WalletTransactionType.Capture, -message.ChargedCredits,
                wallet.BalanceCredits, wallet.ReservedCredits,
                description: $"WhatsApp {CategoryLabel(message.Category)} teslim edildi", category: message.Category,
                whatsAppMessageId: message.Id, channel: NotificationChannel.WhatsApp));
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);
    }

    public Task RefundAsync(WhatsAppMessage message, CancellationToken ct = default)
        => ReverseReservationAsync(message, save: true, ct);

    /// <summary>
    /// Rezervasyonu geri verir. <paramref name="save"/> false ise yazma ÇAĞIRANA aittir: gönderim
    /// anındaki iade, mesaj satırının güncellenmesiyle AYNI kayıtta kalmalıdır (bkz. RefundInlineAsync).
    /// </summary>
    private async Task ReverseReservationAsync(WhatsAppMessage message, bool save, CancellationToken ct)
    {
        if (message.BillingSource != WhatsAppBillingSource.Wallet || message.ChargedCredits <= 0) return;

        var amount = message.ChargedCredits;

        // Çağıran yazmayı üstlendiğinde transaction da onundur; burada ayrı bir transaction açmak
        // iadeyi asıl kayıttan koparırdı.
        if (!save)
        {
            var inlineWallet = await GetOrCreateWalletAsync(message.TenantId, ct);
            inlineWallet.Refund(CreditChannel.WhatsApp, amount);
            message.ClearCharge(); // tekrar iade edilmesin + aylık taahhüt sayımından düşsün
            return;
        }

        await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(message.TenantId, ct);
            wallet.Refund(CreditChannel.WhatsApp, amount);
            message.ClearCharge();
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);
    }

    public async Task<int> SweepStaleReservationsAsync(TimeSpan olderThan, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow - olderThan;
        // Kredi rezerve edilmiş, henüz teslim/başarısız işlenmemiş ve süresi geçmiş mesajlar.
        var stale = await _db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(m => !m.IsDeleted
                     && m.BillingSource == WhatsAppBillingSource.Wallet
                     && m.ChargedCredits > 0
                     && m.DeliveredAtUtc == null
                     && m.Status != WhatsAppMessageStatus.Failed
                     && m.CreatedAtUtc <= cutoff)
            .Take(200)
            .ToListAsync(ct);
        if (stale.Count == 0) return 0;

        // HER MESAJ KENDİ TRANSACTION'INDA İADE EDİLİR — hepsi tek transaction'da DEĞİL.
        //
        // Değişmez mesaj başınadır: "cüzdanın iadesi ile o mesajın ücret kaydının silinmesi birlikte
        // olur". Tek bir transaction 200 satırı kapsasaydı 200 AYRI kurumun cüzdan kilidi aynı anda
        // ve GELİŞİGÜZEL SIRAYLA tutulurdu: ortak protokolün deadlock önlemi kilitlerin her zaman
        // aynı sırada alınmasına dayanır (bkz. RowLock), üstelik süpürge sürerken o kurumların
        // gönderimleri de beklerdi. Bir mesajın iadesi başarısız olursa yalnız o atlanır; kalanlar
        // iade edilir ve bir sonraki turda yeniden denenir.
        var refunded = 0;
        foreach (var m in stale)
        {
            try
            {
                await InWalletTransactionAsync(async () =>
                {
                    var wallet = await GetOrCreateWalletAsync(m.TenantId, ct);
                    wallet.Refund(CreditChannel.WhatsApp, m.ChargedCredits);
                    m.ClearCharge();
                    await _db.SaveChangesAsync(ct);
                    return true;
                }, ct);
                refunded++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Bayat WhatsApp rezervasyonu iade edilemedi (mesaj {MessageId}); sonraki turda yeniden denenecek.", m.Id);
            }
        }

        if (refunded > 0)
            _logger.LogInformation("{Count} WhatsApp rezervasyonu teslim onayı gelmediği için iade edildi.", refunded);
        return refunded;
    }

    // ==================== SMS GÖNDERİM AKIŞI ====================
    //
    // SMS'in teslim webhook'u yok. Kural WhatsApp'la aynıdır ("başarısız mesaja kredi harcanmaz")
    // ama döngü TEK ÇAĞRIDA kapanır: rezerve → gönder → sağlayıcı kabul ettiyse kesinleştir,
    // reddettiyse iade. Rezervasyon NotificationLog satırına bağlanır: süreç arada çökerse
    // süpürme hangi kredinin askıda kaldığını o satırdan bulur.
    //
    // Ücret PlatformMessagingService.SendSmsAsync'te DEĞİL burada kesilir: o metottan müşteri giriş
    // kodu ve kurum kaydı doğrulaması da geçer; onlar platformun maliyetidir, kuruma yansımaz.

    public async Task<SmsBillingDecision> ReserveSmsAsync(Guid tenantId, NotificationLog log, int parts, bool live, CancellationToken ct = default)
    {
        parts = Math.Max(1, parts);

        // DEVRALINAN SATIR: bayat bir gönderim devralındıysa kararı zaten bağlıdır. Yeniden rezerve
        // etmek aynı mesaj için iki kat kredi ayırırdı; kotadan sayılmışsa ikinci kez sayılmaz.
        if (log.BillingSource == WhatsAppBillingSource.Wallet && log.ChargedCredits > 0 && log.ChargeCapturedAtUtc is null)
            return SmsBillingDecision.Charged(log.ChargedCredits, log.SmsParts > 0 ? log.SmsParts : parts);
        if (log.BillingSource == WhatsAppBillingSource.Quota)
            return SmsBillingDecision.Free(WhatsAppBillingSource.Quota, log.SmsParts > 0 ? log.SmsParts : parts);
        // Kurumun kendi hesabına bağlanmış satır o hesaptan devam eder. Bağlantı bu arada kaldırıldıysa
        // gönderim başarısız yazılır — platforma DÜŞÜLMEZ (sürpriz kredi harcaması / çift gönderim olmasın).
        if (log.BillingSource == WhatsAppBillingSource.OwnAccount)
            return SmsBillingDecision.Free(WhatsAppBillingSource.OwnAccount, log.SmsParts > 0 ? log.SmsParts : parts);

        // KURUMUN KENDİ SMS HESABI: kota ve kredi DÜŞMEZ, ücreti kurumun sağlayıcısı keser. Karar satıra
        // yazılır; gönderim yolu (kendi hesap / platform) bu satırdan okunur, ikinci bir sorgudan değil.
        if (await IsOwnSmsAccountActiveAsync(tenantId, ct))
        {
            log.AttachCharge(WhatsAppBillingSource.OwnAccount, 0m, parts);
            return SmsBillingDecision.Free(WhatsAppBillingSource.OwnAccount, parts);
        }

        // SİMÜLASYON TESLİMAT DEĞİLDİR: ne kota ne kredi düşer (gönderim zaten "başarısız" yazılır).
        if (!live)
        {
            log.AttachCharge(WhatsAppBillingSource.Simulation, 0m, parts);
            return SmsBillingDecision.Free(WhatsAppBillingSource.Simulation, parts);
        }

        var billing = await GetOrCreateBillingSettingsAsync(ct);
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        var plan = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.SubscriptionPlan).FirstOrDefaultAsync(ct);
        var monthStart = MonthStart(DateTime.UtcNow);

        // 1) Pakete dahil aylık SMS kotası (−1 sınırsız, 0 kapalı).
        //    Veritabanı sayımına bu bağlamda kotadan sayılmış ama HENÜZ YAZILMAMIŞ satırlar eklenir
        //    (bkz. PendingQuotaSmsInTracker) — yoksa elle toplu gönderimde kota sessizce aşılırdı.
        var quotaUsed = await CountSmsQuotaUsedAsync(tenantId, monthStart, ct) + PendingQuotaSmsInTracker(tenantId);
        var quotaLimit = plan?.MaxMonthlySmsCount ?? 0;
        if (quotaLimit < 0 || quotaUsed < quotaLimit)
        {
            log.AttachCharge(WhatsAppBillingSource.Quota, 0m, parts);
            return SmsBillingDecision.Free(WhatsAppBillingSource.Quota, parts);
        }

        // 2) Kota doldu. Pilot dönemde (faturalama kapalı) kredi düşülmez; kota eskisi gibi sınırlar.
        if (!billing.BillingEnabled)
            return SmsBillingDecision.Block($"Aylık SMS kotanız doldu ({quotaUsed}/{quotaLimit}).", parts);

        if (settings is not { AllowWalletOverage: true })
            return SmsBillingDecision.Block(
                $"Aylık SMS kotanız doldu ({quotaUsed}/{quotaLimit}). Kota bitince mesaj kredisinden devam etmeyi açın ya da üst pakete geçin.",
                parts);

        // 0 maliyet "ücretsiz" DEĞİL "tanımsız" sayılır (WhatsApp kuralıyla aynı gerekçe).
        var credits = decimal.Round(parts * billing.SmsCreditsPerPart, 2);
        if (credits <= 0)
            return SmsBillingDecision.Block("SMS kredi maliyeti tanımlı değil. Lütfen platform yöneticinizle iletişime geçin.", parts);

        // 3) Aylık harcama tavanı — WhatsApp + SMS toplamı.
        var cap = ResolveSpendCap(settings, plan, billing);
        if (cap.HasValue)
        {
            var committed = await MonthlyWalletCommittedAsync(tenantId, monthStart, CreditChannel.Sms, ct);
            if (committed + credits > cap.Value)
                return SmsBillingDecision.Block(
                    $"Aylık kredi harcama tavanına ulaşıldı ({FormatCredits(cap.Value)} kredi). Tavanı yükseltin ya da sonraki ayı bekleyin.",
                    parts);
        }

        // 4) Kredi rezervasyonu — KİLİT ALTINDA, satırla AYNI kayıtta.
        //
        // Cüzdan ile satır ayrı kayıtlarda yazılsaydı arada çöken süreç ya krediyi izsiz askıda
        // bırakırdı (satırda ücret yok, süpürme bulamaz) ya da satırı ücretli gösterip krediyi hiç
        // ayırmamış olurdu (sonuçlandırma olmayan rezervasyonu düşerdi).
        return await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(tenantId, ct);
            if (!wallet.TryReserve(CreditChannel.Sms, credits))
            {
                return SmsBillingDecision.Block(
                    $"SMS krediniz yetersiz (gerekli {FormatCredits(credits)}, kullanılabilir {FormatCredits(wallet.AvailableFor(CreditChannel.Sms))} kredi). Kredi yükleyin.",
                    parts);
            }

            log.AttachCharge(WhatsAppBillingSource.Wallet, credits, parts);
            await _db.SaveChangesAsync(ct);
            return SmsBillingDecision.Charged(credits, parts);
        }, ct);
    }

    public async Task SettleSmsAsync(NotificationLog log, bool accepted, CancellationToken ct = default)
    {
        if (log.BillingSource != WhatsAppBillingSource.Wallet || log.ChargedCredits <= 0 || log.ChargeCapturedAtUtc is not null) return;

        await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(log.TenantId, ct);

            // KİLİT ALTINDA TAZE KONTROL. Satırın krediyi hâlâ taşıdığı veritabanından sorulur:
            // süpürme (başka bir örnekte) satırı çoktan kapattıysa ikinci bir kesinleştirme/iade
            // bakiyeyi bozardı. İzleyicideki nesne YENİDEN YÜKLENMEZ — çağıranın işaretlediği gönderim
            // durumu bu kayıtta yazılacak; yalnız ücret alanları veritabanıyla eşitlenir ki bayat
            // bellek değeri kapatılmış ücreti geri yazmasın (aksi hâlde sonraki süpürme İKİNCİ kez iade ederdi).
            var fresh = await _db.NotificationLogs.IgnoreQueryFilters().AsNoTracking()
                .Where(l => l.Id == log.Id)
                .Select(l => new { l.BillingSource, l.ChargedCredits, l.ChargeCapturedAtUtc })
                .FirstOrDefaultAsync(ct);
            if (fresh is not null
                && (fresh.BillingSource != WhatsAppBillingSource.Wallet || fresh.ChargedCredits <= 0 || fresh.ChargeCapturedAtUtc is not null))
            {
                if (fresh.ChargeCapturedAtUtc is { } capturedAt) log.MarkChargeCaptured(capturedAt);
                else log.ClearCharge();
                await _db.SaveChangesAsync(ct);
                return false;
            }

            if (accepted)
            {
                wallet.Capture(CreditChannel.Sms, log.ChargedCredits);
                _db.WalletTransactions.Add(new WalletTransaction(
                    log.TenantId, WalletTransactionType.Capture, -log.ChargedCredits,
                    wallet.BalanceFor(CreditChannel.Sms), wallet.ReservedFor(CreditChannel.Sms),
                    description: $"SMS gönderildi ({log.SmsParts} parça)",
                    channel: NotificationChannel.Sms, notificationLogId: log.Id));
                log.MarkChargeCaptured(DateTime.UtcNow);
            }
            else
            {
                wallet.Refund(CreditChannel.Sms, log.ChargedCredits);
                log.ClearCharge();
            }

            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);
    }

    public async Task<int> SweepStaleSmsReservationsAsync(TimeSpan olderThan, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow - olderThan;
        var candidates = await _db.NotificationLogs.IgnoreQueryFilters().AsNoTracking()
            .Where(l => !l.IsDeleted
                     && l.BillingSource == WhatsAppBillingSource.Wallet
                     && l.ChargedCredits > 0
                     && l.ChargeCapturedAtUtc == null
                     && (l.UpdatedAtUtc ?? l.CreatedAtUtc) <= cutoff)
            .Select(l => new { l.Id, l.TenantId })
            .Take(200)
            .ToListAsync(ct);
        if (candidates.Count == 0) return 0;

        // Her satır KENDİ transaction'ında (WhatsApp süpürmesiyle aynı gerekçe: kurumların cüzdan
        // kilitleri gelişigüzel sırayla toplu tutulmaz, bir satırın hatası diğerlerini durdurmaz).
        var settled = 0;
        foreach (var candidate in candidates)
        {
            try
            {
                var done = await InWalletTransactionAsync(async () =>
                {
                    var wallet = await GetOrCreateWalletAsync(candidate.TenantId, ct);

                    // Kilit ALTINDA taze oku: eşzamanlı bir süpürme ya da gecikmiş sonuçlandırma
                    // satırı çoktan kapatmış olabilir.
                    var log = await _db.NotificationLogs.IgnoreQueryFilters().FirstOrDefaultAsync(l => l.Id == candidate.Id, ct);
                    if (log is null) return false;
                    await _db.Entry(log).ReloadAsync(ct);
                    if (log.BillingSource != WhatsAppBillingSource.Wallet || log.ChargedCredits <= 0 || log.ChargeCapturedAtUtc is not null)
                        return false;

                    if (log.Status == NotificationLogStatus.Sent)
                    {
                        // Sağlayıcı kabul etti ama kesinleşme yazılamadan süreç çöktü.
                        wallet.Capture(CreditChannel.Sms, log.ChargedCredits);
                        _db.WalletTransactions.Add(new WalletTransaction(
                            log.TenantId, WalletTransactionType.Capture, -log.ChargedCredits,
                            wallet.BalanceFor(CreditChannel.Sms), wallet.ReservedFor(CreditChannel.Sms),
                            description: $"SMS gönderildi ({log.SmsParts} parça) — gecikmeli kesinleşme",
                            channel: NotificationChannel.Sms, notificationLogId: log.Id));
                        log.MarkChargeCaptured(DateTime.UtcNow);
                    }
                    else
                    {
                        // Gönderilemeyen ya da sonucu DOĞRULANAMAYAN SMS: kredi kurumdan yana iade
                        // edilir. Satır yeniden devralınıp gönderilirse rezervasyon baştan yapılır.
                        wallet.Refund(CreditChannel.Sms, log.ChargedCredits);
                        log.ClearCharge();
                    }

                    await _db.SaveChangesAsync(ct);
                    return true;
                }, ct);
                if (done) settled++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Askıda kalan SMS kredisi kapatılamadı (bildirim {LogId}); sonraki turda yeniden denenecek.", candidate.Id);
            }
        }

        if (settled > 0)
            _logger.LogInformation("{Count} askıda kalan SMS kredisi sonuçlandırıldı.", settled);
        return settled;
    }

    public async Task<string?> SmsAvailabilityBlockReasonAsync(Guid tenantId, CancellationToken ct = default)
    {
        // Kendi SMS hesabıyla gönderen kurumun kotası/kredisi sorulmaz: ücreti kendi sağlayıcısı keser.
        // (Kotası dolmuş, kredi taşması kapalı kurum burada engellenseydi kendi parasıyla da gönderemezdi.)
        if (await IsOwnSmsAccountActiveAsync(tenantId, ct)) return null;

        // Simülasyonda engel yok: satırlar tek tek "sağlayıcı yapılandırılmamış" diye kapanır.
        if (!await IsSmsLiveAsync(ct)) return null;

        var billing = await GetOrCreateBillingSettingsAsync(ct);
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        var plan = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.SubscriptionPlan).FirstOrDefaultAsync(ct);
        var monthStart = MonthStart(DateTime.UtcNow);

        var quotaUsed = await CountSmsQuotaUsedAsync(tenantId, monthStart, ct);
        var quotaLimit = plan?.MaxMonthlySmsCount ?? 0;
        if (quotaLimit < 0 || quotaUsed < quotaLimit) return null;

        if (!billing.BillingEnabled)
            return $"Aylık SMS kotanız doldu ({quotaUsed}/{quotaLimit}).";
        if (settings is not { AllowWalletOverage: true })
            return $"Aylık SMS kotanız doldu ({quotaUsed}/{quotaLimit}). Kota bitince mesaj kredisinden devam etmeyi açın ya da üst pakete geçin.";
        if (billing.SmsCreditsPerPart <= 0)
            return "SMS kredi maliyeti tanımlı değil. Lütfen platform yöneticinizle iletişime geçin.";

        var wallet = await _db.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(w => w.TenantId == tenantId && !w.IsDeleted, ct);
        var available = wallet?.AvailableFor(CreditChannel.Sms) ?? 0m;
        if (available < billing.SmsCreditsPerPart)
            return $"SMS krediniz yetersiz (kullanılabilir {FormatCredits(available)} kredi; bir SMS en az {FormatCredits(billing.SmsCreditsPerPart)} kredi). Kredi yükleyin.";

        var cap = ResolveSpendCap(settings, plan, billing);
        if (cap.HasValue && await MonthlyWalletCommittedAsync(tenantId, monthStart, CreditChannel.Sms, ct) + billing.SmsCreditsPerPart > cap.Value)
            return $"Aylık kredi harcama tavanına ulaşıldı ({FormatCredits(cap.Value)} kredi). Tavanı yükseltin ya da sonraki ayı bekleyin.";

        return null;
    }

    public async Task<MessagingCostEstimate> EstimateCostAsync(Guid tenantId, NotificationChannel channel, bool marketing,
        IReadOnlyList<int> unitsPerMessage, CancellationToken ct = default)
    {
        var count = unitsPerMessage.Count;
        var warnings = new List<string>();
        var monthStart = MonthStart(DateTime.UtcNow);
        var billing = await GetOrCreateBillingSettingsAsync(ct);
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        var plan = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.SubscriptionPlan).FirstOrDefaultAsync(ct);
        var wallet = await _db.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(w => w.TenantId == tenantId && !w.IsDeleted, ct);
        var creditChannel = channel == NotificationChannel.Sms ? CreditChannel.Sms : CreditChannel.WhatsApp;
        var available = wallet?.AvailableFor(creditChannel) ?? 0m;

        // ---- E-POSTA: krediden düşmez, yalnız plan e-posta kotası ----
        if (channel == NotificationChannel.Email)
        {
            var emailLimit = plan?.MaxMonthlyEmailCount ?? 0;
            var emailUsed = await _db.NotificationLogs.IgnoreQueryFilters().AsNoTracking()
                .CountAsync(l => l.TenantId == tenantId && !l.IsDeleted && l.Channel == NotificationChannel.Email
                              && l.Status == NotificationLogStatus.Sent && l.CreatedAtUtc >= monthStart, ct);
            var emailRemaining = emailLimit < 0 ? int.MaxValue : Math.Max(0, emailLimit - emailUsed);
            var emailCovered = Math.Min(count, emailRemaining);
            if (emailCovered < count)
                warnings.Add($"Aylık e-posta kotanız {emailCovered} mesajı karşılıyor; kalan {count - emailCovered} mesaj gönderilmez.");
            var platform = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
            var emailLive = platform is { EmailEnabled: true } && platform.EmailConfigured;
            if (!emailLive) warnings.Insert(0, "E-posta sağlayıcısı henüz bağlı değil (simülasyon) — mesajlar gerçekten gönderilmez.");
            return new MessagingCostEstimate(emailLimit < 0 ? -1 : emailRemaining, emailCovered, 0, 0m, available, 0m,
                emailLive ? emailCovered : 0, emailLive, warnings);
        }

        // ---- SMS / WhatsApp: önce plan kotası, sonra (izin varsa) kredi ----
        int quotaLimit, quotaUsed;
        decimal costPerUnit;
        bool live;
        var overageAllowed = settings is { AllowWalletOverage: true };

        // KENDİ SMS HESABI: gönderimdeki kuralla aynı — kota/kredi hiç sorulmaz, hepsi gider.
        // Uyarı eklenmez: bu iyi haber, istemci OwnAccount bayrağından kendi notunu gösterir.
        if (channel == NotificationChannel.Sms && await IsOwnSmsAccountActiveAsync(tenantId, ct))
            return new MessagingCostEstimate(-1, 0, 0, 0m, available, 0m, count, true, warnings, OwnAccount: true);

        if (channel == NotificationChannel.Sms)
        {
            live = await IsSmsLiveAsync(ct);
            quotaLimit = plan?.MaxMonthlySmsCount ?? 0;
            quotaUsed = await CountSmsQuotaUsedAsync(tenantId, monthStart, ct);
            costPerUnit = billing.SmsCreditsPerPart;
        }
        else
        {
            var category = marketing ? WhatsAppMessageCategory.Marketing : WhatsAppMessageCategory.Utility;
            live = settings?.IsConnected == true;
            quotaLimit = marketing ? (plan?.MaxMonthlyWhatsAppMarketing ?? 0) : (plan?.MaxMonthlyWhatsAppUtility ?? plan?.MaxMonthlyWhatsAppCount ?? 500);
            quotaUsed = await CountQuotaUsedAsync(tenantId, category, monthStart, ct);
            costPerUnit = await GetCreditCostAsync(category, DateTime.UtcNow, ct) ?? 0m;
            // Kampanya kategorisi kota taşma iznine değil, kampanya iznine bağlıdır (gönderimdeki kural).
            if (marketing) overageAllowed = true;

            if (marketing && settings is not { MarketingEnabled: true })
            {
                warnings.Add("WhatsApp kampanya mesajları kapalı — Ayarlar > WhatsApp'tan açılmadan bu şablon gönderilmez.");
                return new MessagingCostEstimate(-1, 0, 0, 0m, available, costPerUnit, 0, live, warnings);
            }
            warnings.Add("WhatsApp'ta serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir (Meta kuralı). Toplu duyuru için SMS daha güvenlidir.");
        }

        var remaining = quotaLimit < 0 ? int.MaxValue : Math.Max(0, quotaLimit - quotaUsed);
        var covered = Math.Min(count, remaining);
        var creditUnits = unitsPerMessage.Skip(covered).ToList();
        var creditMessages = creditUnits.Count;
        var creditsNeeded = decimal.Round(creditUnits.Sum() * costPerUnit, 2);
        var expected = covered;

        if (creditMessages > 0)
        {
            if (!billing.BillingEnabled)
                warnings.Add($"Plan kotanız {covered} mesajı karşılıyor; kalan {creditMessages} mesaj kota dolduğu için gönderilmez.");
            else if (!overageAllowed)
                warnings.Add($"Plan kotanız {covered} mesajı karşılıyor; kalan {creditMessages} mesaj için \"kota bitince mesaj kredisinden devam et\" kapalı — gönderilmez.");
            else if (costPerUnit <= 0)
                warnings.Add("Kredi maliyeti tanımlı değil — kota dışındaki mesajlar gönderilmez.");
            else
            {
                // Kaç mesajın parası yeter? Bakiye ile ayın kalan tavanından küçüğü bütçedir;
                // mesajlar gönderim sırasıyla tek tek düşülür (gönderimdeki davranış).
                var budget = available;
                var cap = ResolveSpendCap(settings, plan, billing);
                var capLeft = decimal.MaxValue;
                if (cap.HasValue)
                {
                    capLeft = Math.Max(0m, cap.Value - await MonthlyWalletCommittedAsync(tenantId, monthStart, creditChannel, ct));
                    budget = Math.Min(budget, capLeft);
                }

                var affordable = 0;
                var spent = 0m;
                foreach (var units in creditUnits)
                {
                    var cost = units * costPerUnit;
                    if (spent + cost > budget) break;
                    spent += cost;
                    affordable++;
                }
                expected += affordable;

                var short_ = creditMessages - affordable;
                if (short_ > 0)
                {
                    warnings.Add(capLeft < available
                        ? $"Aylık kredi harcama tavanına takılıyor: {short_} mesaj gönderilmez. Tavanı yükseltebilirsiniz."
                        : $"Mesaj krediniz yetersiz: {FormatCredits(creditsNeeded)} kredi gerekli, {FormatCredits(available)} kullanılabilir. {short_} mesaj gönderilmez.");
                }
            }
        }

        if (!live)
        {
            warnings.Insert(0, channel == NotificationChannel.Sms
                ? "SMS sağlayıcısı henüz bağlı değil (simülasyon) — mesajlar gerçekten gönderilmez, kota ve kredi düşmez."
                : "WhatsApp numaranız henüz bağlı değil — mesajlar gönderilmez, kota ve kredi düşmez.");
            expected = 0;
        }

        return new MessagingCostEstimate(quotaLimit < 0 ? -1 : remaining, covered, creditMessages, creditsNeeded,
            available, costPerUnit, expected, live, warnings);
    }

    public async Task<bool> IsSmsLiveAsync(CancellationToken ct = default)
    {
        var s = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (s is null || !s.SmsEnabled || !s.SmsConfigured) return false;
        // PlatformMessagingService.SendSmsAsync ile AYNI kural: tanınmayan sağlayıcı simülasyona düşer.
        return (s.SmsProvider ?? string.Empty).ToLowerInvariant() is "verimor" or "netgsm" or "twilio";
    }

    public async Task<bool> IsSmsLiveForTenantAsync(Guid tenantId, CancellationToken ct = default)
        => await IsOwnSmsAccountActiveAsync(tenantId, ct) || await IsSmsLiveAsync(ct);

    /// <summary>Kendi SMS hesabı sorgusunun kısa ömürlü önbelleği (kurum → (etkin mi, ne zaman okundu)).</summary>
    private readonly Dictionary<Guid, (bool Active, DateTime ReadAtUtc)> _ownSmsActive = new();

    /// <summary>
    /// Önbellek ömrü. Toplu gönderimde alıcı başına sorgu atılmasın diye kısa süre tutulur; uzun
    /// yaşayan bir arka plan kapsamında da bağlantı değişikliği en geç bu süre sonra görülür.
    /// </summary>
    private static readonly TimeSpan OwnSmsCacheTtl = TimeSpan.FromSeconds(30);

    public async Task<bool> IsOwnSmsAccountActiveAsync(Guid tenantId, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        if (_ownSmsActive.TryGetValue(tenantId, out var cached) && now - cached.ReadAtUtc < OwnSmsCacheTtl)
            return cached.Active;

        // FİLTRE AŞILIR, TenantId AÇIKÇA SÜZÜLÜR. Otomatik hatırlatmalar arka plan işlerinden kurum
        // kapsamı olmadan çalışır; filtreli DbSet orada hiçbir şey bulmaz ve kendi hesabını bağlamış
        // kurumun her otomatik SMS'i sessizce platformdan (krediden) giderdi.
        var active = await _db.TenantSmsConnections.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(c => c.TenantId == tenantId && !c.IsDeleted && c.Enabled && c.VerifiedAtUtc != null, ct);
        _ownSmsActive[tenantId] = (active, now);
        return active;
    }

    // ==================== KURUM CÜZDANI ====================

    public async Task<Result<MessagingWalletDto>> GetWalletAsync(Guid tenantId, CancellationToken ct = default)
        => Result<MessagingWalletDto>.Success(await BuildWalletDtoAsync(tenantId, ct));

    /// <summary>
    /// Talebin fiyat/kredi/ad üçlüsünü çözer. Havale ve kart yolları AYNI kaynağı kullanmalı:
    /// ikisi ayrı hesaplasaydı, kartla ödenen tutar ile cüzdana yüklenen kredi birbirinden
    /// kayabilirdi (paket fiyatı değiştiğinde sessizce).
    /// </summary>
    private sealed record TopUpResolution(decimal Price, decimal Grants, string Name, Guid? PackageId, CreditChannel Channel);

    private async Task<Result<TopUpResolution>> ResolveTopUpAsync(TopUpRequest request, CancellationToken ct)
    {
        if (request.CreditPackageId is { } pkgId)
        {
            var pkg = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == pkgId && !p.IsDeleted, ct);
            if (pkg is null || !pkg.IsActive)
                return Result<TopUpResolution>.Failure(Error.NotFound("Kredi paketi bulunamadı."));
            // SMS ve WhatsApp kredisi ayrı (18 Kas 2026): istenen kanal paketinkiyle çelişirse yükleme yapılmaz.
            if (request.Channel is { } wanted && wanted != pkg.Channel)
                return Result<TopUpResolution>.Failure(Error.Validation($"Bu paket {pkg.Channel.Label()} paketi; seçtiğiniz kredi türüyle uyuşmuyor."));
            return Result<TopUpResolution>.Success(new(pkg.PriceTry, pkg.GrantsCredits, pkg.Name, pkg.Id, pkg.Channel));
        }

        // PAKET DIŞI MİKTAR: kurum kredi sayısını yazar, fiyatı SUNUCU belirler (kanalın kredi birim fiyatı).
        // İstemciden gelen bir ₺ tutarına güvenilseydi fiyat-kredi oranını kurum seçerdi. Kanal gönderilmezse
        // WhatsApp (ayrımdan önceki istemciler).
        if (request.Credits is { } requested && requested > 0)
        {
            var credits = decimal.Round(requested, 0, MidpointRounding.AwayFromZero);
            if (credits < 1)
                return Result<TopUpResolution>.Failure(Error.Validation("En az 1 kredi girin."));
            var channel = request.Channel ?? CreditChannel.WhatsApp;
            var billing = await GetOrCreateBillingSettingsAsync(ct);
            var unit = channel == CreditChannel.Sms ? billing.SmsCreditUnitPriceTry : billing.CreditUnitPriceTry;
            var price = decimal.Round(credits * unit, 2, MidpointRounding.AwayFromZero);
            return Result<TopUpResolution>.Success(new(price, credits, $"Özel {channel.Label()} ({FormatCredits(credits)})", null, channel));
        }

        return Result<TopUpResolution>.Failure(Error.Validation("Paket seçin veya kredi miktarı girin."));
    }

    public async Task<Result<CreditPurchaseDto>> RequestPurchaseAsync(Guid tenantId, TopUpRequest request, Guid? requestedByUserId, CancellationToken ct = default)
    {
        var resolved = await ResolveTopUpAsync(request, ct);
        if (resolved.IsFailure) return Result<CreditPurchaseDto>.Failure(resolved.Error);
        var (price, grants, name, packageId, channel) = resolved.Value;

        var purchase = new WhatsAppCreditPurchase(tenantId, packageId, name, price, grants, requestedByUserId, channel);
        _db.WhatsAppCreditPurchases.Add(purchase);

        // Otomatik onay açıksa (ör. ödeme ağ geçidi bağlıysa) hemen bakiyeye yansıt.
        var billing = await GetOrCreateBillingSettingsAsync(ct);
        await InWalletTransactionAsync(async () =>
        {
            if (billing.AutoApproveTopUps)
            {
                purchase.Approve(requestedByUserId);
                await CreditWalletAsync(tenantId, channel, grants, $"Kredi: {name}", packageId, requestedByUserId, ct);
            }
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);

        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    public async Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetTenantPurchasesAsync(Guid tenantId, int take, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 100);
        var rows = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.TenantId == tenantId && !p.IsDeleted)
            .OrderByDescending(p => p.CreatedAtUtc).Take(take).ToListAsync(ct);
        var dtos = rows.Select(p => new CreditPurchaseDto(p.Id, p.TenantId, null, p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsCredits, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc, p.Provider, p.Channel)).ToList();
        return Result<IReadOnlyCollection<CreditPurchaseDto>>.Success(dtos);
    }

    // ==================== KARTLA KREDİ ALMA ====================
    //
    // Abonelik tahsilatıyla AYNI değişmezler geçerlidir (bkz. BillingService): bakiye yalnız
    // sağlayıcı tahsilatı DOĞRULANDIĞINDA artar, her deneme kayıtlıdır, işlem anahtarı benzersizdir
    // ve aynı sağlayıcı ödeme kimliği ikinci bir kayda yazılamaz. Fark: kart saklanmaz (tek
    // seferlik alım), ödeme grubu PRODUCT'tır ve dönüş ayrı bir callback ucuna gelir.

    public async Task<Result<CheckoutStartedDto>> StartCreditCheckoutAsync(
        Guid tenantId, TopUpRequest request, string callbackUrl, Guid? requestedByUserId, CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<CheckoutStartedDto>.Failure(context.Error);

        if (string.IsNullOrWhiteSpace(callbackUrl))
        {
            return Result<CheckoutStartedDto>.Failure(Error.Conflict(
                "Ödeme dönüş adresi belirlenemedi. Platform yöneticisi ödeme ayarlarını kontrol etmeli."));
        }

        var resolved = await ResolveTopUpAsync(request, ct);
        if (resolved.IsFailure) return Result<CheckoutStartedDto>.Failure(resolved.Error);
        var (price, grants, name, packageId, channel) = resolved.Value;

        if (price <= 0)
        {
            return Result<CheckoutStartedDto>.Failure(Error.Validation(
                "Kartla ödeme için tutar sıfırdan büyük olmalı. Ücretsiz yüklemeyi platform yöneticisi yapar."));
        }

        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<CheckoutStartedDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var conversationId = $"wac-{tenantId:N}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";

        // Talep ÖNCE yazılır: sağlayıcı dönüşü (callback) bu satırı işlem anahtarıyla bulur. Sonra
        // yazsaydık, hızlı dönen bir callback karşılığını bulamayıp tahsilatı kayıtsız bırakırdı.
        var purchase = new WhatsAppCreditPurchase(
            tenantId, packageId, name, price, grants, requestedByUserId, channel,
            context.Value!.Gateway.Provider, conversationId);
        _db.WhatsAppCreditPurchases.Add(purchase);
        await _db.SaveChangesAsync(ct);

        var init = await context.Value.Gateway.InitCheckoutAsync(new CheckoutInitRequest(
            conversationId,
            price,
            // Ödeme sayfası (Maydanoz) hangi kredinin alındığını göstersin: "SMS kredisi · …" / "WhatsApp kredisi · …".
            $"{channel.Label()} · {name}",
            tenantId.ToString("N"),
            tenant.OwnerName ?? tenant.Name,
            "Yetkili",
            tenant.Email ?? string.Empty,
            tenant.Phone ?? string.Empty,
            tenant.TaxNumber ?? string.Empty,
            tenant.LegalName ?? tenant.Name,
            "İstanbul",
            _currentUser.IpAddress ?? "127.0.0.1",
            callbackUrl,
            // Tek seferlik alım: kart SAKLANMAZ (abonelikten farkı). Saklamak, kurumun bir daha
            // onaylamadığı bir kartla ileride çekim yapılabileceği izlenimi verirdi.
            CardUserKey: null,
            RegisterCard: false,
            PaymentGroup: "PRODUCT"), ct);

        if (init.IsFailure)
        {
            purchase.MarkPaymentFailed("INIT_FAILED", init.Error.Message, DateTime.UtcNow);
            await _db.SaveChangesAsync(ct);
            return Result<CheckoutStartedDto>.Failure(init.Error);
        }

        await _audit.LogAsync(tenantId, null, "CreditCheckoutStarted", "WhatsAppCredit", purchase.Id,
            $"Kredi ödeme formu başlatıldı: {name} · {price:N2} TL → {FormatCredits(grants)} kredi", new { name, price, grants }, ct);

        return Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(
            init.Value!.CheckoutToken, init.Value.CheckoutFormContent, init.Value.PaymentPageUrl, price));
    }

    /// <summary>
    /// Sağlayıcı sonucunu BEKLENEN talebe bağlar. "Başarılı" bayrağı tek başına hiçbir şey ifade
    /// etmez: sonuç bizim açtığımız işlem anahtarına, beklediğimiz tutara ve para birimine ait
    /// olmalı, ödeme kimliği bulunmalı ve o kimlik <b>ne başka bir kredi talebine ne de bir
    /// aboneliğe</b> yazılmış olmalıdır. <returns>Uyumsuzluk açıklaması; uyuyorsa null.</returns>
    /// </summary>
    private async Task<string?> DescribeCreditMismatchAsync(
        WhatsAppCreditPurchase purchase, string expectedProvider, string? returnedConversationId,
        decimal paidAmountTry, string? currency, string? providerPaymentId, CancellationToken ct)
    {
        if (!string.Equals(purchase.Provider, expectedProvider, StringComparison.OrdinalIgnoreCase))
            return $"Ödeme sağlayıcısı uyuşmuyor (beklenen {purchase.Provider}, dönen {expectedProvider}).";

        if (!string.IsNullOrWhiteSpace(returnedConversationId)
            && !string.Equals(returnedConversationId, purchase.ConversationId, StringComparison.Ordinal))
        {
            return $"İşlem anahtarı uyuşmuyor (beklenen {purchase.ConversationId}, dönen {returnedConversationId}).";
        }

        if (!string.IsNullOrWhiteSpace(currency) && !string.Equals(currency, "TRY", StringComparison.OrdinalIgnoreCase))
            return $"Ödeme para birimi uyuşmuyor (beklenen TRY, dönen {currency}).";

        if (paidAmountTry != purchase.PriceTry)
            return $"Ödeme tutarı uyuşmuyor (beklenen {purchase.PriceTry:N2} TL, dönen {paidAmountTry:N2} TL).";

        if (string.IsNullOrWhiteSpace(providerPaymentId))
            return "Sağlayıcı ödeme kimliği dönmedi; ödeme doğrulanamadı.";

        if (await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(p => p.Id != purchase.Id && p.ProviderPaymentId == providerPaymentId, ct))
        {
            return "Bu sağlayıcı ödeme kimliği başka bir kredi yüklemesine ait; işlem uygulanmadı.";
        }

        // ÇAPRAZ TABLO (bkz. BillingService.DescribeOutcomeMismatchAsync'teki eşi): aynı iyzico
        // ödemesi hem aboneliğe hem krediye sayılamaz. İki tablo arasında derleme zamanı bağı yok;
        // bu kontrolün iki yönlü kalması ELLE korunmak zorunda.
        if (await _db.SubscriptionPayments.AsNoTracking()
                .AnyAsync(p => p.ProviderPaymentId == providerPaymentId, ct))
        {
            return "Bu sağlayıcı ödeme kimliği bir abonelik ödemesine ait; işlem uygulanmadı.";
        }

        return null;
    }

    public async Task<Result<CreditCheckoutCompletedDto>> CompleteCreditCheckoutAsync(string checkoutToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(checkoutToken))
            return Result<CreditCheckoutCompletedDto>.Failure(Error.Validation("Ödeme anahtarı eksik."));

        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<CreditCheckoutCompletedDto>.Failure(context.Error);

        var retrieved = await context.Value!.Gateway.RetrieveCheckoutAsync(checkoutToken, ct);
        if (retrieved.IsFailure) return Result<CreditCheckoutCompletedDto>.Failure(retrieved.Error);
        var result = retrieved.Value!;

        // TEK KAZANAN: TALEP SATIRI KİLİTLENİR. Aynı ödeme İKİ YOLDAN gelir (tarayıcı dönüşü +
        // sağlayıcı çağrısı); "zaten onaylı mı" kontrolü tek başına yalnız SIRAYLA gelen çağrılara
        // karşı korur. Eşzamanlı ikisi de "Pending" okuyup cüzdana İKİ KEZ yüklerdi.
        await using var tx = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.ConversationId == result.ConversationId && !p.IsDeleted, ct);
        if (purchase is null)
        {
            _logger.LogError("Kredi ödeme dönüşü eşleşmedi: {ConversationId}", result.ConversationId);
            return Result<CreditCheckoutCompletedDto>.Failure(Error.NotFound("Kredi satın alma kaydı bulunamadı."));
        }

        if (tx is not null)
        {
            await RowLock.LockRowAsync(_db, "whatsapp_credit_purchases", purchase.Id, ct);
            // Kilidi BEKLEYEN taraf, beklerken diğerinin yazdıklarını görmeli.
            await _db.Entry(purchase).ReloadAsync(ct);
        }

        // İDEMPOTENT: kullanıcı dönüş sayfasını yenilerse bakiye ikinci kez yüklenmemeli.
        if (purchase.Status == CreditPurchaseStatus.Approved)
        {
            var already = await BuildWalletDtoAsync(purchase.TenantId, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                true, "Ödeme zaten alınmıştı.", purchase.GrantsCredits, BalanceOf(already, purchase.Channel)));
        }

        if (purchase.Status != CreditPurchaseStatus.Pending)
        {
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false, purchase.Note ?? "Bu kredi talebi zaten kapatılmış.", null, null));
        }

        var nowUtc = DateTime.UtcNow;

        // BELİRSİZ SONUÇ KAYDI KAPATMAZ (denetim bulgusu).
        //
        // SOMUT AÇIK: her başarısız-olmayan sonuç kalıcı Failed yazılıyordu. Oysa 3DS'in ortasında
        // sorulan bir checkout "reddedildi" değil BELİRSİZdir. Müşteri ödemeyi hemen ardından
        // tamamladığında kayıt Failed olduğu için sonraki callback onu yeniden değerlendiremiyor,
        // para çekilmiş olmasına rağmen kredi yüklenmiyordu. Artık yalnız KESİN RED kapatır;
        // belirsiz sonuç talebi PENDING bırakır ve sonraki dönüş (ya da "Sağlayıcıdan sor")
        // aynı kaydı çözebilir.
        if (result.Outcome != PaymentOutcome.Succeeded)
        {
            var declined = result.Outcome == PaymentOutcome.Declined;
            if (declined) purchase.MarkPaymentFailed(result.ErrorCode, result.ErrorMessage, nowUtc);
            else purchase.MarkPaymentUnresolved(result.ErrorMessage, nowUtc);

            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
            await _audit.LogAsync(purchase.TenantId, null,
                declined ? "CreditPaymentFailed" : "CreditPaymentUnresolved", "WhatsAppCredit", purchase.Id,
                declined
                    ? $"Kredi ödemesi reddedildi: {result.ErrorMessage}"
                    : $"Kredi ödemesinin sonucu belirsiz, talep açık bırakıldı: {result.ErrorMessage}",
                new { result.ErrorCode, Outcome = result.Outcome.ToString() }, ct);

            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false,
                declined
                    ? (result.ErrorMessage ?? "Ödeme reddedildi.")
                    : "Ödemenizin sonucu henüz kesinleşmedi. Tahsilat geçerse krediniz otomatik yüklenir.",
                null, null));
        }

        var mismatch = await DescribeCreditMismatchAsync(
            purchase, context.Value.Gateway.Provider, result.ConversationId,
            result.PaidAmountTry, result.Currency, result.ProviderPaymentId, ct);
        if (mismatch is not null)
        {
            // RED DE BİR SONUÇTUR: commit edilmezse talep "Pending" kalır ve aynı sahte dönüş
            // tekrar denenebilirdi.
            purchase.MarkPaymentFailed("CallbackMismatch", mismatch, nowUtc);
            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
            _logger.LogError("Kredi ödeme dönüşü değişmezlere uymadı ({PurchaseId}): {Reason}", purchase.Id, mismatch);
            await _audit.LogAsync(purchase.TenantId, null, "CreditPaymentRejected", "WhatsAppCredit", purchase.Id,
                $"Kredi ödeme dönüşü reddedildi: {mismatch}", new { purchase.ConversationId, purchase.PriceTry }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(false, mismatch, null, null));
        }

        // Sahiplik + onay + bakiye ORTAK metotta: çözümleme yolu da aynısını uygular.
        var applied = await ApplyVerifiedCreditAsync(
            purchase, context.Value.Gateway.Provider, result.ProviderPaymentId, nowUtc, tx, ct);
        if (applied.IsSuccess && applied.Value!.Succeeded)
        {
            await _audit.LogAsync(purchase.TenantId, null, "CreditPurchased", "WhatsAppCredit", purchase.Id,
                $"Kredi yüklendi: {purchase.PackageName} · {purchase.PriceTry:N2} TL → {FormatCredits(purchase.GrantsCredits)} kredi",
                new { purchase.PackageName, purchase.PriceTry, purchase.GrantsCredits }, ct);
        }
        return applied;
    }

    public async Task<Result<CreditCheckoutCompletedDto>> ReconcileCreditPurchaseAsync(Guid purchaseId, CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<CreditCheckoutCompletedDto>.Failure(context.Error);

        await using var tx = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditCheckoutCompletedDto>.Failure(Error.NotFound("Kredi talebi bulunamadı."));
        if (!purchase.IsCardCheckout)
            return Result<CreditCheckoutCompletedDto>.Failure(Error.Conflict("Bu talep kartla ödeme talebi değil."));

        if (tx is not null)
        {
            await RowLock.LockRowAsync(_db, "whatsapp_credit_purchases", purchase.Id, ct);
            await _db.Entry(purchase).ReloadAsync(ct);
        }

        if (purchase.Status == CreditPurchaseStatus.Approved)
        {
            var already = await BuildWalletDtoAsync(purchase.TenantId, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                true, "Ödeme zaten alınmıştı.", purchase.GrantsCredits, BalanceOf(already, purchase.Channel)));
        }
        if (purchase.Status != CreditPurchaseStatus.Pending)
        {
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false, purchase.Note ?? "Bu kredi talebi zaten kapatılmış.", null, null));
        }

        // SAĞLAYICIYA SORULUR — kör onay yok. Sonuç "bilmiyorum" ise talep açık kalır.
        var probe = await context.Value!.Gateway.RetrievePaymentAsync(purchase.ConversationId!, ct);
        if (probe.IsFailure) return Result<CreditCheckoutCompletedDto>.Failure(probe.Error);

        var nowUtc = DateTime.UtcNow;
        if (probe.Value!.Outcome != PaymentOutcome.Succeeded)
        {
            var declined = probe.Value.Outcome == PaymentOutcome.Declined;
            if (declined) purchase.MarkPaymentFailed(probe.Value.ErrorCode, probe.Value.ErrorMessage, nowUtc);
            else purchase.MarkPaymentUnresolved(probe.Value.ErrorMessage, nowUtc);
            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
            await _audit.LogAsync(purchase.TenantId, null, "CreditReconcileAttempted", "WhatsAppCredit", purchase.Id,
                $"Kredi ödemesi sağlayıcıya soruldu: {probe.Value.Outcome}", new { probe.Value.ErrorCode }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false,
                declined
                    ? (probe.Value.ErrorMessage ?? "Sağlayıcı ödemeyi reddetti.")
                    : "Sağlayıcı bu ödeme için kesin sonuç vermedi; talep açık bırakıldı.",
                null, null));
        }

        var mismatch = await DescribeCreditMismatchAsync(
            purchase, context.Value.Gateway.Provider, probe.Value.ConversationId,
            probe.Value.PaidAmountTry, probe.Value.Currency, probe.Value.ProviderPaymentId, ct);
        if (mismatch is not null)
        {
            purchase.MarkPaymentFailed("ReconcileMismatch", mismatch, nowUtc);
            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
            await _audit.LogAsync(purchase.TenantId, null, "CreditPaymentRejected", "WhatsAppCredit", purchase.Id,
                $"Kredi çözümlemesi reddedildi: {mismatch}", new { purchase.ConversationId }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(false, mismatch, null, null));
        }

        var applied = await ApplyVerifiedCreditAsync(
            purchase, context.Value.Gateway.Provider, probe.Value.ProviderPaymentId, nowUtc, tx, ct);
        await _audit.LogAsync(purchase.TenantId, null, "CreditReconciled", "WhatsAppCredit", purchase.Id,
            $"Kredi sağlayıcı sorgusuyla çözüldü: {purchase.PackageName} · {purchase.PriceTry:N2} TL", null, ct);
        return applied;
    }

    /// <summary>
    /// DOĞRULANMIŞ TAHSİLATI UYGULAR — sahiplik + onay damgası + bakiye, tek kayıtta.
    /// Callback ve çözümleme yolları BU metodu paylaşır: iki ayrı kopya olsaydı biri düzeltilip
    /// diğeri unutulurdu (bu depoda aynı sınıf hata iki kez yaşandı).
    /// </summary>
    private async Task<Result<CreditCheckoutCompletedDto>> ApplyVerifiedCreditAsync(
        WhatsAppCreditPurchase purchase, string provider, string? providerPaymentId, DateTime nowUtc,
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? tx, CancellationToken ct)
    {
        // ATOMİK SAHİPLİK — para hareketinden ÖNCE. Üstteki çapraz tablo sorgusu
        // KONTROL-SONRA-YAZ'dır ve eşzamanlı bir abonelik callback'ine karşı bağlayıcı değildir;
        // garanti benzersiz indekstedir (bkz. ProviderPaymentClaim).
        // "ZATEN BENİM" ile "BAŞKASININ" ayrılır. Ayrılmadığında, sahiplik yazıldıktan sonra
        // çöken bir tur kendi bıraktığı satır yüzünden yeniden denenemiyor ve — buradaki dal
        // TERMİNAL damga yazdığı için — GERÇEKTEN ÖDENMİŞ bir kredi yüklemesi kalıcı olarak
        // "başarısız" işaretleniyordu. Para alınmış, kredi hiç yüklenmemiş olurdu.
        var claimed = await ProviderPaymentClaims.TryClaimAsync(
            _db, provider, providerPaymentId!, ProviderPaymentClaim.WhatsAppCreditLedger,
            purchase.Id, purchase.TenantId, ct);
        if (claimed == ProviderPaymentClaims.ClaimOutcome.AlreadyOwnedBySelf)
        {
            _logger.LogWarning("Yarım kalmış kredi yüklemesi sürdürülüyor ({PurchaseId}); sahiplik zaten bu kayda ait.", purchase.Id);
        }
        if (claimed == ProviderPaymentClaims.ClaimOutcome.OwnedByAnother)
        {
            const string reason = "Bu sağlayıcı ödemesi başka bir deftere işlenmiş; kredi yüklenmedi.";
            purchase.MarkPaymentFailed("ClaimConflict", reason, nowUtc);
            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
            _logger.LogError("Kredi ödemesi sahiplenilemedi ({PurchaseId}); ödeme kimliği başka defterde.", purchase.Id);
            await _audit.LogAsync(purchase.TenantId, null, "CreditPaymentRejected", "WhatsAppCredit", purchase.Id,
                reason, new { purchase.ConversationId, providerPaymentId }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(false, reason, null, null));
        }

        // ONAY DAMGASI İLE BAKİYE ARTIŞI AYNI KAYITTA: biri olup diğeri olmazsa ya para alınıp
        // kredi yüklenmez ya da aynı tahsilat ikinci kez yüklenebilir.
        purchase.MarkPaidAndApprove(providerPaymentId, nowUtc);
        await CreditWalletAsync(purchase.TenantId, purchase.Channel, purchase.GrantsCredits,
            $"Kredi: {purchase.PackageName}", purchase.CreditPackageId, purchase.RequestedByUserId, ct);
        await _db.SaveChangesAsync(ct);
        // PARA TARAFI ÖNCE KALICI OLUR: denetim kaydı commit'ten sonra gelir, yan iş tahsilatı geri almaz.
        if (tx is not null) await tx.CommitAsync(ct);

        var wallet = await BuildWalletDtoAsync(purchase.TenantId, ct);
        return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
            true, "Ödeme alındı, krediniz yüklendi.", purchase.GrantsCredits, BalanceOf(wallet, purchase.Channel)));
    }

    public async Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetPurchasesAsync(bool onlyPending, CancellationToken ct = default)
    {
        var q = _db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().Where(p => !p.IsDeleted);
        // ONAY KUYRUĞU YALNIZ HAVALE TALEPLERİDİR. Kartlı talepler de PENDING açılır ama insan
        // onayına kapalıdır (bkz. WhatsAppCreditPurchase.Approve); kuyrukta görünmeleri yöneticiyi
        // "bu neden onaylanmıyor?" diye uğraştırır ve yanlışlıkla onaylama baskısı yaratır.
        // Tüm liste (onlyPending=false) hepsini göstermeye devam eder — takılan kartlı talep
        // platformdan GÖRÜLEBİLİR kalmalı.
        if (onlyPending) q = q.Where(p => p.Status == CreditPurchaseStatus.Pending && p.ConversationId == null);
        var rows = await q.OrderByDescending(p => p.CreatedAtUtc).Take(200).ToListAsync(ct);
        // NOT: MySql.EntityFrameworkCore Guid listesi .Contains()'i sunucuda çeviremez → tüm kurum adlarını
        // (platform seviyesinde az sayıda) çekip bellekte eşleştir.
        var names = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Select(t => new { t.Id, t.Name }).ToListAsync(ct);
        var nameMap = names.ToDictionary(x => x.Id, x => x.Name);
        var dtos = rows.Select(p => new CreditPurchaseDto(p.Id, p.TenantId, nameMap.GetValueOrDefault(p.TenantId), p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsCredits, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc, p.Provider, p.Channel)).ToList();
        return Result<IReadOnlyCollection<CreditPurchaseDto>>.Success(dtos);
    }

    public async Task<Result<CreditPurchaseDto>> ApprovePurchaseAsync(Guid purchaseId, Guid? processedByUserId, CancellationToken ct = default)
    {
        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kredi talebi bulunamadı."));
        // KARTLI TALEP ELLE ONAYLANAMAZ (denetim bulgusu): tahsilat yapılmadan kredi yüklenirdi.
        // Varlıkta da aynı kapı var; burada 409 ile nazik hata döner, orada istisna.
        if (purchase.IsCardCheckout)
        {
            return Result<CreditPurchaseDto>.Failure(Error.Conflict(
                "Bu talep kartla ödeme için açıldı; elle onaylanamaz. Sonucu ödeme sağlayıcısı belirler — " +
                "ödeme takıldıysa 'Sağlayıcıdan sor' ile sonucu doğrulatın."));
        }
        if (purchase.Status != CreditPurchaseStatus.Pending) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        // ÇİFT ONAY KAPISI — kilit + TAZE OKUMA, işlemin İÇİNDE.
        //
        // Yukarıdaki durum kontrolü işlemin DIŞINDA ve kilitsizdi: iki yönetici (ya da çift
        // tıklama) aynı talebi aynı anda onaylayınca ikisi de "Pending" görüyor, ikisi de
        // bakiyeyi artırıyordu — kurum bir ödemeye karşılık İKİ KEZ kredi kazanıyordu.
        // Talebin "onaylandı" damgası ile bakiyenin artması AYNI kayıtta olmalı: biri olup diğeri
        // olmazsa ya para yüklenmeden talep kapanır ya da aynı talep ikinci kez yüklenebilir.
        var alreadyProcessed = false;
        await InWalletTransactionAsync(async () =>
        {
            await RowLock.LockRowAsync(_db, "whatsapp_credit_purchases", purchase.Id, ct);
            // Kilit alındıktan SONRA taze oku: araya giren istek durumu değiştirmiş olabilir.
            await _db.Entry(purchase).ReloadAsync(ct);
            if (purchase.Status != CreditPurchaseStatus.Pending)
            {
                alreadyProcessed = true;
                return false;
            }

            purchase.Approve(processedByUserId);
            await CreditWalletAsync(purchase.TenantId, purchase.Channel, purchase.GrantsCredits, $"Kredi: {purchase.PackageName}", purchase.CreditPackageId, processedByUserId, ct);
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);

        if (alreadyProcessed) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    public async Task<Result<CreditPurchaseDto>> RejectPurchaseAsync(Guid purchaseId, Guid? processedByUserId, string? note, CancellationToken ct = default)
    {
        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kredi talebi bulunamadı."));
        // Onayla aynı gerekçe: kartlı talebi insan kapatırsa, müşteri ödemeyi sonradan tamamladığında
        // kayıt yeniden değerlendirilemez ve para karşılıksız kalır.
        if (purchase.IsCardCheckout)
        {
            return Result<CreditPurchaseDto>.Failure(Error.Conflict(
                "Bu talep kartla ödeme için açıldı; elle reddedilemez. Sonucu ödeme sağlayıcısı belirler."));
        }
        if (purchase.Status != CreditPurchaseStatus.Pending) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        // ONAYLA AYNI YARIŞ: "onayla" ile "reddet" aynı anda gelirse ikisi de Pending görüyordu;
        // bakiye artarken talep reddedilmiş görünebiliyordu. Kilit + taze okuma ikisini sıraya sokar.
        var alreadyProcessed = false;
        await InWalletTransactionAsync(async () =>
        {
            await RowLock.LockRowAsync(_db, "whatsapp_credit_purchases", purchase.Id, ct);
            await _db.Entry(purchase).ReloadAsync(ct);
            if (purchase.Status != CreditPurchaseStatus.Pending)
            {
                alreadyProcessed = true;
                return false;
            }

            purchase.Reject(processedByUserId, note);
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);

        if (alreadyProcessed) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    /// <summary>Bakiyeyi artıran ortak işlem (TopUp defter kaydı ekler). SaveChanges ÇAĞIRMAZ.</summary>
    private async Task CreditWalletAsync(Guid tenantId, CreditChannel channel, decimal grants, string description, Guid? packageId, Guid? performedByUserId, CancellationToken ct)
    {
        var wallet = await GetOrCreateWalletAsync(tenantId, ct);
        wallet.TopUp(channel, grants);
        _db.WalletTransactions.Add(new WalletTransaction(
            tenantId, WalletTransactionType.TopUp, grants, wallet.BalanceFor(channel), wallet.ReservedFor(channel),
            description: description, creditPackageId: packageId, performedByUserId: performedByUserId,
            channel: channel.ToNotificationChannel()));
    }

    private async Task<CreditPurchaseDto> ToPurchaseDtoAsync(WhatsAppCreditPurchase p, CancellationToken ct)
    {
        var name = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == p.TenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);
        return new CreditPurchaseDto(p.Id, p.TenantId, name, p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsCredits, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc, p.Provider, p.Channel);
    }

    public async Task<Result<IReadOnlyCollection<WalletTransactionDto>>> GetTransactionsAsync(Guid tenantId, int take, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        var rows = await _db.WalletTransactions.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.TenantId == tenantId && !t.IsDeleted)
            .OrderByDescending(t => t.CreatedAtUtc)
            .Take(take)
            .Select(t => new WalletTransactionDto(t.Id, t.Type, t.Unit, t.Amount, t.BalanceAfter, t.Description, t.Category, t.Channel, t.CreatedAtUtc))
            .ToListAsync(ct);
        return Result<IReadOnlyCollection<WalletTransactionDto>>.Success(rows);
    }

    // ==================== PLATFORM: FİYATLANDIRMA ====================

    public async Task<Result<IReadOnlyCollection<WhatsAppPricingRuleDto>>> GetPricingRulesAsync(CancellationToken ct = default)
    {
        var rate = (await GetOrCreateBillingSettingsAsync(ct)).UsdTryRate;
        var rules = await _db.WhatsAppPricingRules.AsNoTracking()
            .Where(r => !r.IsDeleted)
            .OrderBy(r => r.Category).ThenByDescending(r => r.EffectiveFromUtc)
            .ToListAsync(ct);
        var dtos = rules.Select(r => ToPricingDto(r, rate)).ToList();
        return Result<IReadOnlyCollection<WhatsAppPricingRuleDto>>.Success(dtos);
    }

    public async Task<Result<WhatsAppPricingRuleDto>> SavePricingRuleAsync(Guid? id, SavePricingRuleRequest request, CancellationToken ct = default)
    {
        WhatsAppPricingRule rule;
        if (id is { } rid)
        {
            var existing = await _db.WhatsAppPricingRules.FirstOrDefaultAsync(r => r.Id == rid && !r.IsDeleted, ct);
            if (existing is null) return Result<WhatsAppPricingRuleDto>.Failure(Error.NotFound("Fiyat kuralı bulunamadı."));
            existing.SetPrices(request.MetaUsdPrice, request.CreditCost);
            existing.SetEffectiveFrom(request.EffectiveFromUtc);
            existing.SetNote(request.Note);
            rule = existing;
        }
        else
        {
            rule = new WhatsAppPricingRule(request.Category, request.MetaUsdPrice, request.CreditCost, request.EffectiveFromUtc, request.Note);
            _db.WhatsAppPricingRules.Add(rule);
        }
        await _db.SaveChangesAsync(ct);
        var rate = (await GetOrCreateBillingSettingsAsync(ct)).UsdTryRate;
        return Result<WhatsAppPricingRuleDto>.Success(ToPricingDto(rule, rate));
    }

    public async Task<Result> DeletePricingRuleAsync(Guid id, CancellationToken ct = default)
    {
        var rule = await _db.WhatsAppPricingRules.FirstOrDefaultAsync(r => r.Id == id && !r.IsDeleted, ct);
        if (rule is null) return Result.Failure(Error.NotFound("Fiyat kuralı bulunamadı."));
        rule.SoftDelete();
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    // ==================== PLATFORM: KREDİ PAKETLERİ ====================

    public async Task<Result<IReadOnlyCollection<CreditPackageDto>>> GetCreditPackagesAsync(bool includeInactive, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var billing = await GetOrCreateBillingSettingsAsync(ct);
        var utilityCost = await GetCreditCostAsync(WhatsAppMessageCategory.Utility, now, ct) ?? 0m;
        var q = _db.WhatsAppCreditPackages.AsNoTracking().Where(p => !p.IsDeleted);
        if (!includeInactive) q = q.Where(p => p.IsActive);
        var rows = await q.OrderBy(p => p.DisplayOrder).ThenBy(p => p.PriceTry).ToListAsync(ct);
        var dtos = rows.Select(p => ToPackageDto(p, utilityCost, billing.SmsCreditsPerPart)).ToList();
        return Result<IReadOnlyCollection<CreditPackageDto>>.Success(dtos);
    }

    public async Task<Result<CreditPackageDto>> SaveCreditPackageAsync(Guid? id, SaveCreditPackageRequest request, CancellationToken ct = default)
    {
        WhatsAppCreditPackage pkg;
        if (id is { } pid)
        {
            var existing = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == pid && !p.IsDeleted, ct);
            if (existing is null) return Result<CreditPackageDto>.Failure(Error.NotFound("Kredi paketi bulunamadı."));
            existing.Rename(request.Name);
            existing.SetAmounts(request.PriceTry, request.GrantsCredits);
            existing.SetDescription(request.Description);
            existing.SetDisplayOrder(request.DisplayOrder);
            if (request.Channel is { } channel) existing.SetChannel(channel);
            if (request.IsActive) existing.Activate(); else existing.Deactivate();
            pkg = existing;
        }
        else
        {
            pkg = new WhatsAppCreditPackage(request.Name, request.PriceTry, request.GrantsCredits, request.DisplayOrder, request.Description,
                request.Channel ?? CreditChannel.WhatsApp);
            if (!request.IsActive) pkg.Deactivate();
            _db.WhatsAppCreditPackages.Add(pkg);
        }
        await _db.SaveChangesAsync(ct);
        var utilityCost = await GetCreditCostAsync(WhatsAppMessageCategory.Utility, DateTime.UtcNow, ct) ?? 0m;
        return Result<CreditPackageDto>.Success(ToPackageDto(pkg, utilityCost, (await GetOrCreateBillingSettingsAsync(ct)).SmsCreditsPerPart));
    }

    public async Task<Result> DeleteCreditPackageAsync(Guid id, CancellationToken ct = default)
    {
        var pkg = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == id && !p.IsDeleted, ct);
        if (pkg is null) return Result.Failure(Error.NotFound("Kredi paketi bulunamadı."));
        pkg.SoftDelete();
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    // ==================== PLATFORM: AYARLAR + CÜZDAN YÖNETİMİ ====================

    public async Task<Result<WhatsAppBillingSettingsDto>> GetBillingSettingsAsync(CancellationToken ct = default)
        => Result<WhatsAppBillingSettingsDto>.Success(ToSettingsDto(await GetOrCreateBillingSettingsAsync(ct)));

    public async Task<Result<WhatsAppBillingSettingsDto>> SaveBillingSettingsAsync(SaveBillingSettingsRequest request, CancellationToken ct = default)
    {
        var s = await GetOrCreateBillingSettingsAsync(ct);
        s.Update(request.BillingEnabled, request.ChargeSimulated, request.UsdTryRate,
            request.LowBalanceThresholdCredits, request.DefaultMonthlySpendCapCredits, request.AutoApproveTopUps,
            request.SmsCreditsPerPart, request.CreditUnitPriceTry, request.SmsCreditUnitPriceTry);
        await _db.SaveChangesAsync(ct);
        return Result<WhatsAppBillingSettingsDto>.Success(ToSettingsDto(s));
    }

    public async Task<Result<MessagingWalletDto>> AdjustWalletAsync(Guid tenantId, AdjustWalletRequest request, Guid? performedByUserId, CancellationToken ct = default)
    {
        if (request.DeltaCredits == 0) return Result<MessagingWalletDto>.Failure(Error.Validation("Düzeltme miktarı 0 olamaz."));

        // Elle düzeltme de bakiyeyi okuyup yazar: eşzamanlı bir gönderim/yükleme ile yarışırsa
        // biri diğerinin yazdığını ezer. Diğer bakiye yolları ile AYNI kilit protokolünden geçer.
        await InWalletTransactionAsync(async () =>
        {
            var channel = request.Channel ?? CreditChannel.WhatsApp;
            var wallet = await GetOrCreateWalletAsync(tenantId, ct);
            wallet.Adjust(channel, request.DeltaCredits);
            _db.WalletTransactions.Add(new WalletTransaction(
                tenantId, WalletTransactionType.Adjustment, request.DeltaCredits, wallet.BalanceFor(channel), wallet.ReservedFor(channel),
                description: string.IsNullOrWhiteSpace(request.Description) ? $"Platform düzeltmesi ({channel.Label()})" : request.Description,
                performedByUserId: performedByUserId, channel: channel.ToNotificationChannel()));
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);

        return Result<MessagingWalletDto>.Success(await BuildWalletDtoAsync(tenantId, ct));
    }

    // ==================== YARDIMCILAR ====================

    /// <summary>Kategorinin O AN geçerli kredi maliyeti (ileri tarihli kurallar henüz sayılmaz). Kural yoksa null.</summary>
    private async Task<decimal?> GetCreditCostAsync(WhatsAppMessageCategory category, DateTime atUtc, CancellationToken ct)
    {
        var rule = await _db.WhatsAppPricingRules.AsNoTracking()
            .Where(r => !r.IsDeleted && r.IsActive && r.Category == category && r.EffectiveFromUtc <= atUtc)
            .OrderByDescending(r => r.EffectiveFromUtc)
            .FirstOrDefaultAsync(ct);
        return rule?.CreditCost;
    }

    /// <summary>
    /// Bu ay KREDİDEN karşılanan toplam (rezerve + kesinleşen) — WhatsApp ve SMS birlikte. Harcama
    /// tavanı ortak cüzdana konduğu için iki kanal ayrı sayılsaydı tavan iki katına çıkardı.
    /// </summary>
    /// <summary>
    /// Ayın cüzdandan taahhüt edilen kredisi — KANAL BAŞINA (18 Kas 2026: SMS ve WhatsApp kredisi ayrı birimdir;
    /// aylık harcama tavanı her kanala ayrı ayrı uygulanır).
    /// </summary>
    private async Task<decimal> MonthlyWalletCommittedAsync(Guid tenantId, DateTime monthStart, CreditChannel channel, CancellationToken ct)
    {
        if (channel == CreditChannel.Sms)
        {
            // İade edilen SMS'in kaynağı None'a döner (ClearCharge) → burada sayılmaz.
            return await _db.NotificationLogs.IgnoreQueryFilters().AsNoTracking()
                .Where(l => l.TenantId == tenantId && !l.IsDeleted
                         && l.BillingSource == WhatsAppBillingSource.Wallet
                         && l.CreatedAtUtc >= monthStart)
                .SumAsync(l => (decimal?)l.ChargedCredits, ct) ?? 0m;
        }

        return await _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == tenantId && !m.IsDeleted
                     && m.BillingSource == WhatsAppBillingSource.Wallet
                     && m.Status != WhatsAppMessageStatus.Failed
                     && m.CreatedAtUtc >= monthStart)
            .SumAsync(m => (decimal?)m.ChargedCredits, ct) ?? 0m;
    }

    private static decimal? ResolveSpendCap(WhatsAppSettings? settings, SubscriptionPlan? plan, WhatsAppBillingSettings billing)
    {
        if (settings?.MonthlySpendCapCredits is { } tenantCap) return tenantCap;
        if (plan is { DefaultSpendCapCredits: > 0 }) return plan.DefaultSpendCapCredits;
        return billing.DefaultMonthlySpendCapCredits;
    }

    /// <summary>
    /// Bu ay plan SMS KOTASINDAN düşülen mesaj sayısı (devam eden kota rezervasyonları dahil).
    /// Kredi dönüşümü öncesi yazılmış satırlar kaynaksızdır (None); gönderilmişlerse o dönemin
    /// tek ücretlendirmesi kota olduğu için kotadan sayılır — ay ortasında geçişte kota sıfırlanmaz.
    /// </summary>
    private Task<int> CountSmsQuotaUsedAsync(Guid tenantId, DateTime monthStart, CancellationToken ct)
        => _db.NotificationLogs.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(l => l.TenantId == tenantId && !l.IsDeleted
                          && l.Channel == NotificationChannel.Sms
                          && l.CreatedAtUtc >= monthStart
                          && l.Status != NotificationLogStatus.Failed
                          && (l.BillingSource == WhatsAppBillingSource.Quota
                              || (l.BillingSource == WhatsAppBillingSource.None && l.Status == NotificationLogStatus.Sent)), ct);

    /// <summary>
    /// Bu bağlamda kotadan sayılmış ama HENÜZ YAZILMAMIŞ SMS satırları.
    ///
    /// <para>
    /// SOMUT AÇIK: elle (anahtarsız) toplu gönderim satırlarını döngü sonunda TOPLU yazar
    /// (binlerce kişide satır başına SaveChanges gereksiz maliyet). Kota sayımı yalnız veritabanına
    /// baktığı için döngü boyunca bayat kalıyordu: kotası 10 kalan kurum 1.000 kişiye gönderdiğinde
    /// hepsi "kotadan" sayılıyor, krediye HİÇ geçilmiyordu — tahmin "kredi düşer" derken gönderim
    /// kotayı aşıp ücretsiz gidiyordu. İzleyicideki eklenmiş satırlar sayıma katılır; krediden
    /// karşılanan bir satırın kaydı öncekileri de yazdığı için (Added → Unchanged) çift sayım olmaz.
    /// </para>
    /// </summary>
    private int PendingQuotaSmsInTracker(Guid tenantId) =>
        _db.ChangeTracker.Entries<NotificationLog>()
            .Count(e => e.State == EntityState.Added
                     && e.Entity.TenantId == tenantId
                     && e.Entity.Channel == NotificationChannel.Sms
                     && e.Entity.BillingSource == WhatsAppBillingSource.Quota
                     && e.Entity.Status != NotificationLogStatus.Failed);

    /// <summary>Kredi miktarını kullanıcıya gösterim için biçimler (tam sayıysa ondalıksız).</summary>
    private static string FormatCredits(decimal credits) =>
        credits == decimal.Truncate(credits)
            ? credits.ToString("N0", System.Globalization.CultureInfo.GetCultureInfo("tr-TR"))
            : credits.ToString("N2", System.Globalization.CultureInfo.GetCultureInfo("tr-TR"));

    private static string CategoryLabel(WhatsAppMessageCategory category) => category switch
    {
        WhatsAppMessageCategory.Utility => "bilgilendirme",
        WhatsAppMessageCategory.Marketing => "kampanya",
        WhatsAppMessageCategory.Authentication => "doğrulama",
        WhatsAppMessageCategory.Service => "yanıt",
        _ => category.ToString(),
    };

    /// <summary>
    /// CÜZDANI KİLİT ALTINDA OKUR — bakiyeye dokunan HER yolun tek giriş kapısı.
    ///
    /// <para>
    /// SOMUT AÇIK: bakiye "oku → bellekte hesapla → yaz" biçiminde güncelleniyordu ve bu servis
    /// hiçbir satır kilidi almıyordu. Bakiye 10 ₺ iken iki eşzamanlı gönderim ikisi de 10 ₺'yi
    /// görüp ikisi de rezerve ediyor, kullanılabilir bakiye EKSİYE düşüyordu; teslim onayı ile
    /// iade yolu da birbirinin yazdığını eziyor (biri Reserved'ı düşürürken diğeri bayat değerin
    /// üstüne yazıyor) ve rezerve tutarı gerçek gönderimlerle tutmuyordu. <c>products</c> ve
    /// <c>gift_cards</c> aynı sınıf için çoktan kilitleniyordu; bu tablo listede bile yoktu.
    /// </para>
    /// <para>
    /// Protokol <see cref="StockService"/> ile aynıdır: (1) satırı kilitle, (2) kilit ALTINDA taze
    /// oku, (3) deltayı uygula. Kilidi çağıran açar; bu metot yalnız "kilitli ve taze" nesneyi
    /// döndürmekle sorumludur.
    /// </para>
    /// <para>
    /// Cüzdan satırı henüz YOKSA kilitlenecek bir şey de yoktur: <c>TenantId</c> benzersiz
    /// indekslidir, dolayısıyla eşzamanlı iki oluşturmadan biri zaten veritabanında elenir.
    /// </para>
    /// </summary>
    private async Task<TenantMessagingWallet> GetOrCreateWalletAsync(Guid tenantId, CancellationToken ct)
    {
        var wallet = await _db.TenantMessagingWallets.IgnoreQueryFilters().FirstOrDefaultAsync(w => w.TenantId == tenantId && !w.IsDeleted, ct);
        if (wallet is null)
        {
            wallet = new TenantMessagingWallet(tenantId);
            _db.TenantMessagingWallets.Add(wallet);
            return wallet;
        }

        if (_db.Database.IsRelational())
        {
            await RowLock.LockRowAsync(_db, "tenant_messaging_wallets", wallet.Id, ct);
            // Kilitten ÖNCE okunmuş olabilir (izleyicide bayat nesne) → kilit altında yeniden oku.
            await _db.Entry(wallet).ReloadAsync(ct);
        }

        return wallet;
    }

    /// <summary>
    /// Bakiye mutasyonunu KENDİ transaction'ında yürütür (çağıran zaten bir transaction açtıysa ona
    /// katılır). Kilit tek başına yetmez: <c>FOR UPDATE</c> yalnız bir transaction içinde tutulur;
    /// otomatik commit modunda kilit sorgu biter bitmez bırakılır ve koruma kâğıt üstünde kalırdı.
    /// </summary>
    private async Task<T> InWalletTransactionAsync<T>(Func<Task<T>> action, CancellationToken ct)
    {
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

        var result = await action();
        if (tx is not null) await tx.CommitAsync(ct);
        return result;
    }

    private async Task<WhatsAppBillingSettings> GetOrCreateBillingSettingsAsync(CancellationToken ct)
    {
        var s = await _db.WhatsAppBillingSettings.FirstOrDefaultAsync(ct);
        if (s is null)
        {
            s = new WhatsAppBillingSettings();
            _db.WhatsAppBillingSettings.Add(s);
            await _db.SaveChangesAsync(ct);
        }
        return s;
    }

    private async Task<MessagingWalletDto> BuildWalletDtoAsync(Guid tenantId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var monthStart = MonthStart(now);
        var billing = await GetOrCreateBillingSettingsAsync(ct);
        var wallet = await _db.TenantMessagingWallets.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(w => w.TenantId == tenantId && !w.IsDeleted, ct);
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        var plan = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.SubscriptionPlan).FirstOrDefaultAsync(ct);

        var utilityUsed = await CountQuotaUsedAsync(tenantId, WhatsAppMessageCategory.Utility, monthStart, ct);
        var marketingUsed = await CountQuotaUsedAsync(tenantId, WhatsAppMessageCategory.Marketing, monthStart, ct);
        var smsUsed = await CountSmsQuotaUsedAsync(tenantId, monthStart, ct);
        var monthlySpent = await MonthlyWalletCommittedAsync(tenantId, monthStart, CreditChannel.WhatsApp, ct);
        var smsMonthlySpent = await MonthlyWalletCommittedAsync(tenantId, monthStart, CreditChannel.Sms, ct);

        var utilityCost = await GetCreditCostAsync(WhatsAppMessageCategory.Utility, now, ct) ?? 0m;
        var marketingCost = await GetCreditCostAsync(WhatsAppMessageCategory.Marketing, now, ct) ?? 0m;

        // WhatsApp ve SMS kredisi ayrı bakiyeler (18 Kas 2026).
        var balance = wallet?.BalanceFor(CreditChannel.WhatsApp) ?? 0m;
        var reserved = wallet?.ReservedFor(CreditChannel.WhatsApp) ?? 0m;
        var available = decimal.Round(balance - reserved, 4);
        var smsBalance = wallet?.BalanceFor(CreditChannel.Sms) ?? 0m;
        var smsReserved = wallet?.ReservedFor(CreditChannel.Sms) ?? 0m;
        var smsAvailable = decimal.Round(smsBalance - smsReserved, 4);
        var estUtility = utilityCost > 0 ? (int)Math.Floor(available / utilityCost) : 0;
        var estSms = billing.SmsCreditsPerPart > 0 ? (int)Math.Floor(smsAvailable / billing.SmsCreditsPerPart) : 0;

        var packages = await _db.WhatsAppCreditPackages.AsNoTracking()
            .Where(p => !p.IsDeleted && p.IsActive)
            .OrderBy(p => p.DisplayOrder).ThenBy(p => p.PriceTry)
            .ToListAsync(ct);

        var cap = ResolveSpendCap(settings, plan, billing);

        return new MessagingWalletDto(
            tenantId, balance, reserved, available,
            wallet?.LifetimeTopUpCredits ?? 0m, wallet?.LifetimeSpentCredits ?? 0m,
            billing.LowBalanceThresholdCredits, available < billing.LowBalanceThresholdCredits,
            utilityUsed, plan?.MaxMonthlyWhatsAppUtility ?? plan?.MaxMonthlyWhatsAppCount ?? 500,
            marketingUsed, plan?.MaxMonthlyWhatsAppMarketing ?? 0,
            smsUsed, plan?.MaxMonthlySmsCount ?? 0,
            monthlySpent, cap,
            settings?.MarketingEnabled ?? false, settings?.AllowWalletOverage ?? false,
            utilityCost, marketingCost, billing.SmsCreditsPerPart,
            estUtility, estSms,
            billing.CreditUnitPriceTry,
            billing.BillingEnabled,
            packages.Select(p => ToPackageDto(p, utilityCost, billing.SmsCreditsPerPart)).ToList(),
            PayOnMaydanoz: await PaysOnMaydanozAsync(ct),
            SmsBalanceCredits: smsBalance,
            SmsReservedCredits: smsReserved,
            SmsAvailableCredits: smsAvailable,
            SmsLifetimeTopUpCredits: wallet?.LifetimeTopUpFor(CreditChannel.Sms) ?? 0m,
            SmsLifetimeSpentCredits: wallet?.LifetimeSpentFor(CreditChannel.Sms) ?? 0m,
            SmsIsLowBalance: smsAvailable < billing.LowBalanceThresholdCredits,
            SmsMonthlySpentCredits: smsMonthlySpent,
            SmsCreditUnitPriceTry: billing.SmsCreditUnitPriceTry);
    }

    /// <summary>Satın alınan kanalın yükleme sonrası bakiyesi (SMS ve WhatsApp kredisi ayrı).</summary>
    private static decimal BalanceOf(MessagingWalletDto wallet, CreditChannel channel) =>
        channel == CreditChannel.Sms ? wallet.SmsBalanceCredits : wallet.BalanceCredits;

    /// <summary>Ödeme sağlayıcısı Maydanoz mu? (Kart ve havale / EFT maydanozasist.com ödeme sayfasında seçilir.)</summary>
    private async Task<bool> PaysOnMaydanozAsync(CancellationToken ct)
    {
        var context = await _gateways.ResolveAsync(ct);
        return context.IsSuccess && context.Value!.Gateway is Payments.MaydanozPaymentGateway;
    }

    private Task<int> CountQuotaUsedAsync(Guid tenantId, WhatsAppMessageCategory category, DateTime monthStart, CancellationToken ct)
        => _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == tenantId && !m.IsDeleted
                          && m.Direction == WhatsAppMessageDirection.Outbound
                          && m.Category == category
                          && m.BillingSource == WhatsAppBillingSource.Quota
                          && m.Status != WhatsAppMessageStatus.Failed
                          && m.CreatedAtUtc >= monthStart, ct);

    private static CreditPackageDto ToPackageDto(WhatsAppCreditPackage p, decimal utilityCost, decimal smsCreditsPerPart)
    {
        var perMessage = p.Channel == CreditChannel.Sms ? smsCreditsPerPart : utilityCost;
        return new(p.Id, p.Name, p.Description, p.PriceTry, p.GrantsCredits, p.DisplayOrder, p.IsActive,
            perMessage > 0 ? (int)Math.Floor(p.GrantsCredits / perMessage) : 0, p.Channel);
    }

    private static WhatsAppPricingRuleDto ToPricingDto(WhatsAppPricingRule r, decimal usdTryRate) =>
        new(r.Id, r.Category, r.MetaUsdPrice, r.CreditCost, r.EffectiveFromUtc, r.Note, r.IsActive,
            decimal.Round(r.MetaUsdPrice * usdTryRate, 4));

    private static WhatsAppBillingSettingsDto ToSettingsDto(WhatsAppBillingSettings s) =>
        new(s.BillingEnabled, s.ChargeSimulated, s.UsdTryRate, s.LowBalanceThresholdCredits, s.DefaultMonthlySpendCapCredits,
            s.AutoApproveTopUps, s.SmsCreditsPerPart, s.CreditUnitPriceTry, s.SmsCreditUnitPriceTry);
}

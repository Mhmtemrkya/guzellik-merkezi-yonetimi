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
/// WhatsApp kontör/faturalama motoru. Tüm sorgular IgnoreQueryFilters + explicit TenantId ile çalışır
/// (arka plan işlerinde tenant kapsamı olmayabilir). Fiyatlar veritabanından (WhatsAppPricingRule) çözülür.
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

        // 2) Kota doldu → kontör bakiyesinden devam (yalnız izin varsa).
        if (!isMarketing && settings is not { AllowWalletOverage: true })
            return BillingDecision.Block(category,
                $"Aylık WhatsApp kotanız doldu ({quotaUsed}/{quotaLimit}). Kontör taşmasını açın ya da üst pakete geçin.");

        var price = await GetSellPriceAsync(category, now, ct);
        if (price is null or <= 0)
            return BillingDecision.Block(category, "WhatsApp birim fiyatı tanımlı değil. Lütfen platform yöneticinizle iletişime geçin.");

        // 3) Aylık harcama tavanı (fatura sürprizi freni).
        var cap = ResolveSpendCap(settings, plan, billing);
        if (cap.HasValue)
        {
            var committed = await MonthlyWalletCommittedAsync(tenantId, monthStart, ct);
            if (committed + price.Value > cap.Value)
                return BillingDecision.Block(category,
                    $"Aylık kontör harcama tavanına ulaşıldı (₺{cap.Value:0.##}). Tavanı yükseltin ya da sonraki ayı bekleyin.");
        }

        // 4) Bakiye rezervasyonu — KİLİT ALTINDA.
        //
        // "Yeter mi?" kontrolü ile rezervasyonun yazılması tek bir atomik adım olmalı: aksi hâlde
        // iki eşzamanlı gönderim aynı bakiyeyi görüp ikisi de geçiyor ve kullanılabilir bakiye
        // eksiye düşüyordu. Rezervasyon BURADA kalıcı yapılır; çağıran (DispatchAsync) mesaj
        // satırını yazana kadar bakiye gerçekten ayrılmış olmalı.
        return await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(tenantId, ct);
            if (!wallet.TryReserve(price.Value))
            {
                return BillingDecision.Block(category,
                    $"Kontör bakiyeniz yetersiz (gerekli ₺{price.Value:0.##}, kullanılabilir ₺{wallet.AvailableTry:0.##}). Kontör yükleyin.");
            }

            await _db.SaveChangesAsync(ct);
            return BillingDecision.Charged(category, price.Value);
        }, ct);
    }

    public Task RefundInlineAsync(Guid tenantId, WhatsAppMessage message, CancellationToken ct = default)
    {
        // Gönderim anında başarısızlık: rezervasyonu geri al ama SaveChanges'i çağırana bırak.
        return ReverseReservationAsync(message, save: false, ct);
    }

    public async Task CaptureAsync(WhatsAppMessage message, CancellationToken ct = default)
    {
        if (message.BillingSource != WhatsAppBillingSource.Wallet || message.ChargedAmountTry <= 0) return;

        await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(message.TenantId, ct);
            wallet.Capture(message.ChargedAmountTry);
            _db.WalletTransactions.Add(new WalletTransaction(
                message.TenantId, WalletTransactionType.Capture, -message.ChargedAmountTry,
                wallet.BalanceTry, wallet.ReservedTry,
                description: $"{message.Category} teslim edildi", category: message.Category, whatsAppMessageId: message.Id));
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
        if (message.BillingSource != WhatsAppBillingSource.Wallet || message.ChargedAmountTry <= 0) return;

        var amount = message.ChargedAmountTry;

        // Çağıran yazmayı üstlendiğinde transaction da onundur; burada ayrı bir transaction açmak
        // iadeyi asıl kayıttan koparırdı.
        if (!save)
        {
            var inlineWallet = await GetOrCreateWalletAsync(message.TenantId, ct);
            inlineWallet.Refund(amount);
            message.ClearCharge(); // tekrar iade edilmesin + aylık taahhüt sayımından düşsün
            return;
        }

        await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(message.TenantId, ct);
            wallet.Refund(amount);
            message.ClearCharge();
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);
    }

    public async Task<int> SweepStaleReservationsAsync(TimeSpan olderThan, CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow - olderThan;
        // Kontör rezerve edilmiş, henüz teslim/başarısız işlenmemiş ve süresi geçmiş mesajlar.
        var stale = await _db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(m => !m.IsDeleted
                     && m.BillingSource == WhatsAppBillingSource.Wallet
                     && m.ChargedAmountTry > 0
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
                    wallet.Refund(m.ChargedAmountTry);
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

    // ==================== KURUM CÜZDANI ====================

    public async Task<Result<MessagingWalletDto>> GetWalletAsync(Guid tenantId, CancellationToken ct = default)
        => Result<MessagingWalletDto>.Success(await BuildWalletDtoAsync(tenantId, ct));

    /// <summary>
    /// Talebin fiyat/kontör/ad üçlüsünü çözer. Havale ve kart yolları AYNI kaynağı kullanmalı:
    /// ikisi ayrı hesaplasaydı, kartla ödenen tutar ile cüzdana yüklenen kontör birbirinden
    /// kayabilirdi (paket fiyatı değiştiğinde sessizce).
    /// </summary>
    private async Task<Result<(decimal Price, decimal Grants, string Name, Guid? PackageId)>> ResolveTopUpAsync(
        TopUpRequest request, CancellationToken ct)
    {
        if (request.CreditPackageId is { } pkgId)
        {
            var pkg = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == pkgId && !p.IsDeleted, ct);
            if (pkg is null || !pkg.IsActive)
                return Result<(decimal, decimal, string, Guid?)>.Failure(Error.NotFound("Kontör paketi bulunamadı."));
            return Result<(decimal, decimal, string, Guid?)>.Success((pkg.PriceTry, pkg.GrantsTry, pkg.Name, pkg.Id));
        }

        if (request.AmountTry is { } amt && amt > 0)
        {
            var rounded = decimal.Round(amt, 2);
            return Result<(decimal, decimal, string, Guid?)>.Success((rounded, rounded, "Özel kontör", null));
        }

        return Result<(decimal, decimal, string, Guid?)>.Failure(Error.Validation("Paket seçin veya tutar girin."));
    }

    public async Task<Result<CreditPurchaseDto>> RequestPurchaseAsync(Guid tenantId, TopUpRequest request, Guid? requestedByUserId, CancellationToken ct = default)
    {
        var resolved = await ResolveTopUpAsync(request, ct);
        if (resolved.IsFailure) return Result<CreditPurchaseDto>.Failure(resolved.Error);
        var (price, grants, name, packageId) = resolved.Value;

        var purchase = new WhatsAppCreditPurchase(tenantId, packageId, name, price, grants, requestedByUserId);
        _db.WhatsAppCreditPurchases.Add(purchase);

        // Otomatik onay açıksa (ör. ödeme ağ geçidi bağlıysa) hemen bakiyeye yansıt.
        var billing = await GetOrCreateBillingSettingsAsync(ct);
        await InWalletTransactionAsync(async () =>
        {
            if (billing.AutoApproveTopUps)
            {
                purchase.Approve(requestedByUserId);
                await CreditWalletAsync(tenantId, grants, $"Kontör: {name}", packageId, requestedByUserId, ct);
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
        var dtos = rows.Select(p => new CreditPurchaseDto(p.Id, p.TenantId, null, p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsTry, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc, p.Provider)).ToList();
        return Result<IReadOnlyCollection<CreditPurchaseDto>>.Success(dtos);
    }

    // ==================== KARTLA KONTÖR ALMA ====================
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
        var (price, grants, name, packageId) = resolved.Value;

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
            tenantId, packageId, name, price, grants, requestedByUserId,
            context.Value!.Gateway.Provider, conversationId);
        _db.WhatsAppCreditPurchases.Add(purchase);
        await _db.SaveChangesAsync(ct);

        var init = await context.Value.Gateway.InitCheckoutAsync(new CheckoutInitRequest(
            conversationId,
            price,
            $"WhatsApp kontörü · {name}",
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
            $"Kontör ödeme formu başlatıldı: {name} · {price:N2} TL", new { name, price, grants }, ct);

        return Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(
            init.Value!.CheckoutToken, init.Value.CheckoutFormContent, init.Value.PaymentPageUrl, price));
    }

    /// <summary>
    /// Sağlayıcı sonucunu BEKLENEN talebe bağlar. "Başarılı" bayrağı tek başına hiçbir şey ifade
    /// etmez: sonuç bizim açtığımız işlem anahtarına, beklediğimiz tutara ve para birimine ait
    /// olmalı, ödeme kimliği bulunmalı ve o kimlik <b>ne başka bir kontör talebine ne de bir
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
            return "Bu sağlayıcı ödeme kimliği başka bir kontör yüklemesine ait; işlem uygulanmadı.";
        }

        // ÇAPRAZ TABLO (bkz. BillingService.DescribeOutcomeMismatchAsync'teki eşi): aynı iyzico
        // ödemesi hem aboneliğe hem kontöre sayılamaz. İki tablo arasında derleme zamanı bağı yok;
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
            _logger.LogError("Kontör ödeme dönüşü eşleşmedi: {ConversationId}", result.ConversationId);
            return Result<CreditCheckoutCompletedDto>.Failure(Error.NotFound("Kontör satın alma kaydı bulunamadı."));
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
                true, "Ödeme zaten alınmıştı.", purchase.GrantsTry, already.BalanceTry));
        }

        if (purchase.Status != CreditPurchaseStatus.Pending)
        {
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false, purchase.Note ?? "Bu kontör talebi zaten kapatılmış.", null, null));
        }

        var nowUtc = DateTime.UtcNow;

        // BELİRSİZ SONUÇ KAYDI KAPATMAZ (denetim bulgusu).
        //
        // SOMUT AÇIK: her başarısız-olmayan sonuç kalıcı Failed yazılıyordu. Oysa 3DS'in ortasında
        // sorulan bir checkout "reddedildi" değil BELİRSİZdir. Müşteri ödemeyi hemen ardından
        // tamamladığında kayıt Failed olduğu için sonraki callback onu yeniden değerlendiremiyor,
        // para çekilmiş olmasına rağmen kontör yüklenmiyordu. Artık yalnız KESİN RED kapatır;
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
                    ? $"Kontör ödemesi reddedildi: {result.ErrorMessage}"
                    : $"Kontör ödemesinin sonucu belirsiz, talep açık bırakıldı: {result.ErrorMessage}",
                new { result.ErrorCode, Outcome = result.Outcome.ToString() }, ct);

            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false,
                declined
                    ? (result.ErrorMessage ?? "Ödeme reddedildi.")
                    : "Ödemenizin sonucu henüz kesinleşmedi. Tahsilat geçerse kontörünüz otomatik yüklenir.",
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
            _logger.LogError("Kontör ödeme dönüşü değişmezlere uymadı ({PurchaseId}): {Reason}", purchase.Id, mismatch);
            await _audit.LogAsync(purchase.TenantId, null, "CreditPaymentRejected", "WhatsAppCredit", purchase.Id,
                $"Kontör ödeme dönüşü reddedildi: {mismatch}", new { purchase.ConversationId, purchase.PriceTry }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(false, mismatch, null, null));
        }

        // Sahiplik + onay + bakiye ORTAK metotta: çözümleme yolu da aynısını uygular.
        var applied = await ApplyVerifiedCreditAsync(
            purchase, context.Value.Gateway.Provider, result.ProviderPaymentId, nowUtc, tx, ct);
        if (applied.IsSuccess && applied.Value!.Succeeded)
        {
            await _audit.LogAsync(purchase.TenantId, null, "CreditPurchased", "WhatsAppCredit", purchase.Id,
                $"Kontör yüklendi: {purchase.PackageName} · {purchase.PriceTry:N2} TL → ₺{purchase.GrantsTry:N2}",
                new { purchase.PackageName, purchase.PriceTry, purchase.GrantsTry }, ct);
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
        if (purchase is null) return Result<CreditCheckoutCompletedDto>.Failure(Error.NotFound("Kontör talebi bulunamadı."));
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
                true, "Ödeme zaten alınmıştı.", purchase.GrantsTry, already.BalanceTry));
        }
        if (purchase.Status != CreditPurchaseStatus.Pending)
        {
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
                false, purchase.Note ?? "Bu kontör talebi zaten kapatılmış.", null, null));
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
                $"Kontör ödemesi sağlayıcıya soruldu: {probe.Value.Outcome}", new { probe.Value.ErrorCode }, ct);
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
                $"Kontör çözümlemesi reddedildi: {mismatch}", new { purchase.ConversationId }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(false, mismatch, null, null));
        }

        var applied = await ApplyVerifiedCreditAsync(
            purchase, context.Value.Gateway.Provider, probe.Value.ProviderPaymentId, nowUtc, tx, ct);
        await _audit.LogAsync(purchase.TenantId, null, "CreditReconciled", "WhatsAppCredit", purchase.Id,
            $"Kontör sağlayıcı sorgusuyla çözüldü: {purchase.PackageName} · {purchase.PriceTry:N2} TL", null, ct);
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
        var claimed = await ProviderPaymentClaims.TryClaimAsync(
            _db, provider, providerPaymentId!, ProviderPaymentClaim.WhatsAppCreditLedger,
            purchase.Id, purchase.TenantId, ct);
        if (!claimed)
        {
            const string reason = "Bu sağlayıcı ödemesi başka bir deftere işlenmiş; kontör yüklenmedi.";
            purchase.MarkPaymentFailed("ClaimConflict", reason, nowUtc);
            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);
            _logger.LogError("Kontör ödemesi sahiplenilemedi ({PurchaseId}); ödeme kimliği başka defterde.", purchase.Id);
            await _audit.LogAsync(purchase.TenantId, null, "CreditPaymentRejected", "WhatsAppCredit", purchase.Id,
                reason, new { purchase.ConversationId, providerPaymentId }, ct);
            return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(false, reason, null, null));
        }

        // ONAY DAMGASI İLE BAKİYE ARTIŞI AYNI KAYITTA: biri olup diğeri olmazsa ya para alınıp
        // kontör yüklenmez ya da aynı tahsilat ikinci kez yüklenebilir.
        purchase.MarkPaidAndApprove(providerPaymentId, nowUtc);
        await CreditWalletAsync(purchase.TenantId, purchase.GrantsTry,
            $"Kontör: {purchase.PackageName}", purchase.CreditPackageId, purchase.RequestedByUserId, ct);
        await _db.SaveChangesAsync(ct);
        // PARA TARAFI ÖNCE KALICI OLUR: denetim kaydı commit'ten sonra gelir, yan iş tahsilatı geri almaz.
        if (tx is not null) await tx.CommitAsync(ct);

        var wallet = await BuildWalletDtoAsync(purchase.TenantId, ct);
        return Result<CreditCheckoutCompletedDto>.Success(new CreditCheckoutCompletedDto(
            true, "Ödeme alındı, kontörünüz yüklendi.", purchase.GrantsTry, wallet.BalanceTry));
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
        var dtos = rows.Select(p => new CreditPurchaseDto(p.Id, p.TenantId, nameMap.GetValueOrDefault(p.TenantId), p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsTry, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc, p.Provider)).ToList();
        return Result<IReadOnlyCollection<CreditPurchaseDto>>.Success(dtos);
    }

    public async Task<Result<CreditPurchaseDto>> ApprovePurchaseAsync(Guid purchaseId, Guid? processedByUserId, CancellationToken ct = default)
    {
        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kontör talebi bulunamadı."));
        // KARTLI TALEP ELLE ONAYLANAMAZ (denetim bulgusu): tahsilat yapılmadan kontör yüklenirdi.
        // Varlıkta da aynı kapı var; burada 409 ile nazik hata döner, orada istisna.
        if (purchase.IsCardCheckout)
        {
            return Result<CreditPurchaseDto>.Failure(Error.Conflict(
                "Bu talep kartla ödeme için açıldı; elle onaylanamaz. Sonucu ödeme sağlayıcısı belirler — " +
                "ödeme takıldıysa 'Sağlayıcıdan sor' ile sonucu doğrulatın."));
        }
        if (purchase.Status != CreditPurchaseStatus.Pending) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        // Talebin "onaylandı" damgası ile bakiyenin artması AYNI kayıtta olmalı: biri olup diğeri
        // olmazsa ya para yüklenmeden talep kapanır ya da aynı talep ikinci kez yüklenebilir.
        await InWalletTransactionAsync(async () =>
        {
            purchase.Approve(processedByUserId);
            await CreditWalletAsync(purchase.TenantId, purchase.GrantsTry, $"Kontör: {purchase.PackageName}", purchase.CreditPackageId, processedByUserId, ct);
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);

        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    public async Task<Result<CreditPurchaseDto>> RejectPurchaseAsync(Guid purchaseId, Guid? processedByUserId, string? note, CancellationToken ct = default)
    {
        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kontör talebi bulunamadı."));
        // Onayla aynı gerekçe: kartlı talebi insan kapatırsa, müşteri ödemeyi sonradan tamamladığında
        // kayıt yeniden değerlendirilemez ve para karşılıksız kalır.
        if (purchase.IsCardCheckout)
        {
            return Result<CreditPurchaseDto>.Failure(Error.Conflict(
                "Bu talep kartla ödeme için açıldı; elle reddedilemez. Sonucu ödeme sağlayıcısı belirler."));
        }
        if (purchase.Status != CreditPurchaseStatus.Pending) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        purchase.Reject(processedByUserId, note);
        await _db.SaveChangesAsync(ct);
        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    /// <summary>Bakiyeyi artıran ortak işlem (TopUp defter kaydı ekler). SaveChanges ÇAĞIRMAZ.</summary>
    private async Task CreditWalletAsync(Guid tenantId, decimal grants, string description, Guid? packageId, Guid? performedByUserId, CancellationToken ct)
    {
        var wallet = await GetOrCreateWalletAsync(tenantId, ct);
        wallet.TopUp(grants);
        _db.WalletTransactions.Add(new WalletTransaction(
            tenantId, WalletTransactionType.TopUp, grants, wallet.BalanceTry, wallet.ReservedTry,
            description: description, creditPackageId: packageId, performedByUserId: performedByUserId));
    }

    private async Task<CreditPurchaseDto> ToPurchaseDtoAsync(WhatsAppCreditPurchase p, CancellationToken ct)
    {
        var name = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == p.TenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);
        return new CreditPurchaseDto(p.Id, p.TenantId, name, p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsTry, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc, p.Provider);
    }

    public async Task<Result<IReadOnlyCollection<WalletTransactionDto>>> GetTransactionsAsync(Guid tenantId, int take, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        var rows = await _db.WalletTransactions.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.TenantId == tenantId && !t.IsDeleted)
            .OrderByDescending(t => t.CreatedAtUtc)
            .Take(take)
            .Select(t => new WalletTransactionDto(t.Id, t.Type, t.AmountTry, t.BalanceAfterTry, t.Description, t.Category, t.CreatedAtUtc))
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
            existing.SetPrices(request.MetaUsdPrice, request.SellPriceTry);
            existing.SetEffectiveFrom(request.EffectiveFromUtc);
            existing.SetNote(request.Note);
            rule = existing;
        }
        else
        {
            rule = new WhatsAppPricingRule(request.Category, request.MetaUsdPrice, request.SellPriceTry, request.EffectiveFromUtc, request.Note);
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

    // ==================== PLATFORM: KONTÖR PAKETLERİ ====================

    public async Task<Result<IReadOnlyCollection<CreditPackageDto>>> GetCreditPackagesAsync(bool includeInactive, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var utilityPrice = await GetSellPriceAsync(WhatsAppMessageCategory.Utility, now, ct) ?? 0m;
        var q = _db.WhatsAppCreditPackages.AsNoTracking().Where(p => !p.IsDeleted);
        if (!includeInactive) q = q.Where(p => p.IsActive);
        var rows = await q.OrderBy(p => p.DisplayOrder).ThenBy(p => p.PriceTry).ToListAsync(ct);
        var dtos = rows.Select(p => ToPackageDto(p, utilityPrice)).ToList();
        return Result<IReadOnlyCollection<CreditPackageDto>>.Success(dtos);
    }

    public async Task<Result<CreditPackageDto>> SaveCreditPackageAsync(Guid? id, SaveCreditPackageRequest request, CancellationToken ct = default)
    {
        WhatsAppCreditPackage pkg;
        if (id is { } pid)
        {
            var existing = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == pid && !p.IsDeleted, ct);
            if (existing is null) return Result<CreditPackageDto>.Failure(Error.NotFound("Kontör paketi bulunamadı."));
            existing.Rename(request.Name);
            existing.SetAmounts(request.PriceTry, request.GrantsTry);
            existing.SetDescription(request.Description);
            existing.SetDisplayOrder(request.DisplayOrder);
            if (request.IsActive) existing.Activate(); else existing.Deactivate();
            pkg = existing;
        }
        else
        {
            pkg = new WhatsAppCreditPackage(request.Name, request.PriceTry, request.GrantsTry, request.DisplayOrder, request.Description);
            if (!request.IsActive) pkg.Deactivate();
            _db.WhatsAppCreditPackages.Add(pkg);
        }
        await _db.SaveChangesAsync(ct);
        var utilityPrice = await GetSellPriceAsync(WhatsAppMessageCategory.Utility, DateTime.UtcNow, ct) ?? 0m;
        return Result<CreditPackageDto>.Success(ToPackageDto(pkg, utilityPrice));
    }

    public async Task<Result> DeleteCreditPackageAsync(Guid id, CancellationToken ct = default)
    {
        var pkg = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == id && !p.IsDeleted, ct);
        if (pkg is null) return Result.Failure(Error.NotFound("Kontör paketi bulunamadı."));
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
        s.Update(request.BillingEnabled, request.ChargeSimulated, request.UsdTryRate, request.LowBalanceThresholdTry, request.DefaultMonthlySpendCapTry, request.AutoApproveTopUps);
        await _db.SaveChangesAsync(ct);
        return Result<WhatsAppBillingSettingsDto>.Success(ToSettingsDto(s));
    }

    public async Task<Result<MessagingWalletDto>> AdjustWalletAsync(Guid tenantId, AdjustWalletRequest request, Guid? performedByUserId, CancellationToken ct = default)
    {
        if (request.DeltaTry == 0) return Result<MessagingWalletDto>.Failure(Error.Validation("Düzeltme tutarı 0 olamaz."));

        // Elle düzeltme de bakiyeyi okuyup yazar: eşzamanlı bir gönderim/yükleme ile yarışırsa
        // biri diğerinin yazdığını ezer. Diğer bakiye yolları ile AYNI kilit protokolünden geçer.
        await InWalletTransactionAsync(async () =>
        {
            var wallet = await GetOrCreateWalletAsync(tenantId, ct);
            wallet.Adjust(request.DeltaTry);
            _db.WalletTransactions.Add(new WalletTransaction(
                tenantId, WalletTransactionType.Adjustment, request.DeltaTry, wallet.BalanceTry, wallet.ReservedTry,
                description: string.IsNullOrWhiteSpace(request.Description) ? "Platform düzeltmesi" : request.Description,
                performedByUserId: performedByUserId));
            await _db.SaveChangesAsync(ct);
            return true;
        }, ct);

        return Result<MessagingWalletDto>.Success(await BuildWalletDtoAsync(tenantId, ct));
    }

    // ==================== YARDIMCILAR ====================

    private async Task<decimal?> GetSellPriceAsync(WhatsAppMessageCategory category, DateTime atUtc, CancellationToken ct)
    {
        var rule = await _db.WhatsAppPricingRules.AsNoTracking()
            .Where(r => !r.IsDeleted && r.IsActive && r.Category == category && r.EffectiveFromUtc <= atUtc)
            .OrderByDescending(r => r.EffectiveFromUtc)
            .FirstOrDefaultAsync(ct);
        return rule?.SellPriceTry;
    }

    private async Task<decimal> MonthlyWalletCommittedAsync(Guid tenantId, DateTime monthStart, CancellationToken ct)
    {
        // Bu ay kontörden karşılanan (rezerve + kesinleşen, başarısız hariç) toplam.
        return await _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == tenantId && !m.IsDeleted
                     && m.BillingSource == WhatsAppBillingSource.Wallet
                     && m.Status != WhatsAppMessageStatus.Failed
                     && m.CreatedAtUtc >= monthStart)
            .SumAsync(m => (decimal?)m.ChargedAmountTry, ct) ?? 0m;
    }

    private static decimal? ResolveSpendCap(WhatsAppSettings? settings, SubscriptionPlan? plan, WhatsAppBillingSettings billing)
    {
        if (settings?.MonthlySpendCapTry is { } tenantCap) return tenantCap;
        if (plan is { DefaultWhatsAppSpendCapTry: > 0 }) return plan.DefaultWhatsAppSpendCapTry;
        return billing.DefaultMonthlySpendCapTry;
    }

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
        var monthlyWalletSpent = await MonthlyWalletCommittedAsync(tenantId, monthStart, ct);

        var utilityPrice = await GetSellPriceAsync(WhatsAppMessageCategory.Utility, now, ct) ?? 0m;
        var marketingPrice = await GetSellPriceAsync(WhatsAppMessageCategory.Marketing, now, ct) ?? 0m;

        var balance = wallet?.BalanceTry ?? 0m;
        var reserved = wallet?.ReservedTry ?? 0m;
        var available = decimal.Round(balance - reserved, 4);
        var estUtility = utilityPrice > 0 ? (int)Math.Floor(available / utilityPrice) : 0;

        var packages = await _db.WhatsAppCreditPackages.AsNoTracking()
            .Where(p => !p.IsDeleted && p.IsActive)
            .OrderBy(p => p.DisplayOrder).ThenBy(p => p.PriceTry)
            .ToListAsync(ct);

        var cap = ResolveSpendCap(settings, plan, billing);

        return new MessagingWalletDto(
            tenantId, balance, reserved, available,
            wallet?.LifetimeTopUpTry ?? 0m, wallet?.LifetimeSpentTry ?? 0m,
            billing.LowBalanceThresholdTry, available < billing.LowBalanceThresholdTry,
            utilityUsed, plan?.MaxMonthlyWhatsAppUtility ?? plan?.MaxMonthlyWhatsAppCount ?? 500,
            marketingUsed, plan?.MaxMonthlyWhatsAppMarketing ?? 0,
            monthlyWalletSpent, cap,
            settings?.MarketingEnabled ?? false, settings?.AllowWalletOverage ?? false,
            utilityPrice, marketingPrice, estUtility,
            billing.BillingEnabled,
            packages.Select(p => ToPackageDto(p, utilityPrice)).ToList());
    }

    private Task<int> CountQuotaUsedAsync(Guid tenantId, WhatsAppMessageCategory category, DateTime monthStart, CancellationToken ct)
        => _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(m => m.TenantId == tenantId && !m.IsDeleted
                          && m.Direction == WhatsAppMessageDirection.Outbound
                          && m.Category == category
                          && m.BillingSource == WhatsAppBillingSource.Quota
                          && m.Status != WhatsAppMessageStatus.Failed
                          && m.CreatedAtUtc >= monthStart, ct);

    private static CreditPackageDto ToPackageDto(WhatsAppCreditPackage p, decimal utilityPrice) =>
        new(p.Id, p.Name, p.Description, p.PriceTry, p.GrantsTry, p.DisplayOrder, p.IsActive,
            utilityPrice > 0 ? (int)Math.Floor(p.GrantsTry / utilityPrice) : 0);

    private static WhatsAppPricingRuleDto ToPricingDto(WhatsAppPricingRule r, decimal usdTryRate) =>
        new(r.Id, r.Category, r.MetaUsdPrice, r.SellPriceTry, r.EffectiveFromUtc, r.Note, r.IsActive,
            decimal.Round(r.MetaUsdPrice * usdTryRate, 4));

    private static WhatsAppBillingSettingsDto ToSettingsDto(WhatsAppBillingSettings s) =>
        new(s.BillingEnabled, s.ChargeSimulated, s.UsdTryRate, s.LowBalanceThresholdTry, s.DefaultMonthlySpendCapTry, s.AutoApproveTopUps);
}

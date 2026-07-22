using GuzellikMerkezi.Application.Common;
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

    public WhatsAppBillingService(GuzellikDbContext db, ILogger<WhatsAppBillingService> logger)
    {
        _db = db;
        _logger = logger;
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

        // 4) Bakiye rezervasyonu.
        var wallet = await GetOrCreateWalletAsync(tenantId, ct);
        if (!wallet.TryReserve(price.Value))
            return BillingDecision.Block(category,
                $"Kontör bakiyeniz yetersiz (gerekli ₺{price.Value:0.##}, kullanılabilir ₺{wallet.AvailableTry:0.##}). Kontör yükleyin.");

        return BillingDecision.Charged(category, price.Value);
    }

    public Task RefundInlineAsync(Guid tenantId, WhatsAppMessage message, CancellationToken ct = default)
    {
        // Gönderim anında başarısızlık: rezervasyonu geri al ama SaveChanges'i çağırana bırak.
        return ReverseReservationAsync(message, save: false, ct);
    }

    public async Task CaptureAsync(WhatsAppMessage message, CancellationToken ct = default)
    {
        if (message.BillingSource != WhatsAppBillingSource.Wallet || message.ChargedAmountTry <= 0) return;

        var wallet = await GetOrCreateWalletAsync(message.TenantId, ct);
        wallet.Capture(message.ChargedAmountTry);
        _db.WalletTransactions.Add(new WalletTransaction(
            message.TenantId, WalletTransactionType.Capture, -message.ChargedAmountTry,
            wallet.BalanceTry, wallet.ReservedTry,
            description: $"{message.Category} teslim edildi", category: message.Category, whatsAppMessageId: message.Id));
        await _db.SaveChangesAsync(ct);
    }

    public Task RefundAsync(WhatsAppMessage message, CancellationToken ct = default)
        => ReverseReservationAsync(message, save: true, ct);

    private async Task ReverseReservationAsync(WhatsAppMessage message, bool save, CancellationToken ct)
    {
        if (message.BillingSource != WhatsAppBillingSource.Wallet || message.ChargedAmountTry <= 0) return;

        var amount = message.ChargedAmountTry;
        var wallet = await GetOrCreateWalletAsync(message.TenantId, ct);
        wallet.Refund(amount);
        message.ClearCharge(); // tekrar iade edilmesin + aylık taahhüt sayımından düşsün
        if (save) await _db.SaveChangesAsync(ct);
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

        foreach (var m in stale)
        {
            var wallet = await GetOrCreateWalletAsync(m.TenantId, ct);
            wallet.Refund(m.ChargedAmountTry);
            m.ClearCharge();
        }
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("{Count} WhatsApp rezervasyonu teslim onayı gelmediği için iade edildi.", stale.Count);
        return stale.Count;
    }

    // ==================== KURUM CÜZDANI ====================

    public async Task<Result<MessagingWalletDto>> GetWalletAsync(Guid tenantId, CancellationToken ct = default)
        => Result<MessagingWalletDto>.Success(await BuildWalletDtoAsync(tenantId, ct));

    public async Task<Result<CreditPurchaseDto>> RequestPurchaseAsync(Guid tenantId, TopUpRequest request, Guid? requestedByUserId, CancellationToken ct = default)
    {
        decimal price, grants;
        string name;
        Guid? packageId = null;

        if (request.CreditPackageId is { } pkgId)
        {
            var pkg = await _db.WhatsAppCreditPackages.FirstOrDefaultAsync(p => p.Id == pkgId && !p.IsDeleted, ct);
            if (pkg is null || !pkg.IsActive) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kontör paketi bulunamadı."));
            price = pkg.PriceTry;
            grants = pkg.GrantsTry;
            name = pkg.Name;
            packageId = pkg.Id;
        }
        else if (request.AmountTry is { } amt && amt > 0)
        {
            price = grants = decimal.Round(amt, 2);
            name = "Özel kontör";
        }
        else
        {
            return Result<CreditPurchaseDto>.Failure(Error.Validation("Paket seçin veya tutar girin."));
        }

        var purchase = new WhatsAppCreditPurchase(tenantId, packageId, name, price, grants, requestedByUserId);
        _db.WhatsAppCreditPurchases.Add(purchase);

        // Otomatik onay açıksa (ör. ödeme ağ geçidi bağlıysa) hemen bakiyeye yansıt.
        var billing = await GetOrCreateBillingSettingsAsync(ct);
        if (billing.AutoApproveTopUps)
        {
            purchase.Approve(requestedByUserId);
            await CreditWalletAsync(tenantId, grants, $"Kontör: {name}", packageId, requestedByUserId, ct);
        }
        await _db.SaveChangesAsync(ct);

        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    public async Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetTenantPurchasesAsync(Guid tenantId, int take, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 100);
        var rows = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.TenantId == tenantId && !p.IsDeleted)
            .OrderByDescending(p => p.CreatedAtUtc).Take(take).ToListAsync(ct);
        var dtos = rows.Select(p => new CreditPurchaseDto(p.Id, p.TenantId, null, p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsTry, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc)).ToList();
        return Result<IReadOnlyCollection<CreditPurchaseDto>>.Success(dtos);
    }

    public async Task<Result<IReadOnlyCollection<CreditPurchaseDto>>> GetPurchasesAsync(bool onlyPending, CancellationToken ct = default)
    {
        var q = _db.WhatsAppCreditPurchases.IgnoreQueryFilters().AsNoTracking().Where(p => !p.IsDeleted);
        if (onlyPending) q = q.Where(p => p.Status == CreditPurchaseStatus.Pending);
        var rows = await q.OrderByDescending(p => p.CreatedAtUtc).Take(200).ToListAsync(ct);
        // NOT: MySql.EntityFrameworkCore Guid listesi .Contains()'i sunucuda çeviremez → tüm kurum adlarını
        // (platform seviyesinde az sayıda) çekip bellekte eşleştir.
        var names = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Select(t => new { t.Id, t.Name }).ToListAsync(ct);
        var nameMap = names.ToDictionary(x => x.Id, x => x.Name);
        var dtos = rows.Select(p => new CreditPurchaseDto(p.Id, p.TenantId, nameMap.GetValueOrDefault(p.TenantId), p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsTry, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc)).ToList();
        return Result<IReadOnlyCollection<CreditPurchaseDto>>.Success(dtos);
    }

    public async Task<Result<CreditPurchaseDto>> ApprovePurchaseAsync(Guid purchaseId, Guid? processedByUserId, CancellationToken ct = default)
    {
        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kontör talebi bulunamadı."));
        if (purchase.Status != CreditPurchaseStatus.Pending) return Result<CreditPurchaseDto>.Failure(Error.Conflict("Bu talep zaten işlenmiş."));

        purchase.Approve(processedByUserId);
        await CreditWalletAsync(purchase.TenantId, purchase.GrantsTry, $"Kontör: {purchase.PackageName}", purchase.CreditPackageId, processedByUserId, ct);
        await _db.SaveChangesAsync(ct);
        return Result<CreditPurchaseDto>.Success(await ToPurchaseDtoAsync(purchase, ct));
    }

    public async Task<Result<CreditPurchaseDto>> RejectPurchaseAsync(Guid purchaseId, Guid? processedByUserId, string? note, CancellationToken ct = default)
    {
        var purchase = await _db.WhatsAppCreditPurchases.IgnoreQueryFilters().FirstOrDefaultAsync(p => p.Id == purchaseId && !p.IsDeleted, ct);
        if (purchase is null) return Result<CreditPurchaseDto>.Failure(Error.NotFound("Kontör talebi bulunamadı."));
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
        return new CreditPurchaseDto(p.Id, p.TenantId, name, p.CreditPackageId, p.PackageName, p.PriceTry, p.GrantsTry, p.Status, p.Note, p.CreatedAtUtc, p.ProcessedAtUtc);
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
        var wallet = await GetOrCreateWalletAsync(tenantId, ct);
        wallet.Adjust(request.DeltaTry);
        _db.WalletTransactions.Add(new WalletTransaction(
            tenantId, WalletTransactionType.Adjustment, request.DeltaTry, wallet.BalanceTry, wallet.ReservedTry,
            description: string.IsNullOrWhiteSpace(request.Description) ? "Platform düzeltmesi" : request.Description,
            performedByUserId: performedByUserId));
        await _db.SaveChangesAsync(ct);
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

    private async Task<TenantMessagingWallet> GetOrCreateWalletAsync(Guid tenantId, CancellationToken ct)
    {
        var wallet = await _db.TenantMessagingWallets.IgnoreQueryFilters().FirstOrDefaultAsync(w => w.TenantId == tenantId && !w.IsDeleted, ct);
        if (wallet is null)
        {
            wallet = new TenantMessagingWallet(tenantId);
            _db.TenantMessagingWallets.Add(wallet);
        }
        return wallet;
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

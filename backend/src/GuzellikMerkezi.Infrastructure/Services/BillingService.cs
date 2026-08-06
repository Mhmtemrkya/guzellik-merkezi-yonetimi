using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Abonelik faturalaması. Para ile ilgili üç değişmez kural:
///
/// <list type="number">
/// <item>ABONELİK YALNIZ TAHSİLAT BAŞARILI OLUNCA AÇILIR — form başlatmak yetmez.</item>
/// <item>HER DENEME KAYITLIDIR (başarılı/başarısız) ve işlem anahtarı benzersizdir; aynı dönem
/// için iki çekim satırı oluşamaz (DB unique indeksi).</item>
/// <item>AĞ HATASI "BAŞARISIZ" DEĞİLDİR: yanıtı kaybedilen çekim, körlemesine tekrar denenmeden
/// önce sağlayıcıya sorulur (<see cref="IPaymentGateway.RetrievePaymentAsync"/>).</item>
/// </list>
/// </summary>
public sealed class BillingService : IBillingService
{
    private readonly GuzellikDbContext _db;
    private readonly IPaymentGatewayResolver _gateways;
    private readonly IEncryptionService _encryption;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<BillingService> _logger;

    /// <summary>Bir fatura dönemi için en fazla bu kadar çekim denenir; sonra kurum askıya alınır.</summary>
    public const int MaxRenewalAttempts = 3;

    /// <summary>Başarısız denemeler arasındaki en az bekleme (kart düzeltmek için makul süre).</summary>
    private static readonly TimeSpan RetrySpacing = TimeSpan.FromHours(24);

    /// <summary>Vade bu kadar önce tahsil edilmeye başlanır; üç deneme vade gelmeden tamamlanır.</summary>
    public static readonly TimeSpan RenewalLeadTime = TimeSpan.FromDays(3);

    /// <summary>Paket fiyatları KDV DAHİL liste fiyatıdır; fatura brütten kurulur, KDV türetilir.</summary>
    private const decimal DefaultVatRate = 0.20m;

    public BillingService(
        GuzellikDbContext db,
        IPaymentGatewayResolver gateways,
        IEncryptionService encryption,
        IAuditLogger audit,
        IFeatureService features,
        ICurrentUser currentUser,
        ILogger<BillingService> logger)
    {
        _db = db;
        _gateways = gateways;
        _encryption = encryption;
        _audit = audit;
        _features = features;
        _currentUser = currentUser;
        _logger = logger;
    }

    // ---- Okuma ----------------------------------------------------------------------------

    public async Task<Result<BillingSummaryDto>> GetSummaryAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<BillingSummaryDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var card = await ActiveCardQuery(tenantId).AsNoTracking().FirstOrDefaultAsync(ct);
        var invoices = await InvoiceQuery(tenantId).AsNoTracking().Take(6).ToListAsync(ct);
        var settings = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);

        return Result<BillingSummaryDto>.Success(new BillingSummaryDto(
            tenant.Id,
            tenant.SubscriptionPlan?.Name ?? tenant.Plan,
            tenant.SubscriptionPlanId,
            tenant.SubscriptionPeriod?.ToString(),
            tenant.SubscriptionEndsAtUtc,
            tenant.TrialEndsAtUtc,
            tenant.Status.ToString(),
            settings?.PaymentsEnabled ?? false,
            card is not null && tenant.SubscriptionPeriod.HasValue,
            card is null ? null : ToCardDto(card),
            invoices.Select(ToInvoiceDto).ToList()));
    }

    public async Task<Result<IReadOnlyList<BillingInvoiceDto>>> ListInvoicesAsync(Guid tenantId, CancellationToken ct = default)
    {
        var invoices = await InvoiceQuery(tenantId).AsNoTracking().ToListAsync(ct);
        return Result<IReadOnlyList<BillingInvoiceDto>>.Success(invoices.Select(ToInvoiceDto).ToList());
    }

    // ---- Ödeme formu ----------------------------------------------------------------------

    public async Task<Result<CheckoutStartedDto>> StartCheckoutAsync(Guid tenantId, Guid subscriptionPlanId, BillingPeriod period, string callbackUrl, CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<CheckoutStartedDto>.Failure(context.Error);

        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<CheckoutStartedDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var plan = await _db.SubscriptionPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == subscriptionPlanId, ct);
        if (plan is null) return Result<CheckoutStartedDto>.Failure(Error.NotFound("Paket bulunamadı."));
        if (!plan.IsActive) return Result<CheckoutStartedDto>.Failure(Error.Conflict("Pasif pakete geçilemez."));

        var amount = PriceFor(plan, period);
        if (amount <= 0)
        {
            return Result<CheckoutStartedDto>.Failure(Error.Validation(
                "Bu paket için ödeme gerekmiyor. Ücretsiz paketler doğrudan atanır."));
        }

        if (string.IsNullOrWhiteSpace(callbackUrl))
        {
            return Result<CheckoutStartedDto>.Failure(Error.Conflict(
                "Ödeme dönüş adresi belirlenemedi. Platform yöneticisi ödeme ayarlarını kontrol etmeli."));
        }

        var conversationId = $"chk-{tenantId:N}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
        var existingCard = await ActiveCardQuery(tenantId).AsNoTracking().FirstOrDefaultAsync(ct);

        // Ödeme kaydı ÖNCE yazılır: sağlayıcı dönüşü (callback) bu satırı işlem anahtarıyla bulur.
        // Sonra yazsaydık, hızlı dönen bir callback karşılığını bulamayıp ödemeyi kayıtsız bırakırdı.
        var payment = new SubscriptionPayment(
            tenantId, plan.Id, period, amount, context.Value!.Gateway.Provider, conversationId, attemptNumber: 1);
        _db.SubscriptionPayments.Add(payment);
        await _db.SaveChangesAsync(ct);

        var init = await context.Value.Gateway.InitCheckoutAsync(new CheckoutInitRequest(
            conversationId,
            amount,
            $"{plan.Name} · {(period == BillingPeriod.Yearly ? "Yıllık" : "Aylık")} abonelik",
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
            _encryption.Decrypt(existingCard?.CardUserKeyEncrypted)), ct);

        if (init.IsFailure)
        {
            payment.MarkFailed("INIT_FAILED", init.Error.Message, DateTime.UtcNow);
            await _db.SaveChangesAsync(ct);
            return Result<CheckoutStartedDto>.Failure(init.Error);
        }

        await _audit.LogAsync(tenantId, null, "CheckoutStarted", "Subscription", payment.Id,
            $"Ödeme formu başlatıldı: {plan.Name} · {amount:N2} TL", new { plan.Name, amount, period = period.ToString() }, ct);

        return Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(
            init.Value!.CheckoutToken, init.Value.CheckoutFormContent, init.Value.PaymentPageUrl, amount));
    }

    /// <summary>
    /// Değişmezlere UYMAYAN ödeme dönüşünü reddeder: ödeme başarısız işaretlenir, abonelik
    /// BAŞLATILMAZ ve denetim kaydı yazılır. Sessizce "başarılı" saymak, tutarı/sağlayıcısı
    /// tutmayan bir dönüşle ücretli aboneliğin açılması demekti.
    /// </summary>
    private async Task<Result<CheckoutCompletedDto>> RejectMismatchedCallbackAsync(
        SubscriptionPayment payment, string reason, DateTime nowUtc, CancellationToken ct)
    {
        payment.MarkFailed("CallbackMismatch", reason, nowUtc);
        await _db.SaveChangesAsync(ct);
        _logger.LogError("Ödeme dönüşü değişmezlere uymadı ({PaymentId}): {Reason}", payment.Id, reason);
        await _audit.LogAsync(payment.TenantId, null, "PaymentRejected", "Subscription", payment.Id,
            $"Ödeme dönüşü reddedildi: {reason}", new { payment.ConversationId, payment.AmountTRY, payment.Provider }, ct);
        return Result<CheckoutCompletedDto>.Success(new CheckoutCompletedDto(false, reason, null, null));
    }

    public async Task<Result<CheckoutCompletedDto>> CompleteCheckoutAsync(string checkoutToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(checkoutToken))
            return Result<CheckoutCompletedDto>.Failure(Error.Validation("Ödeme anahtarı eksik."));

        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<CheckoutCompletedDto>.Failure(context.Error);

        var retrieved = await context.Value!.Gateway.RetrieveCheckoutAsync(checkoutToken, ct);
        if (retrieved.IsFailure) return Result<CheckoutCompletedDto>.Failure(retrieved.Error);

        var result = retrieved.Value!;
        var payment = await _db.SubscriptionPayments
            .FirstOrDefaultAsync(p => p.ConversationId == result.ConversationId, ct);
        if (payment is null)
        {
            _logger.LogError("Ödeme dönüşü eşleşmedi: {ConversationId}", result.ConversationId);
            return Result<CheckoutCompletedDto>.Failure(Error.NotFound("Ödeme kaydı bulunamadı."));
        }

        // İDEMPOTENT: kullanıcı dönüş sayfasını yenilerse ya da webhook aynı anda gelirse
        // abonelik ikinci kez uzatılmamalı.
        if (payment.Status == SubscriptionPayment.Succeeded)
        {
            var already = await _db.Tenants.AsNoTracking().Include(t => t.SubscriptionPlan)
                .FirstOrDefaultAsync(t => t.Id == payment.TenantId, ct);
            return Result<CheckoutCompletedDto>.Success(new CheckoutCompletedDto(
                true, "Ödeme zaten alınmıştı.", already?.SubscriptionEndsAtUtc, already?.SubscriptionPlan?.Name));
        }

        var nowUtc = DateTime.UtcNow;
        if (!result.Succeeded)
        {
            payment.MarkFailed(result.ErrorCode, result.ErrorMessage, nowUtc);
            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(payment.TenantId, null, "PaymentFailed", "Subscription", payment.Id,
                $"Ödeme başarısız: {result.ErrorMessage}", new { result.ErrorCode }, ct);
            return Result<CheckoutCompletedDto>.Success(new CheckoutCompletedDto(
                false, result.ErrorMessage ?? "Ödeme tamamlanamadı.", null, null));
        }

        // ---- ÖDEME DÖNÜŞÜ DEĞİŞMEZLERE BAĞLANIR ----
        //
        // Sonuç yalnız ConversationId ile eşleştirilip "başarılı" bayrağına güveniliyordu: dönüşte
        // gelen TUTARIN, SAĞLAYICININ ve ödeme kimliğinin beklenenle ilişkisi hiç doğrulanmıyordu.
        // Somut sonuç: 0,01 TL'lik bir sonuç yüksek tutarlı bekleyen bir checkout'u "ödendi" yapıp
        // aboneliği başlatabiliyor; aynı sağlayıcı ödeme kimliği birden çok kayda yazılabiliyordu.
        // Bu kontroller ABONELİK BAŞLATILMADAN önce çalışır ve ödeme başarısız işaretlenir.
        var expectedProvider = context.Value.Gateway.Provider;
        if (!string.Equals(payment.Provider, expectedProvider, StringComparison.OrdinalIgnoreCase))
        {
            return await RejectMismatchedCallbackAsync(payment,
                $"Ödeme sağlayıcısı uyuşmuyor (beklenen {payment.Provider}, dönen {expectedProvider}).", nowUtc, ct);
        }

        // PARA BİRİMİ DE DOĞRULANIR — tutar tek başına yetmez.
        //
        // İstek TRY gönderiyor ama SONUÇ başka bir birimde dönebilir; yalnız sayıya bakan kontrol
        // "100 USD"yi "100 TL" sanıp aboneliği açardı. Sağlayıcı birim bildirmiyorsa (boş) eski
        // davranış korunur: bu üründe tüm akış TRY'dir ve tutar zaten karşılaştırılmıştır.
        if (!string.IsNullOrWhiteSpace(result.Currency)
            && !string.Equals(result.Currency, "TRY", StringComparison.OrdinalIgnoreCase))
        {
            return await RejectMismatchedCallbackAsync(payment,
                $"Ödeme para birimi uyuşmuyor (beklenen TRY, dönen {result.Currency}).", nowUtc, ct);
        }

        if (result.PaidAmountTry != payment.AmountTRY)
        {
            return await RejectMismatchedCallbackAsync(payment,
                $"Ödeme tutarı uyuşmuyor (beklenen {payment.AmountTRY:N2} TL, dönen {result.PaidAmountTry:N2} TL).", nowUtc, ct);
        }

        if (string.IsNullOrWhiteSpace(result.ProviderPaymentId))
        {
            return await RejectMismatchedCallbackAsync(payment,
                "Sağlayıcı ödeme kimliği dönmedi; ödeme doğrulanamadı.", nowUtc, ct);
        }

        // AYNI SAĞLAYICI ÖDEME KİMLİĞİ İKİNCİ BİR KAYDA YAZILAMAZ (replay koruması).
        if (await _db.SubscriptionPayments.AsNoTracking()
                .AnyAsync(p => p.Id != payment.Id && p.ProviderPaymentId == result.ProviderPaymentId, ct))
        {
            return await RejectMismatchedCallbackAsync(payment,
                "Bu sağlayıcı ödeme kimliği başka bir ödemeye ait; işlem uygulanmadı.", nowUtc, ct);
        }

        var tenant = await _db.Tenants.Include(t => t.SubscriptionPlan).FirstOrDefaultAsync(t => t.Id == payment.TenantId, ct);
        if (tenant is null) return Result<CheckoutCompletedDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var plan = payment.SubscriptionPlanId is { } planId
            ? await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == planId, ct)
            : null;
        if (plan is null) return Result<CheckoutCompletedDto>.Failure(Error.NotFound("Paket bulunamadı."));

        await StoreCardAsync(payment.TenantId, context.Value.Gateway.Provider, result, ct);

        payment.MarkSucceeded(result.ProviderPaymentId, nowUtc);
        var invoice = await CreatePaidInvoiceAsync(tenant, plan, payment.Period, payment.AmountTRY,
            nowUtc, nowUtc, result.ProviderPaymentId, ct);
        payment.AttachInvoice(invoice.Id);

        tenant.StartSubscription(plan, payment.Period, nowUtc);
        await _db.SaveChangesAsync(ct);
        _features.InvalidateTenant(tenant.Id);

        await _audit.LogAsync(tenant.Id, null, "SubscriptionActivated", "Subscription", payment.Id,
            $"Abonelik başlatıldı: {plan.Name} · {payment.AmountTRY:N2} TL · fatura {invoice.Number}",
            new { plan.Name, payment.AmountTRY, invoice.Number }, ct);

        return Result<CheckoutCompletedDto>.Success(new CheckoutCompletedDto(
            true, "Ödeme alındı, aboneliğiniz aktif.", tenant.SubscriptionEndsAtUtc, plan.Name));
    }

    // ---- Kart -----------------------------------------------------------------------------

    public async Task<Result> RemoveCardAsync(Guid tenantId, CancellationToken ct = default)
    {
        var cards = await ActiveCardQuery(tenantId).ToListAsync(ct);
        if (cards.Count == 0) return Result.Success();
        foreach (var card in cards) card.Deactivate();
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(tenantId, null, "CardRemoved", "Subscription", null,
            "Saklı kart kaldırıldı; otomatik yenileme durdu.", null, ct);
        return Result.Success();
    }

    // ---- Yenileme -------------------------------------------------------------------------

    public async Task<Result<RenewalOutcomeDto>> ChargeRenewalAsync(Guid tenantId, CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<RenewalOutcomeDto>.Failure(context.Error);

        var tenant = await _db.Tenants.Include(t => t.SubscriptionPlan).FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<RenewalOutcomeDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        if (tenant.SubscriptionPlanId is not { } planId || tenant.SubscriptionPeriod is not { } period)
            return Result<RenewalOutcomeDto>.Failure(Error.Conflict("Kurumun ücretli aboneliği yok."));

        var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == planId, ct);
        if (plan is null) return Result<RenewalOutcomeDto>.Failure(Error.NotFound("Paket bulunamadı."));

        var card = await ActiveCardQuery(tenantId).FirstOrDefaultAsync(ct);
        if (card is null)
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(false, 0, "Kayıtlı kart yok.", tenant.SubscriptionEndsAtUtc));

        var amount = PriceFor(plan, period);
        if (amount <= 0)
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(false, 0, "Ücretsiz pakette tahsilat yapılmaz.", tenant.SubscriptionEndsAtUtc));

        // VADESİ GELMEDEN TAHSİLAT YAPILMAZ. Tarayıcı zaten vadeye yaklaşanları seçiyor ama karar
        // SERVİSE ait olmalı: kuyruk aynı işi yeniden deneyebilir, iş iki kez sıraya girebilir ya
        // da tahsilat elle tetiklenebilir. Bu kontrol olmadan, başarılı bir yenilemenin hemen
        // ardından gelen ikinci çağrı BİR SONRAKİ dönemin parasını bir ay erken çekiyordu:
        // dönem anahtarı ileri kaydığı için "bu dönem zaten tahsil edildi" freni de devreye girmiyordu.
        if (tenant.SubscriptionEndsAtUtc is { } dueAt && dueAt > DateTime.UtcNow + RenewalLeadTime)
        {
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(
                false, 0, "Aboneliğin yenileme zamanı henüz gelmedi.", tenant.SubscriptionEndsAtUtc));
        }

        // Dönem anahtarı: aynı dönem için açılan tüm denemeler bu ön ekle gruplanır.
        var periodStart = tenant.SubscriptionEndsAtUtc ?? DateTime.UtcNow;
        var prefix = $"sub-{tenantId:N}-{periodStart:yyyyMMdd}";
        var attempts = await _db.SubscriptionPayments
            .Where(p => p.TenantId == tenantId && p.ConversationId.StartsWith(prefix))
            .ToListAsync(ct);

        if (attempts.Any(a => a.Status == SubscriptionPayment.Succeeded))
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(false, 0, "Bu dönem zaten tahsil edilmiş.", tenant.SubscriptionEndsAtUtc));

        // YANITI KAYBEDİLEN DENEME: körlemesine tekrar denemeden ÖNCE sağlayıcıya sorulur.
        // Aksi halde parası çekilmiş bir dönem ikinci kez çekilebilirdi.
        var pending = attempts.FirstOrDefault(a => a.Status == SubscriptionPayment.Pending);
        if (pending is not null)
        {
            var probe = await context.Value!.Gateway.RetrievePaymentAsync(pending.ConversationId, ct);
            if (probe.IsSuccess && probe.Value!.Succeeded)
            {
                pending.MarkSucceeded(probe.Value.ProviderPaymentId, DateTime.UtcNow);
                var recovered = await FinalizeRenewalAsync(tenant, plan, pending, probe.Value.ProviderPaymentId, ct);
                return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(
                    true, pending.AttemptNumber, "Önceki deneme başarılıymış; abonelik uzatıldı.", recovered));
            }
            pending.MarkFailed("UNRESOLVED", "Önceki deneme doğrulanamadı.", DateTime.UtcNow);
            await _db.SaveChangesAsync(ct);
        }

        // DENEMELER ARASINDA BEKLEME: tarayıcı birkaç saatte bir çalışır; aralık koymazsak üç deneme
        // birkaç saat içinde tükenir ve kurum, kartını düzeltmeye fırsat bulamadan askıya alınır.
        var lastFailed = attempts.Where(a => a.Status == SubscriptionPayment.Failed)
            .OrderByDescending(a => a.CompletedAtUtc ?? a.CreatedAtUtc)
            .FirstOrDefault();
        if (lastFailed is not null && (lastFailed.CompletedAtUtc ?? lastFailed.CreatedAtUtc) > DateTime.UtcNow - RetrySpacing)
        {
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(
                false, lastFailed.AttemptNumber, "Bir sonraki tahsilat denemesi için bekleniyor.", tenant.SubscriptionEndsAtUtc));
        }

        var attemptNumber = attempts.Count == 0 ? 1 : attempts.Max(a => a.AttemptNumber) + 1;
        if (attemptNumber > MaxRenewalAttempts)
        {
            if (tenant.Status == TenantStatus.Active)
            {
                tenant.Suspend();
                await _db.SaveChangesAsync(ct);
                _features.InvalidateTenant(tenant.Id);
                await _audit.LogAsync(tenantId, null, "SubscriptionSuspended", "Subscription", null,
                    $"{MaxRenewalAttempts} denemede tahsilat yapılamadı; kurum askıya alındı.", null, ct);
            }
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(
                false, attemptNumber - 1, "Tahsilat denemeleri tükendi; abonelik askıya alındı.", tenant.SubscriptionEndsAtUtc));
        }

        var conversationId = $"{prefix}-a{attemptNumber}";
        var payment = new SubscriptionPayment(
            tenantId, plan.Id, period, amount, context.Value!.Gateway.Provider, conversationId, attemptNumber,
            tenantPaymentMethodId: card.Id);
        _db.SubscriptionPayments.Add(payment);
        await _db.SaveChangesAsync(ct);

        var charge = await context.Value.Gateway.ChargeStoredCardAsync(new StoredCardChargeRequest(
            conversationId,
            amount,
            $"{plan.Name} · {(period == BillingPeriod.Yearly ? "Yıllık" : "Aylık")} abonelik",
            _encryption.Decrypt(card.CardUserKeyEncrypted) ?? string.Empty,
            _encryption.Decrypt(card.CardTokenEncrypted) ?? string.Empty,
            tenantId.ToString("N"),
            tenant.OwnerName ?? tenant.Name,
            "Yetkili",
            tenant.Email ?? string.Empty,
            tenant.Phone ?? string.Empty,
            tenant.TaxNumber ?? string.Empty,
            tenant.LegalName ?? tenant.Name,
            "İstanbul",
            "127.0.0.1"), ct);

        var now = DateTime.UtcNow;
        if (charge.IsFailure)
        {
            // Ağ/altyapı hatası: deneme PENDING kalır ki sonraki tur sağlayıcıya sorup çözsün.
            _logger.LogWarning("Yenileme tahsilatı doğrulanamadı: {Tenant} {Conversation}", tenantId, conversationId);
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(
                false, attemptNumber, "Sağlayıcıya ulaşılamadı; işlem sonraki turda doğrulanacak.", tenant.SubscriptionEndsAtUtc));
        }

        if (!charge.Value!.Succeeded)
        {
            payment.MarkFailed(charge.Value.ErrorCode, charge.Value.ErrorMessage, now);
            card.MarkChargeFailed();
            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(tenantId, null, "RenewalFailed", "Subscription", payment.Id,
                $"Yenileme tahsilatı başarısız ({attemptNumber}. deneme): {charge.Value.ErrorMessage}",
                new { charge.Value.ErrorCode, attemptNumber }, ct);
            return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(
                false, attemptNumber, charge.Value.ErrorMessage ?? "Tahsilat yapılamadı.", tenant.SubscriptionEndsAtUtc));
        }

        payment.MarkSucceeded(charge.Value.ProviderPaymentId, now);
        card.MarkCharged(now);
        var endsAt = await FinalizeRenewalAsync(tenant, plan, payment, charge.Value.ProviderPaymentId, ct);
        return Result<RenewalOutcomeDto>.Success(new RenewalOutcomeDto(true, attemptNumber, "Abonelik yenilendi.", endsAt));
    }

    /// <summary>Başarılı yenileme sonrası: fatura üret, aboneliği uzat, önbelleği tazele.</summary>
    private async Task<DateTime?> FinalizeRenewalAsync(
        Tenant tenant, SubscriptionPlan plan, SubscriptionPayment payment, string? providerPaymentId, CancellationToken ct)
    {
        var nowUtc = DateTime.UtcNow;

        // YENİLEME KALDIĞI YERDEN DEVAM EDER. Tahsilat vadeden birkaç gün ÖNCE yapıldığı için
        // yeni dönemi "şimdi"den başlatmak kalan günleri yakardı (kurum ödediği süreyi kaybederdi).
        // Abonelik zaten geçmişse (askıda kalmışsa) geçmişe dönük dönem açmamak için bugünden başlar.
        var periodStart = tenant.SubscriptionEndsAtUtc is { } currentEnd && currentEnd > nowUtc ? currentEnd : nowUtc;

        var invoice = await CreatePaidInvoiceAsync(tenant, plan, payment.Period, payment.AmountTRY, periodStart, nowUtc, providerPaymentId, ct);
        payment.AttachInvoice(invoice.Id);
        tenant.StartSubscription(plan, payment.Period, periodStart);
        await _db.SaveChangesAsync(ct);
        _features.InvalidateTenant(tenant.Id);
        await _audit.LogAsync(tenant.Id, null, "SubscriptionRenewed", "Subscription", payment.Id,
            $"Abonelik yenilendi: {plan.Name} · {payment.AmountTRY:N2} TL · fatura {invoice.Number}",
            new { plan.Name, payment.AmountTRY, invoice.Number }, ct);
        return tenant.SubscriptionEndsAtUtc;
    }

    // ---- Yardımcılar ----------------------------------------------------------------------

    private IQueryable<TenantPaymentMethod> ActiveCardQuery(Guid tenantId) =>
        _db.TenantPaymentMethods.Where(c => c.TenantId == tenantId && c.IsActive)
            .OrderByDescending(c => c.CreatedAtUtc);

    private IQueryable<TenantInvoice> InvoiceQuery(Guid tenantId) =>
        _db.TenantInvoices.Where(i => i.TenantId == tenantId).OrderByDescending(i => i.IssuedAtUtc);

    private static decimal PriceFor(SubscriptionPlan plan, BillingPeriod period) =>
        period == BillingPeriod.Yearly ? plan.YearlyPriceTRY : plan.MonthlyPriceTRY;

    private async Task StoreCardAsync(Guid tenantId, string provider, CheckoutResult result, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(result.CardUserKey) || string.IsNullOrWhiteSpace(result.CardToken)) return;

        // Kurum başına tek AKTİF kart: eskisi pasifleşir, satır korunur (hangi kartla çekildiği izlenebilsin).
        foreach (var old in await ActiveCardQuery(tenantId).ToListAsync(ct)) old.Deactivate();

        _db.TenantPaymentMethods.Add(new TenantPaymentMethod(
            tenantId,
            provider,
            _encryption.Encrypt(result.CardUserKey)!,
            _encryption.Encrypt(result.CardToken)!,
            result.MaskedCardNumber,
            result.CardAssociation,
            result.CardFamily,
            result.CardBankName));
    }

    private async Task<TenantInvoice> CreatePaidInvoiceAsync(
        Tenant tenant, SubscriptionPlan plan, BillingPeriod period, decimal amount,
        DateTime periodStart, DateTime nowUtc, string? providerPaymentId, CancellationToken ct)
    {
        var periodEnd = period == BillingPeriod.Yearly ? periodStart.AddYears(1) : periodStart.AddMonths(1);
        var number = await NextInvoiceNumberAsync(nowUtc, ct);
        var invoice = new TenantInvoice(tenant.Id, number, periodStart, periodEnd, amount,
            $"{plan.Name} · {(period == BillingPeriod.Yearly ? "Yıllık" : "Aylık")} abonelik");
        invoice.SetVatRate(DefaultVatRate);
        invoice.MarkPaid(nowUtc, providerPaymentId);
        _db.TenantInvoices.Add(invoice);
        return invoice;
    }

    /// <summary>
    /// Yıllık seri: BA-2026-000123. Numara benzersiz indekslidir; eşzamanlı iki fatura aynı
    /// numarayı hesaplayabileceği için çağıran <c>SaveChanges</c> çakışmasında yeniden dener.
    /// </summary>
    private async Task<string> NextInvoiceNumberAsync(DateTime nowUtc, CancellationToken ct)
    {
        var prefix = $"BA-{nowUtc:yyyy}-";
        var used = await _db.TenantInvoices.IgnoreQueryFilters()
            .Where(i => i.Number.StartsWith(prefix))
            .CountAsync(ct);
        for (var i = 1; i <= 50; i++)
        {
            var candidate = $"{prefix}{(used + i):000000}";
            var exists = await _db.TenantInvoices.IgnoreQueryFilters().AnyAsync(x => x.Number == candidate, ct);
            if (!exists) return candidate;
        }
        return $"{prefix}{Guid.NewGuid():N}"[..24];
    }

    private static StoredCardDto ToCardDto(TenantPaymentMethod c) => new(
        c.Id, c.MaskedNumber, c.Association, c.Family, c.BankName, c.LastChargedAtUtc, c.ConsecutiveFailureCount);

    private static BillingInvoiceDto ToInvoiceDto(TenantInvoice i) => new(
        i.Id, i.Number, i.PeriodStartUtc, i.PeriodEndUtc, i.AmountTRY, i.NetAmountTRY, i.VatAmountTRY,
        i.VatRate, i.Status, i.IssuedAtUtc, i.DueDateUtc, i.PaidAtUtc);
}

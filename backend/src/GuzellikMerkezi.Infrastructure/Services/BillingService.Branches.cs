using System.Text.Json;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// DÖNEM ORTASINDA EKLENEN ŞUBE — orantılı ücret saklı karttan HEMEN çekilir.
///
/// <para>
/// Yenilemedeki para değişmezlerinin AYNISI uygulanır: (1) ödeme satırı (açılacak şubenin bilgisiyle)
/// sağlayıcıdan ÖNCE yazılır; (2) "başarılı" sonucu tutar/para birimi/işlem anahtarıyla doğrulanır ve
/// sağlayıcı ödeme kimliği sahiplenilir; (3) şube, fatura ve ödeme AYNI işlemde kalıcı olur;
/// (4) sonucu belirsiz çekimde şube açılmaz, satır bekler ve tekrar çekilmez — sonraki istek ya da
/// arka plan taraması sağlayıcıya sorup sonuçlandırır (başarılıysa şubeyi satırdaki bilgiden açar).
/// </para>
/// <para>
/// Ücret ASLA sessizce çekilmez: istek, kullanıcının teklif ekranında onayladığı tutarı taşımalıdır.
/// </para>
/// <para>
/// KARTSIZ KURUM (ödeme altyapısı kapalı ya da kayıtlı kart yok — platformun elle ücretli dönem
/// açtığı kurum): şube ENGELLENMEZ; aynı orantılı tutar için AÇIK (Sent) fatura şubeyle aynı işlemde
/// kesilir, tahsilatı platform yapar. Kart reddi / belirsiz sonuç bu yola ASLA düşmez.
/// </para>
/// </summary>
public sealed partial class BillingService
{
    /// <summary>Bu yaştan genç bekleyen şube ödemesi yeni şube çekimini engeller (çift çekim olmasın).</summary>
    private static readonly TimeSpan BranchChargeBlockWindow = TimeSpan.FromHours(24);

    /// <summary>Arka plan taraması yalnız bu kadar eski bekleyenleri sorar (taze olanı kullanıcı akışı sonuçlandırır).</summary>
    private static readonly TimeSpan BranchChargeProbeAfter = TimeSpan.FromMinutes(2);

    private static readonly JsonSerializerOptions PayloadJson = new(JsonSerializerDefaults.Web);

    private sealed record BranchPayload(string Name, string City, bool IsDefault);

    /// <param name="PeriodEndUtc">Ücretin kapsadığı dönemin sonu (açık faturanın dönem sonu).</param>
    private sealed record BranchChargeEvaluation(
        bool Required, bool CanPurchase, string? Reason, SubscriptionQuote? Quote,
        SubscriptionPlan? Plan, TenantPaymentMethod? Card, bool PendingExists, string Method,
        DateTime? PeriodEndUtc = null);

    public async Task<Result<BranchChargeQuoteDto>> GetBranchChargeQuoteAsync(Guid tenantId, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (tenant is null) return Result<BranchChargeQuoteDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var e = await EvaluateBranchChargeAsync(tenant, ct);
        var gateway = await _gateways.ResolveAsync(ct);
        return Result<BranchChargeQuoteDto>.Success(new BranchChargeQuoteDto(
            e.Required, e.CanPurchase, e.Reason, e.Quote, AsUtc(tenant.SubscriptionEndsAtUtc), e.Card?.MaskedNumber, e.Method,
            await BranchImpactAsync(tenant, ct),
            InvoicePayOnline: gateway.IsSuccess && gateway.Value!.Gateway is Payments.MaydanozPaymentGateway));
    }

    /// <summary>Bir şube daha eklenince paket tutarı (deneme dahil). Şube başına olmayan pakette null.</summary>
    private async Task<BranchImpactDto?> BranchImpactAsync(Tenant tenant, CancellationToken ct)
    {
        var plan = tenant.SubscriptionPlan;
        if (plan is null || !plan.ChargePerBranch) return null;
        var counts = await BillingCountsQuery.CountAsync(_db, tenant.Id, ct);
        var next = counts with { Branches = counts.Branches + 1 };
        var current = SubscriptionPricing.Quote(plan, BillingPeriod.Monthly, counts);
        return new BranchImpactDto(
            plan.Name,
            tenant.Status == TenantStatus.Trial,
            counts.Branches,
            SubscriptionPricing.UnitPrice(plan, BillingPeriod.Monthly),
            SubscriptionPricing.UnitPrice(plan, BillingPeriod.Yearly),
            current.VatRate,
            current,
            SubscriptionPricing.Quote(plan, BillingPeriod.Monthly, next),
            SubscriptionPricing.Quote(plan, BillingPeriod.Yearly, next),
            tenant.SubscriptionPeriod switch { BillingPeriod.Yearly => "yearly", BillingPeriod.Monthly => "monthly", _ => null });
    }

    /// <summary>
    /// Yeni şube ücret gerektiriyor mu? Gerektirmez: şube başına olmayan paket, deneme süresi (ilk
    /// ödemede şube sayısı zaten faturalanır), bitmiş dönem (yenileme güncel şube sayısını çeker).
    /// <para>
    /// ELLE FATURALANAN (dönemsiz, deneme olmayan) kurum: platformun aylık taslakları takvim ayını keser —
    /// şube AY SONUNA kadar orantılı açık faturayla istenir ve ÖDENİNCE açılır (sonraki ayın taslağı tam
    /// ücreti zaten içerir; çakışma yok). Eskiden bu kurumda şube ücretsiz ve hemen açılıyordu.
    /// </para>
    /// </summary>
    private async Task<BranchChargeEvaluation> EvaluateBranchChargeAsync(Tenant tenant, CancellationToken ct)
    {
        const string none = BranchChargeMethods.None;
        var plan = tenant.SubscriptionPlan;
        if (plan is null || !plan.ChargePerBranch)
            return new(false, true, "Paketiniz şube başına ücretlendirilmiyor.", null, plan, null, false, none);

        var now = DateTime.UtcNow;
        BillingPeriod period;
        DateTime endsAt;
        var manualBilling = false;
        if (tenant.SubscriptionPeriod is { } subscribedPeriod && tenant.SubscriptionEndsAtUtc is { } endsRaw)
        {
            period = subscribedPeriod;
            endsAt = DateTime.SpecifyKind(endsRaw, DateTimeKind.Utc);
        }
        else if (tenant.Status == TenantStatus.Trial)
        {
            return new(false, true, "Deneme süresinde şube eklemek ücretsizdir; şube ücreti ilk ödemede faturaya eklenir.", null, plan, null, false, none);
        }
        else
        {
            period = BillingPeriod.Monthly;
            endsAt = SubscriptionPricing.ManualBillingPeriodEnd(now);
            manualBilling = true;
        }

        if (SubscriptionPricing.UnitPrice(plan, period) <= 0)
            return new(false, true, "Paketinizde şube ücreti yok.", null, plan, null, false, none);

        if (endsAt <= now)
            return new(false, true, "Aboneliğiniz yenilenmeyi bekliyor; yeni şube bir sonraki tahsilata eklenir.", null, plan, null, false, none);

        var counts = await BillingCountsQuery.CountAsync(_db, tenant.Id, ct);
        var quote = SubscriptionPricing.ProrateBranch(plan, period, now, endsAt, counts);
        var card = await ActiveCardQuery(tenant.Id).AsNoTracking().FirstOrDefaultAsync(ct);
        var blockSince = now - BranchChargeBlockWindow;
        var pending = await _db.SubscriptionPayments.AsNoTracking()
            .AnyAsync(p => p.TenantId == tenant.Id && p.Kind == SubscriptionPayment.KindBranchAddon
                           && p.Status == SubscriptionPayment.Pending && p.CreatedAtUtc >= blockSince, ct);

        // YOL: karttan çekim yalnız ödeme altyapısı AÇIK ve kayıtlı kart VARSA. Aksi halde (canlıda ödeme
        // kapalıyken platformun elle dönem açtığı kurum, kartını kaldıran kurum) şube engellenmez; aynı
        // tutar AÇIK faturaya yazılır. Bekleyen kart ödemesi HER İKİ yolu da durdurur: sonucu bilinmeyen
        // çekim varken fatura kesmek aynı şube için iki borç doğurabilirdi.
        // Elle faturalanan kurumda kart yolu YOK: kart çekimi aboneliğin dönemine bağlıdır (dönem yok).
        var paymentsOn = (await _gateways.ResolveAsync(ct)).IsSuccess;
        var method = !manualBilling && paymentsOn && card is not null ? BranchChargeMethods.Card : BranchChargeMethods.Invoice;
        var reason = pending ? "Önceki şube ödemeniz doğrulanıyor; birkaç dakika sonra tekrar deneyin." : null;
        return new(true, reason is null, reason, quote, plan,
            method == BranchChargeMethods.Card ? card : null, pending, method, endsAt);
    }

    /// <summary>Onaysız / güncel olmayan tutar mesajı — işlenme yoluna göre ("çekilecek" / "faturalanacak").</summary>
    internal static string BranchChargePrompt(string method, decimal total, bool amountChanged) =>
        method == BranchChargeMethods.Invoice
            ? amountChanged
                ? $"Şube ücreti güncellendi: bugün {total:N2} ₺ (KDV dahil) tutarında fatura kesilecek. Lütfen tutarı yeniden onaylayın."
                : $"Yeni şube için bugün {total:N2} ₺ (KDV dahil) tutarında fatura kesilecek. Tutarı onaylayarak tekrar deneyin."
            : amountChanged
                ? $"Şube ücreti güncellendi: bugün {total:N2} ₺ (KDV dahil) çekilecek. Lütfen tutarı yeniden onaylayın."
                : $"Yeni şube için bugün {total:N2} ₺ (KDV dahil) kayıtlı kartınızdan çekilecek. Tutarı onaylayarak tekrar deneyin.";

    public async Task<Result<BranchPurchaseResultDto>> PurchaseBranchAsync(Guid tenantId, BranchPurchaseRequest request, decimal confirmedAmountTRY, CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);

        // ÖNCE BEKLEYENİ SONUÇLANDIR: kullanıcının tekrar denemesi, yanıtı kaybolmuş önceki çekimi
        // sağlayıcıya sordurur. Başarılıysa şube o satırdan açılır; yeni çekim YAPILMAZ. Yalnız en az
        // bir dakikalık satırlar sorulur: HÂLÂ SÜREN bir isteğin (başka sekme) satırı sorulsaydı sağlayıcı
        // henüz bilmediği için yanlış "red" alınıp ikinci çekime yol açılabilirdi. Ödeme altyapısı
        // kapalıysa sorulacak sağlayıcı yoktur; bekleyen satır yine de aşağıda her iki yolu durdurur.
        var resolvedEarlier = context.IsSuccess
            ? await ResolvePendingAddonChargesAsync(context.Value!.Gateway, tenantId, minAge: TimeSpan.FromMinutes(1), ct,
                onlyKind: SubscriptionPayment.KindBranchAddon)
            : 0;

        var tenant = await _db.Tenants.Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (tenant is null) return Result<BranchPurchaseResultDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var e = await EvaluateBranchChargeAsync(tenant, ct);
        if (!e.Required)
            return Result<BranchPurchaseResultDto>.Failure(Error.Conflict("Bu şube için ücret gerekmiyor."));
        if (!e.CanPurchase)
        {
            return Result<BranchPurchaseResultDto>.Failure(e.PendingExists
                ? Error.BranchChargePending(e.Reason!)
                : Error.Conflict(e.Reason!));
        }
        if (resolvedEarlier > 0)
        {
            // Önceki (yanıtı kaybolmuş) çekim şimdi doğrulanıp şubesini açtı: kullanıcı ikinci kez
            // ödemesin diye bu istek çekim yapmaz; ekranı tazeleyip görmesi istenir.
            return Result<BranchPurchaseResultDto>.Failure(Error.Conflict(
                "Önceki şube ödemeniz doğrulandı ve şube açıldı. Listeyi yenileyin; yeni bir şube daha istiyorsanız tekrar ekleyin."));
        }

        var quote = e.Quote!;
        if (quote.Total != decimal.Round(confirmedAmountTRY, 2))
        {
            return Result<BranchPurchaseResultDto>.Failure(Error.BranchChargeRequired(
                BranchChargePrompt(e.Method, quote.Total, amountChanged: true)));
        }

        // KARTSIZ YOL: şube ÖDENİNCE açılır — şimdi yalnız açılacak şubenin bilgisini taşıyan açık fatura kesilir.
        if (e.Method == BranchChargeMethods.Invoice)
            return await RequestBranchWithInvoiceAsync(tenant, request, confirmedAmountTRY, ct);

        // KART YOLU: değerlendirme "ödeme açık + kart var" dedi; altyapı arada kapandıysa çekim yapılmaz.
        if (context.IsFailure) return Result<BranchPurchaseResultDto>.Failure(context.Error);
        var gateway = context.Value!.Gateway;

        var name = request.Name.Trim();
        var city = request.City.Trim();
        return await ChargeAddonWithStoredCardAsync(tenant, e.Plan!, e.Card!, gateway, quote,
            SubscriptionPayment.KindBranchAddon,
            JsonSerializer.Serialize(new BranchPayload(name, city, request.IsDefault), PayloadJson),
            $"{e.Plan!.Name} · Ek şube · {name}", ct);
    }

    /// <summary>Ek ücret türüne göre metinler (şube / onam kademesi) — para kodu tek, yalnız dil ayrışır.</summary>
    private sealed record AddonTexts(string What, string NotOpened, string AuditPrefix, string ConversationPrefix);

    private static AddonTexts TextsFor(string kind) => kind switch
    {
        SubscriptionPayment.KindConsentUpgrade => new AddonTexts("onam kademesi", "Onam kademesi açılmadı.", "ConsentUpgrade", "cns"),
        SubscriptionPayment.KindCustomerUpgrade => new AddonTexts("müşteri kademesi", "Müşteri kademesi açılmadı.", "CustomerUpgrade", "cus"),
        _ => new AddonTexts("şube", "Şube açılmadı.", "BranchCharge", "brn"),
    };

    /// <summary>
    /// EK ÜCRET (şube / onam kademesi) — SAKLI KARTTAN ÇEKİM: rezervasyon → sağlayıcı → sonuçlandırma.
    /// Şube ve onam yükseltmesi AYNI para kodundan geçer (çatallanmaz): değişmezler tek yerde korunur.
    /// </summary>
    private async Task<Result<BranchPurchaseResultDto>> ChargeAddonWithStoredCardAsync(
        Tenant tenant, SubscriptionPlan plan, TenantPaymentMethod card, IPaymentGateway gateway, SubscriptionQuote quote,
        string kind, string payloadJson, string description, CancellationToken ct)
    {
        var tenantId = tenant.Id;
        var texts = TextsFor(kind);
        var conversationId = $"{texts.ConversationPrefix}-{tenantId:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

        // 1) REZERVASYON SAĞLAYICIDAN ÖNCE — açılacak şubenin / kademenin bilgisiyle. Yanıt kaybolursa
        //    sonradan doğrulanan ödeme şubeyi / kademeyi bu bilgiden açar.
        //
        //    YARIŞ: iki sekme / çift tık aynı anda "bekleyen ödeme yok" görüp İKİ KEZ çekebilirdi (işlem
        //    anahtarı milisaniyeli, benzersiz indeks ikinciyi yakalamaz). Kurum satırı kilitlenir,
        //    bekleyen ödeme KİLİT ALTINDA yeniden sorulur ve satır commit edilir; ikinci istek kilidi
        //    aldığında birincinin satırını görür ve çekim yapmadan döner.
        var payment = new SubscriptionPayment(
            tenantId, plan.Id, tenant.SubscriptionPeriod!.Value, quote.Total, gateway.Provider, conversationId,
            attemptNumber: 1, tenantPaymentMethodId: card.Id);
        switch (kind)
        {
            case SubscriptionPayment.KindConsentUpgrade: payment.MarkAsConsentUpgrade(payloadJson); break;
            case SubscriptionPayment.KindCustomerUpgrade: payment.MarkAsCustomerUpgrade(payloadJson); break;
            default: payment.MarkAsBranchAddon(payloadJson); break;
        }
        payment.AttachBreakdown(quote);

        await using (var reserveTx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
                         ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
                         : null)
        {
            if (reserveTx is not null) await RowLock.LockRowAsync(_db, "tenants", tenantId, ct);
            var blockSince = DateTime.UtcNow - BranchChargeBlockWindow;
            var racing = await _db.SubscriptionPayments.AsNoTracking()
                .AnyAsync(p => p.TenantId == tenantId && p.Kind == kind
                               && p.Status == SubscriptionPayment.Pending && p.CreatedAtUtc >= blockSince, ct);
            if (racing)
            {
                // İşlem geri alınır (hiçbir şey yazılmadı); sağlayıcıya GİDİLMEDİ.
                return Result<BranchPurchaseResultDto>.Failure(Error.BranchChargePending(
                    $"Önceki {texts.What} ödemeniz doğrulanıyor; birkaç dakika sonra tekrar deneyin. Tekrar ödeme yapılmadı."));
            }
            _db.SubscriptionPayments.Add(payment);
            await _db.SaveChangesAsync(ct);
            if (reserveTx is not null) await reserveTx.CommitAsync(ct);
        }

        var charge = await gateway.ChargeStoredCardAsync(new StoredCardChargeRequest(
            conversationId,
            quote.Total,
            description,
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
            _currentUser.IpAddress ?? "127.0.0.1"), ct);

        // 2) AĞ HATASI ≠ BAŞARISIZ: satır bekler, şube / kademe açılmaz, tekrar çekilmez.
        if (charge.IsFailure || (!charge.Value!.Succeeded && charge.Value.Outcome != PaymentOutcome.Declined))
        {
            _logger.LogWarning("Ek ücret ödemesinin sonucu belirsiz ({Kind}): {Tenant} {Conversation}", kind, tenantId, conversationId);
            await _audit.LogAsync(tenantId, null, $"{texts.AuditPrefix}Unresolved", "Subscription", payment.Id,
                $"Ek ücret ({texts.What}) ödemesinin sonucu kesinleşmedi ({quote.Total:N2} TL); ödeme doğrulanınca açılacak.",
                new { conversationId, quote.Total, kind }, ct);
            return Result<BranchPurchaseResultDto>.Success(new BranchPurchaseResultDto(
                false, true, $"Ödemenin sonucu doğrulanıyor; ödeme onaylanınca {texts.What} otomatik açılacak. Tekrar ödeme yapmayın.",
                null, quote.Total, null));
        }

        if (!charge.Value.Succeeded)
        {
            payment.MarkFailed(charge.Value.ErrorCode, charge.Value.ErrorMessage, DateTime.UtcNow);
            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(tenantId, null, $"{texts.AuditPrefix}Failed", "Subscription", payment.Id,
                $"Ek ücret ({texts.What}) ödemesi reddedildi: {charge.Value.ErrorMessage}", new { charge.Value.ErrorCode, kind }, ct);
            return Result<BranchPurchaseResultDto>.Failure(Error.Conflict(
                $"Kart çekimi reddedildi{(string.IsNullOrWhiteSpace(charge.Value.ErrorMessage) ? "" : $": {charge.Value.ErrorMessage}")}. {texts.NotOpened}"));
        }

        return Result<BranchPurchaseResultDto>.Success(await FinalizeAddonChargeAsync(
            payment, gateway.Provider, charge.Value.ConversationId, charge.Value.PaidAmountTry,
            charge.Value.Currency, charge.Value.ProviderPaymentId, ct));
    }

    /// <summary>
    /// KARTSIZ ŞUBE TALEBİ — "ödemeden kullanılamaz": şube HEMEN AÇILMAZ. Orantılı tutarın AÇIK (Sent) faturası
    /// açılacak şubenin bilgisiyle kesilir; şube, platform faturayı "Ödendi" yapınca açılır
    /// (<c>PlatformOpsService.UpdateInvoiceStatusAsync</c> — fatura satırı kilitli, bilgi aynı kayıtta tüketilir).
    /// Kurum satırı kilitlenir ve koşullar kilit altında yeniden değerlendirilir; aynı adla ödeme bekleyen talep
    /// varsa ikinci fatura kesilmez (pencereyi kapatıp açmak talebi çoğaltmaz).
    /// </summary>
    private async Task<Result<BranchPurchaseResultDto>> RequestBranchWithInvoiceAsync(
        Tenant tenant, BranchPurchaseRequest request, decimal confirmedAmountTRY, CancellationToken ct)
    {
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        if (tx is not null)
        {
            await RowLock.LockRowAsync(_db, "tenants", tenant.Id, ct);
            await _db.Entry(tenant).ReloadAsync(ct);
            await _db.Entry(tenant).Reference(t => t.SubscriptionPlan).LoadAsync(ct);
        }

        var e = await EvaluateBranchChargeAsync(tenant, ct);
        if (!e.Required || e.Method != BranchChargeMethods.Invoice)
        {
            return Result<BranchPurchaseResultDto>.Failure(Error.Conflict(
                "Şube ücretinin işlenme yolu değişti; ekranı yenileyip tekrar deneyin. Fatura kesilmedi."));
        }
        if (!e.CanPurchase)
        {
            return Result<BranchPurchaseResultDto>.Failure(e.PendingExists
                ? Error.BranchChargePending(e.Reason!)
                : Error.Conflict(e.Reason!));
        }

        var name = request.Name.Trim();
        var city = request.City.Trim();

        // Aynı adla ÖDEME BEKLEYEN talep → onu döndür (ikinci fatura yok).
        var openRequests = await _db.TenantInvoices.IgnoreQueryFilters().AsNoTracking()
            .Where(i => i.TenantId == tenant.Id && !i.IsDeleted && i.PendingBranchJson != null
                        && (i.Status == "Draft" || i.Status == "Sent" || i.Status == "Overdue"))
            .ToListAsync(ct);
        var existing = openRequests.FirstOrDefault(i =>
            string.Equals(ReadBranchPayload(i.PendingBranchJson)?.Name?.Trim(), name, StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
        {
            var pendingName = ReadBranchPayload(existing.PendingBranchJson)?.Name ?? name;
            return Result<BranchPurchaseResultDto>.Success(new BranchPurchaseResultDto(false, false,
                $"'{pendingName}' şubesi için {existing.Number} numaralı fatura zaten kesildi; ödeme alındığında şube açılır.",
                null, existing.AmountTRY, existing.Number, AwaitingInvoicePayment: true));
        }

        var quote = e.Quote!;
        if (quote.Total != decimal.Round(confirmedAmountTRY, 2))
        {
            return Result<BranchPurchaseResultDto>.Failure(Error.BranchChargeRequired(
                BranchChargePrompt(BranchChargeMethods.Invoice, quote.Total, amountChanged: true)));
        }

        var now = DateTime.UtcNow;
        var periodEnd = e.PeriodEndUtc is { } end && end > now ? end : now.AddDays(1);
        var invoice = new TenantInvoice(tenant.Id, await NextInvoiceNumberAsync(now, ct), now, periodEnd, quote.Total,
            $"{e.Plan!.Name} · Ek şube · {name} (ödenince açılacak)");
        invoice.ApplyQuote(quote);
        invoice.AwaitBranch(JsonSerializer.Serialize(new BranchPayload(name, city, request.IsDefault), PayloadJson));
        invoice.ChangeStatus("Sent");   // kesildi, ödeme bekliyor — vade varsayılan 14 gün
        _db.TenantInvoices.Add(invoice);

        await _db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);

        await _audit.LogAsync(tenant.Id, null, "BranchRequestedInvoiced", "Subscription", invoice.Id,
            $"Ek şube talebi: {name} · {quote.Total:N2} TL için açık fatura {invoice.Number} kesildi; şube ödenince açılacak.",
            new { name, quote.Total, invoice.Number }, ct);

        return Result<BranchPurchaseResultDto>.Success(new BranchPurchaseResultDto(false, false,
            $"Şube talebiniz alındı: {quote.Total:N2} ₺ (KDV dahil) için {invoice.Number} numaralı fatura kesildi. Şube, ödeme alındığında açılacak.",
            null, quote.Total, invoice.Number, AwaitingInvoicePayment: true));
    }

    private static BranchPayload? ReadBranchPayload(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<BranchPayload>(json, PayloadJson); }
        catch (JsonException) { return null; }
    }

    public async Task<int> ResolvePendingBranchChargesAsync(CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);
        if (context.IsFailure) return 0;
        return await ResolvePendingAddonChargesAsync(context.Value!.Gateway, tenantId: null, BranchChargeProbeAfter, ct);
    }

    /// <summary>
    /// Bekleyen EK ÜCRET ödemelerini (şube / onam kademesi) sağlayıcıya sorar; başarılıysa şubeyi /
    /// kademeyi açar, kesin redde kapatır. Açılan kayıt sayısını döner.
    /// </summary>
    /// <param name="onlyKind">Kullanıcı akışı yalnız KENDİ türünü sorar (şube alımı, sonradan doğrulanan onam
    /// ödemesini "şube açıldı" diye raporlamasın); arka plan taraması ikisini de.</param>
    private async Task<int> ResolvePendingAddonChargesAsync(IPaymentGateway gateway, Guid? tenantId, TimeSpan minAge, CancellationToken ct,
        string? onlyKind = null)
    {
        var olderThan = DateTime.UtcNow - minAge;
        var query = _db.SubscriptionPayments
            .Where(p => (p.Kind == SubscriptionPayment.KindBranchAddon || p.Kind == SubscriptionPayment.KindConsentUpgrade
                         || p.Kind == SubscriptionPayment.KindCustomerUpgrade)
                        && p.Status == SubscriptionPayment.Pending && p.CreatedAtUtc <= olderThan);
        if (onlyKind is not null) query = query.Where(p => p.Kind == onlyKind);
        if (tenantId is { } tid) query = query.Where(p => p.TenantId == tid);
        var pendings = await query.OrderBy(p => p.CreatedAtUtc).Take(50).ToListAsync(ct);

        var opened = 0;
        foreach (var pending in pendings)
        {
            var probe = await gateway.RetrievePaymentAsync(pending.ConversationId, ct);
            if (probe.IsSuccess && probe.Value!.Succeeded)
            {
                var result = await FinalizeAddonChargeAsync(pending, gateway.Provider, probe.Value.ConversationId,
                    probe.Value.PaidAmountTry, probe.Value.Currency, probe.Value.ProviderPaymentId, ct);
                if (result.Created) opened++;
            }
            else if (probe.IsSuccess && probe.Value!.Outcome == PaymentOutcome.Declined)
            {
                pending.MarkFailed(probe.Value.ErrorCode ?? "DECLINED", probe.Value.ErrorMessage ?? "Sağlayıcı ödemeyi reddetti.", DateTime.UtcNow);
                await _db.SaveChangesAsync(ct);
                var t = TextsFor(pending.Kind);
                await _audit.LogAsync(pending.TenantId, null, $"{t.AuditPrefix}Failed", "Subscription", pending.Id,
                    $"Sonucu bekleyen ek ücret ({t.What}) ödemesi sağlayıcıda reddedilmiş. {t.NotOpened}", new { pending.ConversationId }, ct);
            }
            // Belirsiz: satır bekler (platform Faturalama ekranında "sonucu bekleyen" olarak görünür).
        }
        return opened;
    }

    /// <summary>
    /// "Başarılı" sonucu doğrular, sahiplenir ve şubeyi (ya da onam kademesini taşıyan ÖDENMİŞ faturayı)
    /// ödemeyle AYNI işlemde oluşturur. Satır kilidi + durum tazeleme: kullanıcı isteği ile arka plan
    /// taraması aynı ödemeyi aynı anda sonuçlandırmaya çalışırsa yalnız biri işler.
    /// </summary>
    private async Task<BranchPurchaseResultDto> FinalizeAddonChargeAsync(
        SubscriptionPayment payment, string provider, string? returnedConversationId, decimal paidAmountTry,
        string? currency, string? providerPaymentId, CancellationToken ct)
    {
        var mismatch = await DescribeOutcomeMismatchAsync(payment, provider, returnedConversationId, paidAmountTry, currency, providerPaymentId, ct);
        if (mismatch is not null)
        {
            // PENDING BIRAKILIR: para gerçekten çekilmiş olabilir; "başarısız" demek ikinci çekimi açardı.
            _logger.LogError("Ek ücret ödemesi değişmezlere uymadı ({PaymentId}, {Kind}): {Reason}", payment.Id, payment.Kind, mismatch);
            await _audit.LogAsync(payment.TenantId, null, $"{TextsFor(payment.Kind).AuditPrefix}Mismatch", "Subscription", payment.Id,
                $"Ek ücret ({TextsFor(payment.Kind).What}) ödemesinin sonucu doğrulanamadı: {mismatch}", new { payment.ConversationId, payment.AmountTRY }, ct);
            return new BranchPurchaseResultDto(false, true, "Ödeme doğrulanamadı; işlem elle incelenecek. Tekrar ödeme yapmayın.", null, payment.AmountTRY, null);
        }

        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

        if (tx is not null)
        {
            await RowLock.LockRowAsync(_db, "subscription_payments", payment.Id, ct);
            await _db.Entry(payment).ReloadAsync(ct);
        }
        if (payment.Status == SubscriptionPayment.Succeeded)
        {
            if (tx is not null) await tx.CommitAsync(ct);
            return new BranchPurchaseResultDto(true, false, payment.IsConsentUpgrade || payment.IsCustomerUpgrade
                ? "Kademe ödemesi zaten işlendi ve kademe açıldı. Ekranı yenileyin."
                : "Şube ödemesi zaten işlendi ve şube açıldı. Listeyi yenileyin.", null, payment.AmountTRY, null);
        }

        if (await ProviderPaymentClaims.TryClaimAsync(_db, provider, providerPaymentId!,
                ProviderPaymentClaim.SubscriptionLedger, payment.Id, payment.TenantId, ct)
            == ProviderPaymentClaims.ClaimOutcome.OwnedByAnother)
        {
            if (tx is not null) await tx.CommitAsync(ct);
            await _audit.LogAsync(payment.TenantId, null, $"{TextsFor(payment.Kind).AuditPrefix}Mismatch", "Subscription", payment.Id,
                $"Ek ücret ({TextsFor(payment.Kind).What}) ödemesinin sağlayıcı kimliği başka bir deftere ait. {TextsFor(payment.Kind).NotOpened}",
                new { payment.ConversationId, providerPaymentId }, ct);
            return new BranchPurchaseResultDto(false, true, "Ödeme doğrulanamadı; işlem elle incelenecek. Tekrar ödeme yapmayın.", null, payment.AmountTRY, null);
        }

        var now = DateTime.UtcNow;
        payment.MarkSucceeded(providerPaymentId, now);

        var tenant = await _db.Tenants.Include(t => t.Branches).Include(t => t.SubscriptionPlan)
            .FirstAsync(t => t.Id == payment.TenantId, ct);
        var periodEnd = tenant.SubscriptionEndsAtUtc is { } end && end > now ? DateTime.SpecifyKind(end, DateTimeKind.Utc) : now.AddDays(1);
        var planName = tenant.SubscriptionPlan?.Name ?? "Abonelik";

        if (payment.IsConsentUpgrade || payment.IsCustomerUpgrade)
        {
            // KADEME (onam / müşteri): kademeyi taşıyan ÖDENMİŞ fatura — kapılar bunu okur (bugünü kapsadıkça).
            var customers = payment.IsCustomerUpgrade;
            var title = customers ? "Müşteri kademesi" : "Dijital onam kademesi";
            var unit = customers ? "müşteri" : "evrak";
            var tp = JsonSerializer.Deserialize<TierUpgradePayload>(payment.PayloadJson!, PayloadJson)!;
            var tierInvoice = new TenantInvoice(tenant.Id, await NextInvoiceNumberAsync(now, ct), now, periodEnd, payment.AmountTRY,
                $"{planName} · {title} · {tp.TierAbove:N0} üzeri {unit}");
            ApplyBreakdownOrDefaultVat(tierInvoice, payment);
            if (customers) tierInvoice.CoverCustomerTier(tp.TierAbove);
            else tierInvoice.CoverConsentTier(tp.TierAbove);
            tierInvoice.MarkPaid(now, providerPaymentId);
            _db.TenantInvoices.Add(tierInvoice);
            payment.AttachInvoice(tierInvoice.Id);

            await _db.SaveChangesAsync(ct);
            if (tx is not null) await tx.CommitAsync(ct);

            await _audit.LogAsync(tenant.Id, null, $"{payment.Kind}Purchased", "Subscription", payment.Id,
                $"{title} açıldı: {tp.TierAbove:N0} üzeri · {payment.AmountTRY:N2} TL · fatura {tierInvoice.Number}",
                new { tp.TierAbove, payment.AmountTRY, tierInvoice.Number }, ct);
            return new BranchPurchaseResultDto(true, false,
                $"{title} açıldı ({tp.TierAbove:N0} üzeri {unit}) · {payment.AmountTRY:N2} ₺ (KDV dahil) karttan çekildi · fatura {tierInvoice.Number}.",
                null, payment.AmountTRY, tierInvoice.Number);
        }

        var p = JsonSerializer.Deserialize<BranchPayload>(payment.PayloadJson!, PayloadJson)!;
        var branch = tenant.AddBranch(p.Name, p.City, p.IsDefault);
        // Gezinme koleksiyonuna eklenen yeni nesneyi EF "var olan" sanıp UPDATE üretmesin (bkz. BranchService).
        _db.Branches.Add(branch);

        var invoice = new TenantInvoice(tenant.Id, await NextInvoiceNumberAsync(now, ct), now, periodEnd, payment.AmountTRY,
            $"{planName} · Ek şube · {p.Name}");
        ApplyBreakdownOrDefaultVat(invoice, payment);
        invoice.MarkPaid(now, providerPaymentId);
        _db.TenantInvoices.Add(invoice);
        payment.AttachInvoice(invoice.Id);

        await _db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);

        await _audit.LogAsync(tenant.Id, null, "BranchPurchased", "Subscription", payment.Id,
            $"Ek şube açıldı: {p.Name} · {payment.AmountTRY:N2} TL · fatura {invoice.Number}",
            new { branchId = branch.Id, p.Name, payment.AmountTRY, invoice.Number }, ct);

        return new BranchPurchaseResultDto(true, false,
            $"{p.Name} şubesi açıldı · {payment.AmountTRY:N2} ₺ (KDV dahil) karttan çekildi · fatura {invoice.Number}.",
            branch.Id, payment.AmountTRY, invoice.Number);
    }
}

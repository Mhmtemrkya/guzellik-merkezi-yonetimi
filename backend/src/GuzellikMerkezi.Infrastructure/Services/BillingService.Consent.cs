using System.Text.Json;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// HACİM KADEMESİ (müşteri / dijital onam) — "sınırı geçen ÖDEMEDEN kullanamaz".
///
/// <para>
/// Kapılar (müşteri: <c>UsageService.CheckLimitAsync</c> + portal yolları; onam: <c>ConsentService.SignAsync</c>)
/// ödenmiş kademeyi YALNIZ "Paid" faturadan okur. Bu dosya kapasiteyi açmanın iki yolunu sunar: <b>Card</b> —
/// kalan dönemin orantılı farkı karttan çekilir, ödeme kesinleşince kademeyi taşıyan ödenmiş fatura yazılır
/// (şube ek ücretiyle AYNI para kodu); <b>Invoice</b> — kart yok / ödeme altyapısı kapalı / dönemsiz kurum:
/// kademeyi taşıyan AÇIK fatura kesilir ve kilit ANCAK platform faturayı "Ödendi" yapınca kalkar.
/// İki boyut tek kodu paylaşır; yalnız sayaç, kademe listesi ve faturadaki alan ayrışır.
/// </para>
/// </summary>
public sealed partial class BillingService
{
    private sealed record TierUpgradePayload(int TierAbove);

    private sealed record TierUpgradeEvaluation(
        ConsentEntitlement Entitlement,
        bool CanPurchase,
        string? Reason,
        SubscriptionQuote? Quote,
        PricingTier? Target,
        TenantPaymentMethod? Card,
        bool PendingExists,
        string Method,
        TenantInvoice? OpenInvoice,
        DateTime? PeriodEndUtc);

    private static string UpgradeKindFor(TierDimension d) =>
        d == TierDimension.Customers ? SubscriptionPayment.KindCustomerUpgrade : SubscriptionPayment.KindConsentUpgrade;

    private static string TierTitle(TierDimension d) => d == TierDimension.Customers ? "Müşteri kademesi" : "Onam kademesi";
    private static string TierUnit(TierDimension d) => d == TierDimension.Customers ? "müşteri" : "evrak";

    private static int? GrantedTier(TenantInvoice i, TierDimension d) =>
        d == TierDimension.Customers ? i.CustomerTierAbove : i.ConsentTierAbove;

    /// <summary>Tutar onaylanmadı / değişti — boyuta özgü makine kodu (istemci yeniden onay ister).</summary>
    private static Error UpgradeRequired(TierDimension d, string message) =>
        d == TierDimension.Customers ? Error.CustomerUpgradeRequired(message) : Error.ConsentUpgradeRequired(message);

    public Task<Result<TierAllowanceDto>> GetConsentAllowanceAsync(Guid tenantId, CancellationToken ct = default) =>
        GetTierAllowanceAsync(tenantId, TierDimension.ConsentDocuments, ct);

    public Task<Result<TierUpgradeResultDto>> PurchaseConsentUpgradeAsync(Guid tenantId, decimal confirmedAmountTRY, CancellationToken ct = default) =>
        PurchaseTierUpgradeAsync(tenantId, TierDimension.ConsentDocuments, confirmedAmountTRY, ct);

    public async Task<Result<TierAllowanceDto>> GetTierAllowanceAsync(Guid tenantId, TierDimension dimension, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (tenant is null) return Result<TierAllowanceDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var e = await EvaluateTierUpgradeAsync(tenant, dimension, ct);
        var ent = e.Entitlement;
        return Result<TierAllowanceDto>.Success(new TierAllowanceDto(
            dimension.ToString(), ent.Allowed, ent.Count, ent.Capacity, ent.PaidTierAbove,
            e.Target?.Above, e.Target?.MonthlyFee,
            e.CanPurchase, e.Reason, e.Quote, e.Method, e.Card?.MaskedNumber,
            e.OpenInvoice?.Number, AsUtc(tenant.SubscriptionEndsAtUtc)));
    }

    /// <summary>
    /// Bir sonraki kademenin bedeli ve işlenme yolu. Dönemli kurumda kalan dönemin orantılı farkı; dönemi
    /// olmayan (platformun elle açtığı) kurumda BİR AYLIK fark ve fatura. Deneme süresinde satın alınmaz.
    /// </summary>
    private async Task<TierUpgradeEvaluation> EvaluateTierUpgradeAsync(Tenant tenant, TierDimension dimension, CancellationToken ct)
    {
        const string none = BranchChargeMethods.None;
        var now = DateTime.UtcNow;
        var ent = await TierEntitlementQuery.EvaluateAsync(_db, tenant.Id, dimension, now, ct);
        var target = ent.NextTier;
        var plan = tenant.SubscriptionPlan;
        var title = TierTitle(dimension);

        if (target is null || plan is null)
            return new(ent, false, $"{title} için sınır yok.", null, null, null, false, none, null, null);
        if (tenant.Status == TenantStatus.Trial)
            return new(ent, false,
                $"Deneme süresinde {title.ToLowerInvariant()} alınamaz; abonelik başladığında sayacınızın kademesi dönem ücretine eklenir.",
                null, target, null, false, none, null, null);

        var endsAt = tenant.SubscriptionEndsAtUtc is { } raw ? DateTime.SpecifyKind(raw, DateTimeKind.Utc) : (DateTime?)null;
        var hasPeriod = tenant.SubscriptionPeriod is not null && endsAt is { } end && end > now;
        var paidFee = TierAllowance.PaidMonthlyFee(ent.Tiers, ent.PaidTierAbove);
        var counts = await BillingCountsQuery.CountAsync(_db, tenant.Id, ct);
        // Dönemsiz (elle faturalanan) kurum: platformun aylık taslakları TAKVİM AYI keser — fark AY SONUNA kadar
        // orantılanır; "bir ay" sonraki ayın taslağıyla çakışıp ayın bir kısmını iki kez faturalardı.
        var effectivePeriod = hasPeriod ? tenant.SubscriptionPeriod!.Value : BillingPeriod.Monthly;
        var periodEnd = hasPeriod ? endsAt!.Value : SubscriptionPricing.ManualBillingPeriodEnd(now);
        var quote = SubscriptionPricing.TierUpgrade(plan, dimension, effectivePeriod, now, periodEnd, target, paidFee, counts);

        // Bu kademeyi (ya da üstünü) açacak, kesilmiş ama ÖDENMEMİŞ fatura → ikinci fatura kesilmez.
        // (Platformun aylık dönem taslağı da kademe taşır; o ödenince kilit zaten kalkar.)
        var openInvoice = (await _db.TenantInvoices.IgnoreQueryFilters().AsNoTracking()
                .Where(i => i.TenantId == tenant.Id && !i.IsDeleted && i.PeriodEndUtc > now
                            && (i.Status == "Draft" || i.Status == "Sent" || i.Status == "Overdue"))
                .ToListAsync(ct))
            .Where(i => GrantedTier(i, dimension) is int granted && granted >= target.Above)
            .OrderByDescending(i => i.IssuedAtUtc)
            .FirstOrDefault();

        var kind = UpgradeKindFor(dimension);
        var blockSince = now - BranchChargeBlockWindow;
        var pending = await _db.SubscriptionPayments.AsNoTracking()
            .AnyAsync(p => p.TenantId == tenant.Id && p.Kind == kind
                           && p.Status == SubscriptionPayment.Pending && p.CreatedAtUtc >= blockSince, ct);

        // Kart yolu yalnız: dönem var + kayıtlı kart var + ödeme altyapısı açık + ödenecek tutar var.
        var card = hasPeriod ? await ActiveCardQuery(tenant.Id).AsNoTracking().FirstOrDefaultAsync(ct) : null;
        var cardOk = card is not null && quote.Total > 0 && (await _gateways.ResolveAsync(ct)).IsSuccess;
        var method = cardOk ? BranchChargeMethods.Card : BranchChargeMethods.Invoice;

        var reason = pending
            ? $"Önceki {title.ToLowerInvariant()} ödemeniz doğrulanıyor; birkaç dakika sonra tekrar deneyin."
            : openInvoice is not null
                ? $"Bu kademe için {openInvoice.Number} numaralı fatura kesildi; ödeme alındığında kademe açılır."
                : null;
        return new(ent, reason is null, reason, quote, target, cardOk ? card : null, pending, method, openInvoice, periodEnd);
    }

    private static string TierUpgradePrompt(TierDimension dimension, string method, decimal total) => method == BranchChargeMethods.Invoice
        ? $"{TierTitle(dimension)} tutarı güncellendi: {total:N2} ₺ (KDV dahil) tutarında fatura kesilecek. Lütfen tutarı yeniden onaylayın."
        : $"{TierTitle(dimension)} tutarı güncellendi: bugün {total:N2} ₺ (KDV dahil) kayıtlı kartınızdan çekilecek. Lütfen tutarı yeniden onaylayın.";

    public async Task<Result<TierUpgradeResultDto>> PurchaseTierUpgradeAsync(Guid tenantId, TierDimension dimension, decimal confirmedAmountTRY, CancellationToken ct = default)
    {
        var context = await _gateways.ResolveAsync(ct);
        var kind = UpgradeKindFor(dimension);

        // ÖNCE BEKLEYENİ SONUÇLANDIR (yalnız bu boyutun ödemeleri): yanıtı kaybolmuş önceki çekim
        // doğrulanırsa kademe ondan açılır, ikinci çekim yapılmaz.
        var resolvedEarlier = context.IsSuccess
            ? await ResolvePendingAddonChargesAsync(context.Value!.Gateway, tenantId, minAge: TimeSpan.FromMinutes(1), ct, onlyKind: kind)
            : 0;

        var tenant = await _db.Tenants.Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (tenant is null) return Result<TierUpgradeResultDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        if (resolvedEarlier > 0)
        {
            return Result<TierUpgradeResultDto>.Failure(Error.Conflict(
                $"Önceki {TierTitle(dimension).ToLowerInvariant()} ödemeniz doğrulandı ve kademe açıldı. Ekranı yenileyin."));
        }

        var e = await EvaluateTierUpgradeAsync(tenant, dimension, ct);
        if (e.Target is null)
            return Result<TierUpgradeResultDto>.Failure(Error.Conflict(e.Reason ?? $"{TierTitle(dimension)} için sınır yok."));
        if (!e.CanPurchase)
        {
            return Result<TierUpgradeResultDto>.Failure(e.PendingExists
                ? Error.BranchChargePending(e.Reason!)
                : Error.Conflict(e.Reason!));
        }

        var quote = e.Quote!;
        if (quote.Total != decimal.Round(confirmedAmountTRY, 2))
            return Result<TierUpgradeResultDto>.Failure(UpgradeRequired(dimension, TierUpgradePrompt(dimension, e.Method, quote.Total)));

        if (e.Method == BranchChargeMethods.Invoice)
            return await IssueTierUpgradeInvoiceAsync(tenant, dimension, e.Target.Above, confirmedAmountTRY, ct);

        // KART YOLU — şube ek ücretiyle AYNI para kodu (rezervasyon, belirsiz sonuç, sahiplenme).
        if (context.IsFailure) return Result<TierUpgradeResultDto>.Failure(context.Error);
        var plan = tenant.SubscriptionPlan!;
        var charged = await ChargeAddonWithStoredCardAsync(tenant, plan, e.Card!, context.Value!.Gateway, quote,
            kind,
            JsonSerializer.Serialize(new TierUpgradePayload(e.Target.Above), PayloadJson),
            $"{plan.Name} · {TierTitle(dimension)} · {e.Target.Above:N0} üzeri {TierUnit(dimension)}", ct);
        if (charged.IsFailure) return Result<TierUpgradeResultDto>.Failure(charged.Error);

        var r = charged.Value!;
        return Result<TierUpgradeResultDto>.Success(new TierUpgradeResultDto(r.Created, r.Pending, r.Message, r.AmountTRY, r.InvoiceNumber));
    }

    /// <summary>
    /// KARTSIZ YÜKSELTME: kademeyi taşıyan AÇIK (Sent) fatura — kilit, platform "Ödendi" yapana kadar SÜRER.
    /// Kurum satırı kilitlenir ve koşullar kilit altında yeniden değerlendirilir (çift tık iki fatura kesmez;
    /// ikinci istek açık faturayı görüp durur).
    /// </summary>
    private async Task<Result<TierUpgradeResultDto>> IssueTierUpgradeInvoiceAsync(
        Tenant tenant, TierDimension dimension, int targetAbove, decimal confirmedAmountTRY, CancellationToken ct)
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

        var e = await EvaluateTierUpgradeAsync(tenant, dimension, ct);
        if (e.Target?.Above != targetAbove || e.Method != BranchChargeMethods.Invoice)
        {
            return Result<TierUpgradeResultDto>.Failure(Error.Conflict(
                $"{TierTitle(dimension)} durumu değişti; ekranı yenileyip tekrar deneyin. Fatura kesilmedi."));
        }
        if (!e.CanPurchase)
        {
            return Result<TierUpgradeResultDto>.Failure(e.PendingExists
                ? Error.BranchChargePending(e.Reason!)
                : Error.Conflict(e.Reason!));
        }
        var quote = e.Quote!;
        if (quote.Total != decimal.Round(confirmedAmountTRY, 2))
        {
            return Result<TierUpgradeResultDto>.Failure(UpgradeRequired(dimension,
                TierUpgradePrompt(dimension, BranchChargeMethods.Invoice, quote.Total)));
        }

        var now = DateTime.UtcNow;
        var plan = tenant.SubscriptionPlan!;
        var invoice = new TenantInvoice(tenant.Id, await NextInvoiceNumberAsync(now, ct), now, e.PeriodEndUtc!.Value, quote.Total,
            $"{plan.Name} · {TierTitle(dimension)} · {targetAbove:N0} üzeri {TierUnit(dimension)} (elle tahsil edilecek)");
        invoice.ApplyQuote(quote);
        if (dimension == TierDimension.Customers) invoice.CoverCustomerTier(targetAbove);
        else invoice.CoverConsentTier(targetAbove);
        // Bedelsiz yükseltme (ör. ücretleri ters sıralı kademe) hemen açılır; bedelli olan ÖDENİNCE.
        var unlocked = quote.Total <= 0;
        if (unlocked) invoice.MarkPaid(now, null);
        else invoice.ChangeStatus("Sent");
        _db.TenantInvoices.Add(invoice);

        await _db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);

        await _audit.LogAsync(tenant.Id, null, $"{UpgradeKindFor(dimension)}Invoiced", "Subscription", invoice.Id,
            $"{TierTitle(dimension)} faturası kesildi: {targetAbove:N0} üzeri · {quote.Total:N2} TL · {invoice.Number} (ödenince açılır).",
            new { dimension = dimension.ToString(), targetAbove, quote.Total, invoice.Number }, ct);

        return Result<TierUpgradeResultDto>.Success(new TierUpgradeResultDto(unlocked, false,
            unlocked
                ? $"{TierTitle(dimension)} açıldı ({targetAbove:N0} üzeri {TierUnit(dimension)})."
                : $"{invoice.Number} numaralı fatura kesildi ({quote.Total:N2} ₺, KDV dahil). Ödeme alındığında kademe açılır.",
            quote.Total, invoice.Number));
    }
}

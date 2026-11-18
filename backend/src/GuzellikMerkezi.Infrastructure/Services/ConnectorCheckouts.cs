using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <inheritdoc cref="IConnectorCheckouts"/>
public sealed partial class ConnectorCheckouts(
    GuzellikDbContext db,
    IBillingService billing,
    IWhatsAppBillingService credits,
    IInvoicePaymentService invoices,
    IAuditLogger audit) : IConnectorCheckouts
{
    [GeneratedRegex("^[0-9a-f]{32}$", RegexOptions.CultureInvariant, 100)]
    private static partial Regex RefPattern();

    public async Task<ConnectorCheckoutDto?> GetAsync(string publicRef, CancellationToken ct = default)
    {
        if (!RefPattern().IsMatch(publicRef ?? string.Empty)) return null;
        var checkout = await db.ExternalCheckouts.AsNoTracking().FirstOrDefaultAsync(c => c.PublicRef == publicRef, ct);
        if (checkout is null) return null;
        var tenantName = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == checkout.TenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? string.Empty;
        var status = checkout.Status == ExternalCheckout.StatusPaid ? "paid"
            : checkout.IsExpired(DateTime.UtcNow) ? "expired"
            : "pending";

        // FATURA ÖDEMESİ BEKLERKEN FATURA DEĞİŞTİYSE sayfa kapanır: platform faturayı elle kapattıysa,
        // iptal ettiyse ya da tutarı değiştiyse bu ödeme alınmaz (çift tahsilat / eski tutar olmasın).
        // Kurum ödemeyi panelden yeniden başlatır.
        if (status == "pending" && checkout.InvoiceId is { } invoiceId)
        {
            var invoice = await db.TenantInvoices.AsNoTracking().Where(i => i.Id == invoiceId)
                .Select(i => new { i.Status, i.AmountTRY }).FirstOrDefaultAsync(ct);
            if (invoice is null || invoice.Status is "Paid" or "Cancelled" || invoice.AmountTRY != checkout.AmountTRY)
                status = "expired";
        }
        // Dönem yalnız abonelik DÖNEMİ ödemesinde (şube/kademe farkı da "subscription" türünde açılır).
        var period = checkout.Kind == ExternalCheckout.KindSubscription
            ? await db.SubscriptionPayments.AsNoTracking()
                .Where(p => p.ConversationId == checkout.ConversationId && p.Kind == SubscriptionPayment.KindSubscription)
                .Select(p => (BillingPeriod?)p.Period).FirstOrDefaultAsync(ct)
            : null;
        var separator = checkout.CallbackUrl.Contains('?') ? '&' : '?';
        return new ConnectorCheckoutDto(
            checkout.PublicRef, status, checkout.Kind switch { ExternalCheckout.KindCredit => "credit", ExternalCheckout.KindInvoice => "invoice", _ => "subscription" },
            (long)decimal.Round(checkout.AmountTRY * 100m, 0), "TRY", checkout.Description, tenantName, checkout.TenantId,
            $"{checkout.CallbackUrl}{separator}token={checkout.PublicRef}", checkout.ExpiresAtUtc,
            period switch { BillingPeriod.Monthly => "monthly", BillingPeriod.Yearly => "yearly", _ => null });
    }

    public async Task<Result<ConnectorCheckoutDto>> AwaitTransferAsync(string publicRef, CancellationToken ct = default)
    {
        var closed = Error.Conflict("Bu ödeme artık açık değil: alınmış ya da süresi dolmuş.");
        if (!RefPattern().IsMatch(publicRef ?? string.Empty))
            return Result<ConnectorCheckoutDto>.Failure(Error.NotFound("Ödeme kaydı bulunamadı."));
        var checkout = await db.ExternalCheckouts.FirstOrDefaultAsync(c => c.PublicRef == publicRef, ct);
        if (checkout is null) return Result<ConnectorCheckoutDto>.Failure(Error.NotFound("Ödeme kaydı bulunamadı."));

        // Fatura değişmişse (iptal / tutar) GET kaydı kapalı gösterir: havale de başlatılmaz, ömür uzatılmaz.
        if (await GetAsync(publicRef!, ct) is not { Status: "pending" } || !checkout.AwaitTransfer(DateTime.UtcNow))
            return Result<ConnectorCheckoutDto>.Failure(closed);
        await db.SaveChangesAsync(ct);
        return Result<ConnectorCheckoutDto>.Success((await GetAsync(publicRef!, ct))!);
    }

    public async Task<Result<ConnectorCheckoutPaidDto>> RecordPaidAsync(string publicRef, ConnectorCheckoutPaidRequest request, CancellationToken ct = default)
    {
        if (!RefPattern().IsMatch(publicRef ?? string.Empty))
            return Result<ConnectorCheckoutPaidDto>.Failure(Error.NotFound("Ödeme kaydı bulunamadı."));
        var paymentId = (request.PaymentId ?? string.Empty).Trim();
        if (paymentId.Length is 0 or > 128 || request.AmountKurus <= 0 || string.IsNullOrWhiteSpace(request.Currency) || request.Currency.Length > 8)
            return Result<ConnectorCheckoutPaidDto>.Failure(Error.Validation("Ödeme bildirimi eksik ya da geçersiz."));

        var checkout = await db.ExternalCheckouts.FirstOrDefaultAsync(c => c.PublicRef == publicRef, ct);
        if (checkout is null) return Result<ConnectorCheckoutPaidDto>.Failure(Error.NotFound("Ödeme kaydı bulunamadı."));

        ExternalCheckout.RecordOutcome outcome;
        try
        {
            outcome = checkout.RecordPaid(paymentId, request.AmountKurus / 100m, request.Currency.Trim().ToUpperInvariant(), DateTime.UtcNow);
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Aynı anda gelen ikinci bildirim: kaydı yeniden okuyup yazılanla karşılaştırır.
            db.ChangeTracker.Clear();
            checkout = await db.ExternalCheckouts.FirstAsync(c => c.PublicRef == publicRef, ct);
            outcome = checkout.RecordPaid(paymentId, request.AmountKurus / 100m, request.Currency.Trim().ToUpperInvariant(), DateTime.UtcNow);
        }

        if (outcome == ExternalCheckout.RecordOutcome.Conflict)
        {
            await audit.LogAsync(checkout.TenantId, null, "MaydanozPaymentConflict", "ExternalCheckout", checkout.Id,
                "Aynı ödemeye Maydanoz'dan ikinci, farklı bir ödeme bildirildi; işlenmedi.",
                new { checkout.PublicRef, first = checkout.ProviderPaymentId, second = paymentId }, ct);
            return Result<ConnectorCheckoutPaidDto>.Failure(Error.Conflict("Bu ödeme başka bir işlemle zaten kapatıldı."));
        }

        // Karar her zamanki yoldan: sonuç sağlayıcıdan (bu kayıttan) okunur, tutar/para birimi/sahiplik
        // değişmezleri orada uygulanır. Tekrar çağrı idempotenttir ("zaten alınmıştı").
        if (checkout.Kind == ExternalCheckout.KindInvoice)
        {
            var settled = await invoices.SettleAsync(checkout, ct);
            return settled.IsFailure
                ? Result<ConnectorCheckoutPaidDto>.Failure(settled.Error)
                : Result<ConnectorCheckoutPaidDto>.Success(new ConnectorCheckoutPaidDto(checkout.PublicRef, "settled", settled.Value!.Message));
        }

        if (checkout.Kind == ExternalCheckout.KindCredit)
        {
            var credit = await credits.CompleteCreditCheckoutAsync(checkout.PublicRef, ct);
            return credit.IsFailure
                ? Result<ConnectorCheckoutPaidDto>.Failure(credit.Error)
                : Result<ConnectorCheckoutPaidDto>.Success(new ConnectorCheckoutPaidDto(
                    checkout.PublicRef, credit.Value!.Succeeded ? "settled" : "pending", credit.Value.Message));
        }

        var completed = await billing.CompleteCheckoutAsync(checkout.PublicRef, ct);
        return completed.IsFailure
            ? Result<ConnectorCheckoutPaidDto>.Failure(completed.Error)
            : Result<ConnectorCheckoutPaidDto>.Success(new ConnectorCheckoutPaidDto(
                checkout.PublicRef, completed.Value!.Succeeded ? "settled" : "pending", completed.Value.Message));
    }
}

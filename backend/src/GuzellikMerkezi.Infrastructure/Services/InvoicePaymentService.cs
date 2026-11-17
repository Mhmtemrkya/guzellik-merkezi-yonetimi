using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <inheritdoc cref="IInvoicePaymentService"/>
public sealed class InvoicePaymentService(
    GuzellikDbContext db,
    IPaymentGatewayResolver gateways,
    IAuditLogger audit) : IInvoicePaymentService
{
    private static readonly string[] OpenStatuses = ["Sent", "Overdue"];

    public async Task<Result<CheckoutStartedDto>> StartAsync(Guid tenantId, Guid invoiceId, string callbackUrl, CancellationToken ct = default)
    {
        var context = await gateways.ResolveAsync(ct);
        if (context.IsFailure) return Result<CheckoutStartedDto>.Failure(context.Error);
        if (context.Value!.Gateway is not MaydanozPaymentGateway maydanoz)
            return Result<CheckoutStartedDto>.Failure(Error.Conflict("Fatura ödemesi yalnız Maydanoz ödeme sayfasından alınır."));

        var invoice = await db.TenantInvoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invoiceId && i.TenantId == tenantId, ct);
        if (invoice is null) return Result<CheckoutStartedDto>.Failure(Error.NotFound("Fatura bulunamadı."));
        if (!OpenStatuses.Contains(invoice.Status))
            return Result<CheckoutStartedDto>.Failure(Error.Conflict("Bu fatura ödemeye açık değil."));
        if (invoice.AmountTRY <= 0)
            return Result<CheckoutStartedDto>.Failure(Error.Conflict("Bu faturanın ödenecek tutarı yok."));

        var init = await maydanoz.InitInvoiceCheckoutAsync(invoice, callbackUrl, ct);
        await audit.LogAsync(tenantId, null, "InvoicePaymentStarted", "TenantInvoice", invoice.Id,
            $"Fatura ödemesi Maydanoz'a yönlendirildi: {invoice.Number} · {invoice.AmountTRY:N2} TL", new { invoice.Number }, ct);
        return Result<CheckoutStartedDto>.Success(new CheckoutStartedDto(init.CheckoutToken, null, init.PaymentPageUrl, invoice.AmountTRY));
    }

    public async Task<Result<InvoicePaymentOutcome>> SettleAsync(ExternalCheckout checkout, CancellationToken ct = default)
    {
        if (checkout.Kind != ExternalCheckout.KindInvoice || checkout.InvoiceId is not { } invoiceId || checkout.Status != ExternalCheckout.StatusPaid)
            return Result<InvoicePaymentOutcome>.Failure(Error.Validation("Bu kayıt ödenmiş bir fatura ödemesi değil."));

        // TEK KAZANAN: fatura satırı kilitlenir — iki bildirim (ya da platformun elle "Ödendi"si) aynı
        // faturayı iki kez kapatamaz, bekleyen şube iki kez açılmaz.
        var relational = db.Database.IsRelational();
        await using var tx = relational && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        if (relational) await RowLock.LockRowAsync(db, "tenant_invoices", invoiceId, ct);

        var invoice = await db.TenantInvoices.FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
        if (invoice is null) return Result<InvoicePaymentOutcome>.Failure(Error.NotFound("Fatura bulunamadı."));
        if (relational) await db.Entry(invoice).ReloadAsync(ct);
        var paymentId = checkout.ProviderPaymentId!;

        if (invoice.Status == "Paid")
        {
            if (string.Equals(invoice.PaymentReference, paymentId, StringComparison.Ordinal))
                return Result<InvoicePaymentOutcome>.Success(new InvoicePaymentOutcome(true, "Fatura zaten bu ödemeyle kapatılmıştı."));
            return await RejectAsync(tx, invoice, checkout, "Fatura başka bir ödemeyle kapatılmış; bu ödeme iade edilmeli.", ct);
        }

        if (invoice.Status == "Cancelled")
            return await RejectAsync(tx, invoice, checkout, "İptal edilmiş faturaya ödeme geldi; bu ödeme iade edilmeli.", ct);

        if (checkout.PaidAmountTRY != invoice.AmountTRY || !string.Equals(checkout.PaidCurrency, "TRY", StringComparison.Ordinal))
            return await RejectAsync(tx, invoice, checkout, $"Ödenen tutar ({checkout.PaidAmountTRY:N2} {checkout.PaidCurrency}) fatura tutarıyla ({invoice.AmountTRY:N2} TRY) aynı değil; fatura kapatılmadı.", ct);

        // Aynı Maydanoz ödemesi başka bir deftere (abonelik/kredi/başka fatura) yazılamaz.
        if (await ProviderPaymentClaims.TryClaimAsync(db, MaydanozPaymentGateway.ProviderName, paymentId,
                ProviderPaymentClaim.TenantInvoiceLedger, invoice.Id, invoice.TenantId, ct)
            == ProviderPaymentClaims.ClaimOutcome.OwnedByAnother)
        {
            return await RejectAsync(tx, invoice, checkout, "Bu ödeme başka bir deftere işlenmiş; fatura kapatılmadı.", ct);
        }

        var now = DateTime.UtcNow;
        invoice.MarkPaid(checkout.PaidAtUtc ?? now, paymentId);
        var opened = await InvoiceBranches.OpenPendingAsync(db, invoice, ct);
        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);

        await audit.LogAsync(invoice.TenantId, null, "InvoicePaidOnline", "TenantInvoice", invoice.Id,
            $"Fatura Maydanoz'da ödendi: {invoice.Number} · {invoice.AmountTRY:N2} TL · ödeme {paymentId}",
            new { invoice.Number, paymentId }, ct);
        if (opened is not null)
        {
            await audit.LogAsync(invoice.TenantId, opened.Id, "BranchOpenedOnPayment", "Branch", opened.Id,
                $"Ek şube ödeme alındığı için açıldı: {opened.Name} · fatura {invoice.Number}",
                new { invoice.Number, branchId = opened.Id }, ct);
        }

        return Result<InvoicePaymentOutcome>.Success(new InvoicePaymentOutcome(true, "Fatura ödendi."));
    }

    public async Task<InvoicePaymentOutcome> OutcomeAsync(string checkoutToken, CancellationToken ct = default)
    {
        var token = (checkoutToken ?? string.Empty).Trim();
        var checkout = await db.ExternalCheckouts.AsNoTracking()
            .FirstOrDefaultAsync(c => c.PublicRef == token && c.Kind == ExternalCheckout.KindInvoice, ct);
        if (checkout?.InvoiceId is not { } invoiceId) return new InvoicePaymentOutcome(false, "Ödeme kaydı bulunamadı.");

        var invoice = await db.TenantInvoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
        return invoice is { Status: "Paid" } && checkout.Status == ExternalCheckout.StatusPaid
            && string.Equals(invoice.PaymentReference, checkout.ProviderPaymentId, StringComparison.Ordinal)
            ? new InvoicePaymentOutcome(true, $"{invoice.Number} numaralı fatura ödendi.")
            : new InvoicePaymentOutcome(false, "Ödemenin sonucu henüz kesinleşmedi; birkaç dakika içinde doğrulanacak.");
    }

    /// <summary>Reddeder: kilit (işlem) önce bırakılır, denetim kaydı sonra yazılır — geri alınmasın.</summary>
    private async Task<Result<InvoicePaymentOutcome>> RejectAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? tx, TenantInvoice invoice, ExternalCheckout checkout, string reason, CancellationToken ct)
    {
        if (tx is not null) await tx.CommitAsync(ct);
        await audit.LogAsync(invoice.TenantId, null, "InvoicePaymentRejected", "TenantInvoice", invoice.Id,
            $"{invoice.Number}: {reason}", new { checkout.PublicRef, checkout.ProviderPaymentId }, ct);
        return Result<InvoicePaymentOutcome>.Failure(Error.Conflict(reason));
    }
}

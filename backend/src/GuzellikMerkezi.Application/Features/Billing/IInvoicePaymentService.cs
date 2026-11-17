using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Entities;

namespace GuzellikMerkezi.Application.Features.Billing;

/// <summary>
/// Açık faturanın (ek şube, müşteri/onam kademesi, dönem faturası) Maydanoz'da ödenmesi.
/// Kullanıcı kararı 17 Kas 2026: BeautyAsist ödeme almaz; kurum faturayı maydanozasist.com'da öder,
/// fatura Maydanoz'un imzalı "ödendi" bildirimiyle kapanır (şube/kademe o anda açılır).
/// </summary>
public interface IInvoicePaymentService
{
    /// <summary>Ödeme sayfasını hazırlar; yanıt Maydanoz'daki ödeme sayfasının adresidir.</summary>
    Task<Result<CheckoutStartedDto>> StartAsync(Guid tenantId, Guid invoiceId, string callbackUrl, CancellationToken ct = default);

    /// <summary>
    /// Maydanoz'un "ödendi" bildirimi kaydedildikten sonra faturayı kapatır. Tutar ve para birimi
    /// faturayla birebir aynı olmalı; aynı ödemenin tekrarı işlem yapmaz.
    /// </summary>
    Task<Result<InvoicePaymentOutcome>> SettleAsync(ExternalCheckout checkout, CancellationToken ct = default);

    /// <summary>Tarayıcı dönüşü: fatura bu ödemeyle kapandı mı.</summary>
    Task<InvoicePaymentOutcome> OutcomeAsync(string checkoutToken, CancellationToken ct = default);
}

/// <param name="Paid">Fatura bu ödemeyle kapandı.</param>
public sealed record InvoicePaymentOutcome(bool Paid, string Message);

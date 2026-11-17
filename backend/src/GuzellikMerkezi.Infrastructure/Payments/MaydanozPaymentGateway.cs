using System.Security.Cryptography;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Payments;

/// <summary>
/// Ödemeyi Maydanoz'da (maydanozasist.com) aldıran sağlayıcı. Kullanıcı 17 Kas 2026: iyzico yalnız
/// Maydanoz'a bağlıdır, BeautyAsist ödeme almaz; kurum ödeme için Maydanoz'a YÖNLENDİRİLİR.
/// <para>
/// Akış: <see cref="InitCheckoutAsync"/> bir <see cref="ExternalCheckout"/> satırı açar ve Maydanoz'daki
/// ödeme sayfasının adresini döner. Maydanoz tutarı ve dönüş adresini imzalı bağlayıcıdan okur
/// (<c>GET /api/connector/v1/checkouts/{ref}</c>), iyzico ile tahsil eder ve sonucu imzalı bildirir
/// (<c>POST .../paid</c>). Sonuç sorguları (<see cref="RetrieveCheckoutAsync"/>,
/// <see cref="RetrievePaymentAsync"/>) bu satırı okur: bildirim gelmeden ödeme "alındı" sayılmaz,
/// bekleyen ödeme RED de sayılmaz (sonradan gelen bildirim çözer).
/// </para>
/// <para>Saklı kartla çekim ve iade Maydanoz'dadır; burada açıkça reddedilir (sessiz başarı yok).</para>
/// </summary>
public sealed class MaydanozPaymentGateway(GuzellikDbContext db, string siteBaseUrl) : IPaymentGateway
{
    public const string ProviderName = "Maydanoz";

    /// <summary>Maydanoz'daki ürün kodu: ödeme sayfası <c>/odeme/asist/beauty/{ref}</c>.</summary>
    public const string AsistCode = "beauty";

    public string Provider => ProviderName;

    public static string NewRef() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public async Task<Result<CheckoutInitResult>> InitCheckoutAsync(CheckoutInitRequest request, CancellationToken ct = default)
    {
        if (!Guid.TryParseExact(request.BuyerId, "N", out var tenantId))
            return Result<CheckoutInitResult>.Failure(Error.Validation("Kurum kimliği okunamadı."));
        var kind = string.Equals(request.PaymentGroup, "PRODUCT", StringComparison.OrdinalIgnoreCase)
            ? ExternalCheckout.KindCredit
            : ExternalCheckout.KindSubscription;
        var checkout = new ExternalCheckout(NewRef(), request.ConversationId, kind, tenantId, request.AmountTry,
            request.BasketItemName, request.CallbackUrl, DateTime.UtcNow);
        db.ExternalCheckouts.Add(checkout);
        await db.SaveChangesAsync(ct);
        // Form gömülmez: ödeme Maydanoz'un kendi sayfasında alınır; istemci yalnız yönlenir.
        return Result<CheckoutInitResult>.Success(new CheckoutInitResult(checkout.PublicRef, null, PageUrl(checkout.PublicRef)));
    }

    /// <summary>
    /// Açık faturanın ödeme sayfası. Aynı fatura için süresi dolmamış, tutarı aynı bekleyen bir ödeme
    /// varsa o yeniden kullanılır: kurum iki sekmeden iki ayrı ödeme başlatamaz.
    /// </summary>
    public async Task<CheckoutInitResult> InitInvoiceCheckoutAsync(TenantInvoice invoice, string callbackUrl, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var checkout = await db.ExternalCheckouts.AsNoTracking()
            .Where(c => c.InvoiceId == invoice.Id && c.Status == ExternalCheckout.StatusPending
                        && c.ExpiresAtUtc > now && c.AmountTRY == invoice.AmountTRY)
            .OrderByDescending(c => c.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);
        if (checkout is null)
        {
            var notes = string.IsNullOrWhiteSpace(invoice.Notes) ? string.Empty : $" · {invoice.Notes.Trim()}";
            var description = $"Fatura {invoice.Number}{notes}";
            checkout = new ExternalCheckout(NewRef(), $"inv-{invoice.Id:N}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
                ExternalCheckout.KindInvoice, invoice.TenantId, invoice.AmountTRY,
                description.Length > 120 ? description[..120] : description, callbackUrl, now, invoice.Id);
            db.ExternalCheckouts.Add(checkout);
            await db.SaveChangesAsync(ct);
        }

        return new CheckoutInitResult(checkout.PublicRef, null, PageUrl(checkout.PublicRef));
    }

    private string PageUrl(string reference) => $"{siteBaseUrl.TrimEnd('/')}/odeme/asist/{AsistCode}/{reference}";

    public async Task<Result<CheckoutResult>> RetrieveCheckoutAsync(string checkoutToken, CancellationToken ct = default)
    {
        var token = (checkoutToken ?? string.Empty).Trim();
        var checkout = await db.ExternalCheckouts.AsNoTracking().FirstOrDefaultAsync(c => c.PublicRef == token, ct);
        if (checkout is null) return Result<CheckoutResult>.Failure(Error.NotFound("Ödeme kaydı bulunamadı."));
        var (succeeded, outcome, message) = Read(checkout);
        return Result<CheckoutResult>.Success(new CheckoutResult(
            succeeded, checkout.ConversationId, checkout.ProviderPaymentId, checkout.PaidAmountTRY ?? 0m,
            null, null, null, null, null, null,
            succeeded ? null : "MAYDANOZ_PENDING", message, checkout.PaidCurrency, outcome));
    }

    public async Task<Result<ChargeResult>> RetrievePaymentAsync(string conversationId, CancellationToken ct = default)
    {
        var checkout = await db.ExternalCheckouts.AsNoTracking().FirstOrDefaultAsync(c => c.ConversationId == conversationId, ct);
        if (checkout is null)
        {
            // Bu işlem Maydanoz'a hiç gönderilmemiş: sağlayıcıda karşılığı yok, belirsiz sayılır.
            return Result<ChargeResult>.Success(new ChargeResult(false, conversationId, null, 0m, "MAYDANOZ_UNKNOWN",
                "Ödeme Maydanoz'da bulunamadı.", null, PaymentOutcome.Unresolved));
        }
        var (succeeded, outcome, message) = Read(checkout);
        return Result<ChargeResult>.Success(new ChargeResult(succeeded, checkout.ConversationId, checkout.ProviderPaymentId,
            checkout.PaidAmountTRY ?? 0m, succeeded ? null : "MAYDANOZ_PENDING", message, checkout.PaidCurrency, outcome));
    }

    public Task<Result<ChargeResult>> ChargeStoredCardAsync(StoredCardChargeRequest request, CancellationToken ct = default) =>
        Task.FromResult(Result<ChargeResult>.Failure(Error.Conflict(
            "Kayıtlı kartla çekim Maydanoz üzerinden yapılmaz; ödeme Maydanoz'un ödeme sayfasında alınır.")));

    public Task<Result> RefundAsync(string providerPaymentId, decimal amount, CancellationToken ct = default) =>
        Task.FromResult(Result.Failure(Error.Conflict("İade Maydanoz panelinden yapılır.")));

    /// <summary>Ödendi → kesin başarı; bekliyor → BELİRSİZ (red değil: kullanıcı hâlâ ödeyebilir, bildirim gecikebilir).</summary>
    private static (bool Succeeded, PaymentOutcome Outcome, string? Message) Read(ExternalCheckout checkout) =>
        checkout.Status == ExternalCheckout.StatusPaid
            ? (true, PaymentOutcome.Succeeded, null)
            : (false, PaymentOutcome.Unresolved, "Ödeme Maydanoz'da henüz tamamlanmadı.");
}

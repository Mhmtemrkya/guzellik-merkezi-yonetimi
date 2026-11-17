using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Application.Features.TenantSignup;
using GuzellikMerkezi.Domain.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// MAYDANOZ'DA SATIN ALMA (kullanıcı kararı 17 Kas 2026: ödeme maydanozasist.com/paketler'de, iyzico
/// yalnız Maydanoz'a bağlı). Kurum BeautyAsist'i Maydanoz'da satın alır; Maydanoz ödemeden ÖNCE tutarı
/// ve uygunluğu sorar (<see cref="QuoteAsync"/>), ödeme alınınca imzalı bildirimle hesabı açtırır
/// (<see cref="CreatePaidAsync"/>).
/// <para>
/// Açılan kurum: aktif ücretli abonelik (deneme yok), tek şube, ödenmiş fatura (Maydanoz sipariş
/// kimliğiyle). ŞİFRE YOK: yönetici rastgele, kimsenin bilmediği bir geçici parolayla açılır; giriş
/// için "Şifremi unuttum" ile kendi parolasını belirler (kod e-postasına gelir). Maydanoz parolayı
/// hiç görmez; e-postaya parola yazılmaz (mevcut kayıt akışıyla aynı ilke).
/// </para>
/// </summary>
public sealed partial class TenantSignupService : IConnectorSignups
{
    /// <summary>Maydanoz siparişleri için tekrar koruması anahtarı (ExternalCheckout.ConversationId).</summary>
    private const string SignupConversationPrefix = "mz-signup-";

    private const string DefaultBranchName = "Merkez";

    [GeneratedRegex("^chk_[0-9a-z]{26}$", RegexOptions.CultureInvariant, 100)]
    private static partial Regex MaydanozOrderPattern();

    private string LoginUrl => $"{(_config["App:PublicBaseUrl"] ?? "https://beautyasist.com").TrimEnd('/')}/login";

    public async Task<Result<ConnectorSignupQuoteDto>> QuoteAsync(ConnectorSignupQuoteRequest request, CancellationToken ct = default)
    {
        if (ParsePeriod(request.Period) is not { } period)
            return Result<ConnectorSignupQuoteDto>.Failure(Error.Validation("Dönem 'monthly' ya da 'yearly' olmalı."));

        var plan = await ResolveTrialPlanAsync(ct);
        if (plan is null)
            return Result<ConnectorSignupQuoteDto>.Failure(Error.Conflict("Satışa açık paket bulunamadı."));

        var quote = SubscriptionPricing.Quote(plan, period, new BillingCounts(1, 0, 0));

        // Kişi bilgisi verildiyse uygunluk da söylenir: ödeme ALINMADAN önce. Hesap açılamayacak bir
        // ödeme (kayıtlı e-posta/telefon/işletme adı) iade gerektirirdi.
        string? reason = null;
        if (!string.IsNullOrWhiteSpace(request.Email) || !string.IsNullOrWhiteSpace(request.Phone) || !string.IsNullOrWhiteSpace(request.TenantName))
        {
            var form = PaidForm(request.TenantName, "Ad Soyad", request.Email, request.Phone, "Şehir");
            reason = Validate(form) ?? (await IsDuplicateAsync(form, ct)
                ? "Bu e-posta, telefon ya da işletme adıyla kayıtlı bir BeautyAsist hesabı var. Ödemeyi BeautyAsist panelinizden (Paketim) yapabilirsiniz."
                : null);
        }

        return Result<ConnectorSignupQuoteDto>.Success(new ConnectorSignupQuoteDto(
            reason is null, reason, plan.Name, PeriodWire(period), Math.Max(1, quote.Branches),
            Kurus(quote.Subtotal), Kurus(quote.Vat), Kurus(quote.Total),
            $"{plan.Name} · {(period == BillingPeriod.Yearly ? "Yıllık" : "Aylık")} abonelik · 1 şube"));
    }

    public async Task<Result<ConnectorSignupDto>> CreatePaidAsync(ConnectorSignupRequest request, CancellationToken ct = default)
    {
        var orderId = (request.OrderId ?? string.Empty).Trim();
        if (!MaydanozOrderPattern().IsMatch(orderId) || ParsePeriod(request.Period) is not { } period
            || request.AmountKurus <= 0 || !string.Equals(request.Currency?.Trim(), "TRY", StringComparison.OrdinalIgnoreCase))
        {
            return Result<ConnectorSignupDto>.Failure(Error.Validation("Satın alma bildirimi eksik ya da geçersiz."));
        }

        // TEKRAR: aynı Maydanoz siparişi ikinci kez gelirse (yeniden deneme) yeni kurum açılmaz.
        var conversationId = SignupConversationPrefix + orderId;
        var existing = await _db.ExternalCheckouts.AsNoTracking().FirstOrDefaultAsync(c => c.ConversationId == conversationId, ct);
        if (existing is not null)
        {
            var code = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Id == existing.TenantId).Select(t => t.Code).FirstOrDefaultAsync(ct) ?? string.Empty;
            return Result<ConnectorSignupDto>.Success(new ConnectorSignupDto(existing.TenantId, code, LoginUrl, Created: false, EmailSent: false));
        }

        var form = PaidForm(request.TenantName, request.OwnerName, request.Email, request.Phone, request.City);
        if (Validate(form) is { } invalid) return Result<ConnectorSignupDto>.Failure(Error.Validation(invalid));

        var plan = await ResolveTrialPlanAsync(ct);
        if (plan is null) return Result<ConnectorSignupDto>.Failure(Error.Conflict("Satışa açık paket bulunamadı."));

        // TUTAR BEAUTYASIST'İN: ödenen, bugünkü tekliften farklıysa hesap açılmaz (Maydanoz iade eder).
        var quote = SubscriptionPricing.Quote(plan, period, new BillingCounts(1, 0, 0));
        if (Kurus(quote.Total) != request.AmountKurus)
        {
            _logger.LogError("Maydanoz satın alması tutar uyuşmazlığı: sipariş {Order}, ödenen {Paid}, beklenen {Expected} kuruş.",
                orderId, request.AmountKurus, Kurus(quote.Total));
            return Result<ConnectorSignupDto>.Failure(Error.Conflict("Ödenen tutar paket tutarıyla aynı değil; hesap açılmadı."));
        }

        if (await IsDuplicateAsync(form, ct))
            return Result<ConnectorSignupDto>.Failure(Error.Conflict(DuplicateMessage));

        var now = _clock.UtcNow;
        var slug = await AllocateSlugAsync(form.TenantName, ct);
        for (var attempt = 0; attempt < MaxCodeAttempts; attempt++)
        {
            var code = await TenantCodeAllocator.NextAsync(_db, attempt, ct);
            var tenant = new Tenant(form.TenantName, slug, plan.Name, TenantStatus.Active);
            tenant.AssignCode(code);
            tenant.MarkSelfSignup();
            tenant.SetProfile(null, form.OwnerName);
            tenant.SetContact(form.Phone, null);
            tenant.SetProfileExtras(null, null, form.Email);
            tenant.SetPhoneIndex(_search.BuildPhoneKey(form.Phone));
            tenant.StartSubscription(plan, period, now);

            var branch = tenant.AddBranch(form.BranchName, form.City, isDefault: true);
            var owner = tenant.GrantAccess(form.Email, UserRole.InstitutionOwner, null, form.OwnerName);
            // Kimsenin bilmediği geçici parola: giriş "Şifremi unuttum" ile kendi parolasını belirleyerek.
            owner.SetTemporaryPassword(_passwordHasher.Hash(TenantTextHelper.GenerateTempPassword()));
            _db.Tenants.Add(tenant);
            _db.TenantSignupReservations.Add(new TenantSignupReservation(
                tenant.Id, form.Email, _search.BuildPhoneKey(form.Phone) ?? PhoneMask.LoginKey(form.Phone)));

            var invoice = new TenantInvoice(tenant.Id, await NextInvoiceNumberAsync(now, ct), now,
                period == BillingPeriod.Yearly ? now.AddYears(1) : now.AddMonths(1), quote.Total,
                $"{plan.Name} · {(period == BillingPeriod.Yearly ? "Yıllık" : "Aylık")} abonelik · maydanozasist.com");
            invoice.ApplyQuote(quote);
            invoice.MarkPaid(now, orderId);
            _db.TenantInvoices.Add(invoice);

            // Tekrar koruması ve Maydanoz ödemesinin kaydı (benzersiz ConversationId).
            var record = new ExternalCheckout(MaydanozPaymentGateway.NewRef(), conversationId, ExternalCheckout.KindSignup,
                tenant.Id, quote.Total, $"{plan.Name} satın alma · {code}", LoginUrl, now);
            record.RecordPaid(orderId, request.AmountKurus / 100m, "TRY", now);
            _db.ExternalCheckouts.Add(record);

            await _audit.LogAsync(tenant.Id, branch.Id, "MaydanozSignup", "Tenant", tenant.Id,
                $"Kurum maydanozasist.com'da satın alınarak açıldı ({code}); {quote.Total:N2} TL · sipariş {orderId}.", new { orderId }, ct);

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (TenantCodeAllocator.IsDuplicateCodeError(ex) && attempt < MaxCodeAttempts - 1)
            {
                _db.ChangeTracker.Clear();
                continue;
            }
            catch (Exception ex) when (IsReservationConflict(ex))
            {
                _db.ChangeTracker.Clear();
                return Result<ConnectorSignupDto>.Failure(Error.Conflict(DuplicateMessage));
            }
            catch (DbUpdateException)
            {
                // Aynı sipariş eşzamanlı iki kez geldiyse diğeri açtı: o kurum döner. Değilse hata yükselir.
                _db.ChangeTracker.Clear();
                if (await _db.ExternalCheckouts.AsNoTracking().AnyAsync(c => c.ConversationId == conversationId, ct))
                    return await CreatePaidAsync(request, ct);
                throw;
            }

            var emailSent = await SendPaidWelcomeAsync(form, code, plan.Name, ct);
            _logger.LogInformation("Maydanoz satın almasıyla kurum açıldı: {Code} (sipariş {Order}).", code, orderId);
            return Result<ConnectorSignupDto>.Success(new ConnectorSignupDto(tenant.Id, code, LoginUrl, Created: true, emailSent));
        }

        return Result<ConnectorSignupDto>.Failure(Error.Conflict("Hesap şu anda açılamadı (kurum kodu ayrılamadı). Lütfen tekrar deneyin."));
    }

    private static TenantSignupStartRequest PaidForm(string? tenantName, string? ownerName, string? email, string? phone, string? city) => new(
        TenantName: TenantTextHelper.NormalizeText(tenantName),
        OwnerName: TenantTextHelper.NormalizeText(ownerName),
        Email: TenantTextHelper.NormalizeEmail(email),
        Phone: TenantTextHelper.NormalizeText(phone),
        BranchName: DefaultBranchName,
        City: TenantTextHelper.NormalizeText(city),
        PhoneChannel: null);

    private static BillingPeriod? ParsePeriod(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "monthly" => BillingPeriod.Monthly,
        "yearly" => BillingPeriod.Yearly,
        _ => null,
    };

    private static string PeriodWire(BillingPeriod period) => period == BillingPeriod.Yearly ? "yearly" : "monthly";

    private static long Kurus(decimal lira) => (long)decimal.Round(lira * 100m, 0, MidpointRounding.AwayFromZero);

    /// <summary>Faturanın numarası (BillingService ile aynı biçim: BA-yyyy-000001).</summary>
    private async Task<string> NextInvoiceNumberAsync(DateTime nowUtc, CancellationToken ct)
    {
        var prefix = $"BA-{nowUtc:yyyy}-";
        var used = await _db.TenantInvoices.IgnoreQueryFilters().Where(i => i.Number.StartsWith(prefix)).CountAsync(ct);
        for (var i = 1; i <= 50; i++)
        {
            var candidate = $"{prefix}{(used + i):000000}";
            if (!await _db.TenantInvoices.IgnoreQueryFilters().AnyAsync(x => x.Number == candidate, ct)) return candidate;
        }
        return $"{prefix}{Guid.NewGuid():N}"[..24];
    }

    /// <summary>Hoş geldin e-postası (best-effort). PAROLA YAZILMAZ: giriş "Şifremi unuttum" ile.</summary>
    private async Task<bool> SendPaidWelcomeAsync(TenantSignupStartRequest form, string tenantCode, string planName, CancellationToken ct)
    {
        var login = System.Net.WebUtility.HtmlEncode(LoginUrl);
        var body =
            "<div style='font-family:sans-serif;font-size:15px;color:#2f1724'>" +
            $"<p>Merhaba {System.Net.WebUtility.HtmlEncode(form.OwnerName)},</p>" +
            $"<p>Ödemeniz alındı. <b>{System.Net.WebUtility.HtmlEncode(form.TenantName)}</b> için {System.Net.WebUtility.HtmlEncode(planName)} hesabınız hazır ve aboneliğiniz başladı.</p>" +
            "<table style='border-collapse:collapse;margin:16px 0'>" +
            $"<tr><td style='padding:4px 12px 4px 0;color:#7c6170'>Kurum kodu</td><td style='font-weight:700'>{tenantCode}</td></tr>" +
            $"<tr><td style='padding:4px 12px 4px 0;color:#7c6170'>E-posta</td><td>{System.Net.WebUtility.HtmlEncode(form.Email)}</td></tr>" +
            "</table>" +
            $"<p><b>İlk giriş:</b> <a href='{login}'>{login}</a> adresinde <b>“Şifremi unuttum”</b> bağlantısıyla " +
            "bu e-posta adresine gelen kodu girip kendi şifrenizi belirleyin. Güvenlik gereği şifre e-postayla gönderilmez.</p>" +
            $"<p>Destek almak için <b>kurum kodunuzu</b> ({tenantCode}) belirtmeniz yeterlidir.</p></div>";

        return await TrySendAsync(() => _messaging.SendEmailAsync(form.Email, $"BeautyAsist hesabınız hazır ({tenantCode})", body, ct), "satın alma hoş geldin e-postası");
    }
}

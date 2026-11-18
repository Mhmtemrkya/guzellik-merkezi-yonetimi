using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Services;

public sealed record ConnectorAccountLoginRequest(string? Email, string? Password, Guid? TenantId = null);

public sealed record ConnectorAccountTenantDto(Guid TenantId, string Name, string? Code, string Status);

/// <summary>Giriş adımı: <c>code</c> (e-postaya kod gitti) ya da <c>tenant</c> (birden çok kurum; seçim gerekir).</summary>
public sealed record ConnectorAccountLoginDto(
    string Step, string? ChallengeId = null, string? MaskedEmail = null, string? DevCode = null,
    IReadOnlyList<ConnectorAccountTenantDto>? Tenants = null)
{
    public const string StepCode = "code";
    public const string StepTenant = "tenant";
}

public sealed record ConnectorAccountVerifyRequest(string? ChallengeId, string? Code);

/// <summary>Kod doğrulandı: Maydanoz kendi oturumunu bu kimlikle açar (BeautyAsist oturumu/token'ı VERİLMEZ).</summary>
public sealed record ConnectorAccountIdentityDto(Guid TenantId, Guid UserId, string Email, string? FullName, string TenantName, string? TenantCode);

public sealed record ConnectorPriceDto(long NetKurus, long VatKurus, long TotalKurus, int Branches);

/// <summary>Hesabım sayfası: durum + ödeme formuna doldurulacak bilgiler + bu kurumun güncel tutarları.</summary>
public sealed record ConnectorAccountDto(
    Guid TenantId, string? Code, string Name, string Status, bool TrialStarted, DateTime? TrialEndsAtUtc, DateTime? SubscriptionEndsAtUtc,
    string? Period, string? PlanName, int Branches, string? OwnerName, string? Email, string? Phone, string? City,
    string? LegalName, string? TaxOffice, string? TaxNumber, ConnectorPriceDto? Monthly, ConnectorPriceDto? Yearly);

public sealed record ConnectorAccountCheckoutRequest(string? Period, string? ReturnUrl);

/// <summary>Satışta olan kredi paketi (tutar kuruş, KDV dahil).</summary>
public sealed record ConnectorCreditPackageDto(Guid Id, string Name, string? Description, long PriceKurus, decimal Credits, int EstimatedMessages);

/// <summary>Bir kredi kanalının bakiyesi, paket dışı birim fiyatı (kuruş) ve paketleri.</summary>
public sealed record ConnectorCreditChannelDto(decimal Available, long UnitPriceKurus, IReadOnlyList<ConnectorCreditPackageDto> Packages);

/// <summary>Hesabım'daki mesaj kredisi: WhatsApp ve SMS kredisi AYRI (18 Kas 2026).</summary>
public sealed record ConnectorAccountCreditsDto(ConnectorCreditChannelDto WhatsApp, ConnectorCreditChannelDto Sms);

/// <summary>Kredi satın alma: kanal + (paket ya da özel miktar) + Maydanoz'a dönüş adresi.</summary>
public sealed record ConnectorAccountCreditCheckoutRequest(string? Channel, Guid? PackageId, int? Credits, string? ReturnUrl);

public sealed record ConnectorAccountCheckoutDto(string Reference, string Url, long AmountKurus);

/// <summary>
/// MAYDANOZ'DA GİRİŞ VE SATIN ALMA (kullanıcı kararı 18 Kas 2026). Kurum sahibi maydanozasist.com'da BeautyAsist
/// hesabıyla girer: parola + hesap kilidi + e-posta kodu BURADA denetlenir (panel girişiyle aynı kilit eşiği),
/// Maydanoz yalnız doğrulanmış kimliği alır — BeautyAsist oturumu ya da token'ı ona verilmez.
/// <para>
/// Panel girişinden FARKI: süresi dolmuş (deneme/abonelik) kurumun sahibi de girer — satın almanın tek yolu budur.
/// Elle askıya alınmış ya da iptal edilmiş kurum giremez.
/// </para>
/// </summary>
public sealed class ConnectorAccountService(
    GuzellikDbContext db,
    IPasswordHasher hasher,
    IOtpStateStore store,
    IPlatformMessagingService messaging,
    IBillingService billing,
    IDateTimeProvider clock,
    IHostEnvironment env,
    ILogger<ConnectorAccountService> logger,
    IWhatsAppBillingService credits)
{
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(10);
    private const int MaxAttempts = 5;
    private const int LockoutThreshold = 8;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
    private const string WrongCredentials = "E-posta ya da şifre hatalı.";

    internal sealed class PendingAccountLogin
    {
        public string Code { get; set; } = string.Empty;
        public Guid UserId { get; set; }
        public Guid TenantId { get; set; }
        public int Attempts { get; set; }
    }

    private static string Key(string id) => $"connector-account-login:{id}";

    public async Task<Result<ConnectorAccountLoginDto>> LoginAsync(ConnectorAccountLoginRequest request, CancellationToken ct)
    {
        var email = TenantTextHelper.NormalizeEmail(request.Email);
        var password = request.Password ?? string.Empty;
        if (email.Length == 0 || password.Length == 0)
            return Result<ConnectorAccountLoginDto>.Failure(Error.Validation("E-posta ve şifrenizi yazın."));

        var query = db.TenantUsers.IgnoreQueryFilters().Include(u => u.Tenant)
            .Where(u => u.Email == email && u.Role == UserRole.InstitutionOwner && u.IsActive);
        if (request.TenantId is { } chosen) query = query.Where(u => u.TenantId == chosen);
        var candidates = await query.ToListAsync(ct);

        var now = clock.UtcNow;
        var open = candidates.Where(u => !u.IsLockedOut(now)).ToList();
        var matched = open.Where(u => hasher.Verify(password, u.PasswordHash)).ToList();
        if (matched.Count == 0)
        {
            foreach (var user in open) user.RegisterFailedLogin(now, LockoutThreshold, LockoutDuration);
            await db.SaveChangesAsync(ct);
            if (candidates.FirstOrDefault(u => u.IsLockedOut(now)) is { } locked)
            {
                var minutes = Math.Max(1, (int)Math.Ceiling((locked.LockedUntilUtc!.Value - now).TotalMinutes));
                return Result<ConnectorAccountLoginDto>.Failure(Error.Unauthorized(
                    $"Çok fazla hatalı giriş nedeniyle hesap geçici olarak kilitlendi. {minutes} dakika sonra tekrar deneyin."));
            }

            return Result<ConnectorAccountLoginDto>.Failure(Error.Unauthorized(WrongCredentials));
        }

        foreach (var user in matched) user.ResetFailedLogins();
        await db.SaveChangesAsync(ct);

        var usable = matched.Where(u => u.Tenant is not null && StatusOf(u.Tenant, now) is not ("cancelled" or "suspended")).ToList();
        if (usable.Count == 0)
        {
            return Result<ConnectorAccountLoginDto>.Failure(Error.Unauthorized(
                "Kurumunuz şu anda kapalı. Lütfen bizimle iletişime geçin."));
        }

        if (usable.Count > 1)
        {
            return Result<ConnectorAccountLoginDto>.Success(new ConnectorAccountLoginDto(ConnectorAccountLoginDto.StepTenant, Tenants:
                usable.Select(u => new ConnectorAccountTenantDto(u.TenantId, u.Tenant!.Name, u.Tenant.Code, StatusOf(u.Tenant, now)))
                    .OrderBy(t => t.Name, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true)).ToList()));
        }

        var owner = usable[0];
        var code = RandomNumberGenerator.GetInt32(100000, 1000000).ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (!await SendCodeAsync(email, owner.Tenant!.Name, code, ct))
        {
            logger.LogError("Maydanoz giriş kodu gönderilemedi: {Email}.", EmailMask.Mask(email));
            return Result<ConnectorAccountLoginDto>.Failure(Error.Unauthorized("Doğrulama kodu gönderilemedi. Lütfen daha sonra tekrar deneyin."));
        }

        var challengeId = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        await store.SetAsync(Key(challengeId), new PendingAccountLogin { Code = code, UserId = owner.Id, TenantId = owner.TenantId }, ChallengeLifetime, ct);
        return Result<ConnectorAccountLoginDto>.Success(new ConnectorAccountLoginDto(
            ConnectorAccountLoginDto.StepCode, challengeId, TenantTextHelper.MaskEmail(email), env.IsDevelopment() ? code : null));
    }

    public async Task<Result<ConnectorAccountIdentityDto>> VerifyAsync(ConnectorAccountVerifyRequest request, CancellationToken ct)
    {
        var id = (request.ChallengeId ?? string.Empty).Trim();
        var code = (request.Code ?? string.Empty).Trim();
        if (id.Length == 0)
            return Result<ConnectorAccountIdentityDto>.Failure(Error.Unauthorized("Giriş oturumunuz sona ermiş. Lütfen baştan başlayın."));

        // Deneme sayacı ve tek kullanım DEPO KİLİDİ altında (eşzamanlı iki istek aynı kodu iki kez kullanamaz).
        var decision = await store.MutateAsync<PendingAccountLogin, (PendingAccountLogin? Pending, string? Failure)>(Key(id), ChallengeLifetime, pending =>
        {
            if (pending is null) return (null, (null, "Giriş oturumunuz sona ermiş. Lütfen baştan başlayın."));
            if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(pending.Code), System.Text.Encoding.ASCII.GetBytes(code)))
            {
                pending.Attempts++;
                return pending.Attempts >= MaxAttempts
                    ? (null, (null, "Çok fazla hatalı deneme. Lütfen baştan başlayın."))
                    : (pending, (null, "Kod hatalı. Lütfen tekrar deneyin."));
            }

            return (null, (pending, null));
        }, ct);
        if (decision.Failure is not null) return Result<ConnectorAccountIdentityDto>.Failure(Error.Unauthorized(decision.Failure));

        var pending = decision.Pending!;
        var user = await db.TenantUsers.IgnoreQueryFilters().Include(u => u.Tenant).AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == pending.UserId && u.TenantId == pending.TenantId && u.IsActive, ct);
        if (user?.Tenant is null)
            return Result<ConnectorAccountIdentityDto>.Failure(Error.Unauthorized("Hesap bulunamadı."));
        return Result<ConnectorAccountIdentityDto>.Success(new ConnectorAccountIdentityDto(
            user.TenantId, user.Id, user.Email, user.FullName, user.Tenant.Name, user.Tenant.Code));
    }

    public async Task<Result<ConnectorAccountDto>> AccountAsync(Guid tenantId, CancellationToken ct)
    {
        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking().Include(t => t.Branches).Include(t => t.Users)
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result<ConnectorAccountDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var now = clock.UtcNow;
        var owner = tenant.Users.Where(u => u.Role == UserRole.InstitutionOwner && u.IsActive).OrderBy(u => u.CreatedAtUtc).FirstOrDefault();
        var branch = tenant.Branches.OrderByDescending(b => b.IsDefault).FirstOrDefault();
        var planId = tenant.SubscriptionPlanId ?? await db.SubscriptionPlans.AsNoTracking().Where(p => p.IsActive)
            .OrderBy(p => p.DisplayOrder).Select(p => (Guid?)p.Id).FirstOrDefaultAsync(ct);
        var planName = planId is { } pid
            ? await db.SubscriptionPlans.AsNoTracking().Where(p => p.Id == pid).Select(p => p.Name).FirstOrDefaultAsync(ct)
            : null;

        return Result<ConnectorAccountDto>.Success(new ConnectorAccountDto(
            tenant.Id, tenant.Code, tenant.Name, StatusOf(tenant, now), tenant.TrialEndsAtUtc.HasValue, tenant.TrialEndsAtUtc, tenant.SubscriptionEndsAtUtc,
            tenant.SubscriptionPeriod switch { BillingPeriod.Yearly => "yearly", BillingPeriod.Monthly => "monthly", _ => null },
            planName, tenant.Branches.Count, owner?.FullName ?? tenant.OwnerName, owner?.Email ?? tenant.Email,
            tenant.Phone, branch?.City, tenant.LegalName, tenant.TaxOffice, tenant.TaxNumber,
            planId is { } m ? await PriceAsync(tenant.Id, m, BillingPeriod.Monthly, ct) : null,
            planId is { } y ? await PriceAsync(tenant.Id, y, BillingPeriod.Yearly, ct) : null));
    }

    public async Task<Result<ConnectorAccountCheckoutDto>> CheckoutAsync(Guid tenantId, ConnectorAccountCheckoutRequest request, CancellationToken ct)
    {
        var period = (request.Period ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "monthly" => (BillingPeriod?)BillingPeriod.Monthly,
            "yearly" => BillingPeriod.Yearly,
            _ => null,
        };
        if (period is null || !Uri.TryCreate(request.ReturnUrl?.Trim(), UriKind.Absolute, out var returnUrl)
            || returnUrl.Scheme != Uri.UriSchemeHttps || request.ReturnUrl!.Trim().Length > 300 || !string.IsNullOrEmpty(returnUrl.UserInfo))
        {
            return Result<ConnectorAccountCheckoutDto>.Failure(Error.Validation("Dönem ya da dönüş adresi geçersiz."));
        }

        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null || StatusOf(tenant, clock.UtcNow) is "cancelled" or "suspended")
            return Result<ConnectorAccountCheckoutDto>.Failure(Error.NotFound("Kurum satın almaya açık değil."));
        var planId = tenant.SubscriptionPlanId ?? await db.SubscriptionPlans.AsNoTracking().Where(p => p.IsActive)
            .OrderBy(p => p.DisplayOrder).Select(p => (Guid?)p.Id).FirstOrDefaultAsync(ct);
        if (planId is null) return Result<ConnectorAccountCheckoutDto>.Failure(Error.Conflict("Satışa açık paket bulunamadı."));

        var started = await billing.StartCheckoutAsync(tenantId, planId.Value, period.Value, returnUrl.AbsoluteUri, ct);
        if (started.IsFailure) return Result<ConnectorAccountCheckoutDto>.Failure(started.Error);
        if (string.IsNullOrWhiteSpace(started.Value!.RedirectUrl))
        {
            // Ödeme Maydanoz'da değilse (sağlayıcı başka) bu yol çalışmaz: gömülü form Maydanoz'a taşınamaz.
            logger.LogError("Maydanoz satın alması başlatılamadı: ödeme sağlayıcısı Maydanoz değil.");
            return Result<ConnectorAccountCheckoutDto>.Failure(Error.Conflict("Ödeme şu an başlatılamıyor. Lütfen daha sonra tekrar deneyin."));
        }

        return Result<ConnectorAccountCheckoutDto>.Success(new ConnectorAccountCheckoutDto(
            started.Value.CheckoutToken, started.Value.RedirectUrl, (long)decimal.Round(started.Value.AmountTRY * 100m, 0, MidpointRounding.AwayFromZero)));
    }

    /// <summary>
    /// HESABIM'DA MESAJ KREDİSİ (kullanıcı kararı 18 Kas 2026: "SMS ayrı, WhatsApp ayrı kredi al kısmı Maydanoz'da da
    /// olsun"). Bakiye, birim fiyat ve paketler kanal başına; tutarları BeautyAsist hesaplar.
    /// </summary>
    public async Task<Result<ConnectorAccountCreditsDto>> CreditsAsync(Guid tenantId, CancellationToken ct)
    {
        if (!await db.Tenants.IgnoreQueryFilters().AsNoTracking().AnyAsync(t => t.Id == tenantId, ct))
            return Result<ConnectorAccountCreditsDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        var wallet = await credits.GetWalletAsync(tenantId, ct);
        if (wallet.IsFailure) return Result<ConnectorAccountCreditsDto>.Failure(wallet.Error);
        var w = wallet.Value!;
        ConnectorCreditChannelDto Channel(CreditChannel channel, decimal available, decimal unitPrice) => new(
            available, Kurus(unitPrice),
            w.CreditPackages.Where(p => p.IsActive && p.Channel == channel)
                .Select(p => new ConnectorCreditPackageDto(p.Id, p.Name, p.Description, Kurus(p.PriceTry), p.GrantsCredits, p.EstimatedUtilityMessages))
                .ToList());
        return Result<ConnectorAccountCreditsDto>.Success(new ConnectorAccountCreditsDto(
            Channel(CreditChannel.WhatsApp, w.AvailableCredits, w.CreditUnitPriceTry),
            Channel(CreditChannel.Sms, w.SmsAvailableCredits, w.SmsCreditUnitPriceTry)));
    }

    /// <summary>Kredi satın alma Maydanoz'da: kayıt BeautyAsist'te açılır, tarayıcı Maydanoz ödeme sayfasına gider.</summary>
    public async Task<Result<ConnectorAccountCheckoutDto>> CreditCheckoutAsync(Guid tenantId, ConnectorAccountCreditCheckoutRequest request, CancellationToken ct)
    {
        var channel = (request.Channel ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "whatsapp" => (CreditChannel?)CreditChannel.WhatsApp,
            "sms" => CreditChannel.Sms,
            _ => null,
        };
        if (channel is null || (request.PackageId is null && request.Credits is not > 0)
            || !Uri.TryCreate(request.ReturnUrl?.Trim(), UriKind.Absolute, out var returnUrl)
            || returnUrl.Scheme != Uri.UriSchemeHttps || request.ReturnUrl!.Trim().Length > 300 || !string.IsNullOrEmpty(returnUrl.UserInfo))
        {
            return Result<ConnectorAccountCheckoutDto>.Failure(Error.Validation("Kredi türü, paket / miktar ya da dönüş adresi geçersiz."));
        }

        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null || StatusOf(tenant, clock.UtcNow) is "cancelled" or "suspended")
            return Result<ConnectorAccountCheckoutDto>.Failure(Error.NotFound("Kurum satın almaya açık değil."));

        var started = await credits.StartCreditCheckoutAsync(tenantId, new TopUpRequest(request.PackageId, request.Credits, channel), returnUrl.AbsoluteUri, null, ct);
        if (started.IsFailure) return Result<ConnectorAccountCheckoutDto>.Failure(started.Error);
        if (string.IsNullOrWhiteSpace(started.Value!.RedirectUrl))
        {
            logger.LogError("Maydanoz kredi satın alması başlatılamadı: ödeme sağlayıcısı Maydanoz değil.");
            return Result<ConnectorAccountCheckoutDto>.Failure(Error.Conflict("Ödeme şu an başlatılamıyor. Lütfen daha sonra tekrar deneyin."));
        }

        return Result<ConnectorAccountCheckoutDto>.Success(new ConnectorAccountCheckoutDto(
            started.Value.CheckoutToken, started.Value.RedirectUrl, Kurus(started.Value.AmountTRY)));
    }

    private async Task<ConnectorPriceDto?> PriceAsync(Guid tenantId, Guid planId, BillingPeriod period, CancellationToken ct)
    {
        var quote = await billing.GetQuoteAsync(tenantId, planId, period, ct);
        return quote.IsFailure ? null : new ConnectorPriceDto(Kurus(quote.Value!.Subtotal), Kurus(quote.Value.Vat), Kurus(quote.Value.Total), Math.Max(1, quote.Value.Branches));
    }

    private static long Kurus(decimal lira) => (long)decimal.Round(lira * 100m, 0, MidpointRounding.AwayFromZero);

    /// <summary>Sözleşmedeki durum: trial · active · expired (deneme/abonelik bitti) · suspended (elle) · cancelled.</summary>
    public static string StatusOf(Tenant tenant, DateTime now)
    {
        var trialEnded = tenant.TrialEndsAtUtc is { } trial && trial <= now;
        var subscriptionEnded = tenant.SubscriptionEndsAtUtc is { } sub && sub <= now;
        return tenant.Status switch
        {
            TenantStatus.Cancelled => "cancelled",
            TenantStatus.Trial => trialEnded ? "expired" : "trial",
            TenantStatus.Active => subscriptionEnded ? "expired" : "active",
            _ => trialEnded || subscriptionEnded ? "expired" : "suspended",
        };
    }

    private async Task<bool> SendCodeAsync(string email, string tenantName, string code, CancellationToken ct)
    {
        var body = VerificationEmailTemplate.Build(new VerificationEmailContent(
            Code: code,
            Email: email,
            Validity: ChallengeLifetime,
            OperationType: "maydanozasist.com hesap girişi",
            TenantName: tenantName,
            SecurityNote: "Bu girişi siz yapmadıysanız şifrenizi hemen değiştirin."));
        try
        {
            var result = await messaging.SendEmailAsync(email, "maydanozasist.com giriş kodunuz", body, ct);
            return result.Success && (!result.Simulated || env.IsDevelopment());
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Maydanoz giriş kodu gönderilemedi.");
            return false;
        }
    }
}

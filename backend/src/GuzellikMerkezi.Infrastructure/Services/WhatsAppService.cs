using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class WhatsAppService : IWhatsAppService
{
    private const string DefaultTemplate =
        "Merhaba {ad}, {tarih} {saat} tarihli {hizmet} randevunuzu hatırlatırız. " +
        "Onaylıyorsanız EVET, iptal için HAYIR, ertelemek için ERTELE yazın. — {salon}";

    // Bekleme listesi otomasyonu şablonları (sabit — hatırlatma şablonundan bağımsız).
    private const string WaitlistOfferTemplate =
        "Merhaba {ad}, {tarih} {saat} için yer açıldı! {hizmet} randevusunu istiyorsanız EVET, " +
        "vazgeçmek için HAYIR yazın. — {salon}";
    private const string WaitlistActivatedTemplate =
        "Merhaba {ad}, {tarih} {saat} {hizmet} randevunuz aktifleşti. Sizi bekliyoruz! — {salon}";
    private const string RatingLinkTemplate =
        "Merhaba {ad}! {salon} ziyaretiniz için teşekkür ederiz 💐 Deneyiminizi 1 dakikada değerlendirir misiniz? " +
        "Hem personelimizi hem salonumuzu puanlayabilirsiniz: {link} (Bağlantı 24 saat geçerlidir.)";

    private readonly GuzellikDbContext _db;
    private readonly IEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<WhatsAppService> _logger;
    private readonly IFeatureService _features;
    private readonly IWhatsAppBillingService _billing;
    private readonly ICurrentUser _currentUser;
    private readonly IWaitlistService _waitlist;
    private readonly Application.Features.AppNotifications.IAppNotificationService _notifications;

    public WhatsAppService(GuzellikDbContext db, IEncryptionService encryption, IHttpClientFactory httpFactory, IConfiguration config, ILogger<WhatsAppService> logger, IFeatureService features, IWhatsAppBillingService billing, ICurrentUser currentUser, IWaitlistService waitlist, Application.Features.AppNotifications.IAppNotificationService notifications)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
        _features = features;
        _billing = billing;
        _currentUser = currentUser;
        _waitlist = waitlist;
        _notifications = notifications;
    }

    // Personel müşteri telefonunu yalnızca son 4 hane görür; ham numara API'den hiç çıkmaz.
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    // ==================== KURUM: AYAR (içerik + faturalama tercihleri) ====================

    public async Task<Result<WhatsAppSettingsDto>> GetSettingsAsync(Guid tenantId, CancellationToken ct = default)
    {
        var s = await _db.WhatsAppSettings.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        return Result<WhatsAppSettingsDto>.Success(BuildSettingsDto(s));
    }

    public async Task<Result<WhatsAppSettingsDto>> SaveSettingsAsync(Guid tenantId, SaveWhatsAppSettingsRequest request, CancellationToken ct = default)
    {
        var s = await _db.WhatsAppSettings.FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        if (s is null)
        {
            s = new WhatsAppSettings(tenantId);
            _db.WhatsAppSettings.Add(s);
        }
        s.UpdateContent(request.ReminderTemplate);
        s.UpdateBillingPreferences(request.MarketingEnabled, request.AllowWalletOverage, request.MonthlySpendCapTry);
        await _db.SaveChangesAsync(ct);
        return Result<WhatsAppSettingsDto>.Success(BuildSettingsDto(s));
    }

    // ==================== PLATFORM: BAĞLANTI YÖNETİMİ ====================

    public async Task<Result<IReadOnlyCollection<WhatsAppConnectionDto>>> GetConnectionsAsync(CancellationToken ct = default)
    {
        var webhookUrl = BuildWebhookUrl();
        var tenants = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .Where(t => !t.IsDeleted)
            .Select(t => new { t.Id, t.Name, PlanName = t.SubscriptionPlan != null ? t.SubscriptionPlan.Name : null })
            .ToListAsync(ct);

        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .Where(x => !x.IsDeleted)
            .ToListAsync(ct);
        var byTenant = settings.ToDictionary(x => x.TenantId);

        var list = tenants.Select(t =>
        {
            byTenant.TryGetValue(t.Id, out var s);
            return new WhatsAppConnectionDto(
                t.Id, t.Name, t.PlanName,
                s?.PhoneNumberId, s?.BusinessAccountId, s?.DisplayPhoneNumber,
                (s?.ConnectionStatus ?? WhatsAppConnectionStatus.NotConnected).ToString(),
                s?.IsConnected ?? false,
                !string.IsNullOrWhiteSpace(s?.AccessTokenEncrypted),
                webhookUrl);
        }).OrderBy(x => x.TenantName).ToList();

        return Result<IReadOnlyCollection<WhatsAppConnectionDto>>.Success(list);
    }

    public async Task<Result<WhatsAppConnectionDto>> BindConnectionAsync(Guid tenantId, BindWhatsAppConnectionRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (tenant is null) return Result<WhatsAppConnectionDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var s = await _db.WhatsAppSettings.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        if (s is null)
        {
            s = new WhatsAppSettings(tenantId);
            _db.WhatsAppSettings.Add(s);
        }

        if (!Enum.TryParse<WhatsAppConnectionStatus>(request.ConnectionStatus, ignoreCase: true, out var status))
            status = string.IsNullOrWhiteSpace(request.PhoneNumberId) ? WhatsAppConnectionStatus.NotConnected : WhatsAppConnectionStatus.Connected;

        // Aynı phone_number_id başka kuruma bağlı mı? (webhook tenant çözümü tekilliğe dayanır)
        if (!string.IsNullOrWhiteSpace(request.PhoneNumberId))
        {
            var clash = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(x => x.TenantId != tenantId && !x.IsDeleted && x.PhoneNumberId == request.PhoneNumberId.Trim(), ct);
            if (clash) return Result<WhatsAppConnectionDto>.Failure(Error.Conflict("Bu numara (phone_number_id) başka bir kuruma bağlı."));
        }

        s.BindConnection(request.PhoneNumberId, request.BusinessAccountId, request.DisplayPhoneNumber, status, request.VerifyToken);
        if (request.AccessTokenOverride is not null)
        {
            var enc = string.IsNullOrWhiteSpace(request.AccessTokenOverride) ? null : _encryption.Encrypt(request.AccessTokenOverride.Trim());
            s.SetAccessTokenOverride(enc);
        }
        await _db.SaveChangesAsync(ct);

        return Result<WhatsAppConnectionDto>.Success(new WhatsAppConnectionDto(
            tenant.Id, tenant.Name, tenant.SubscriptionPlan?.Name,
            s.PhoneNumberId, s.BusinessAccountId, s.DisplayPhoneNumber,
            s.ConnectionStatus.ToString(), s.IsConnected,
            !string.IsNullOrWhiteSpace(s.AccessTokenEncrypted), BuildWebhookUrl()));
    }

    public async Task<Result<ReminderResultDto>> SendTestMessageAsync(Guid tenantId, SendTestMessageRequest request, CancellationToken ct = default)
    {
        var toPhone = NormalizePhone(request.ToPhone);
        if (toPhone.Length == 0) return Result<ReminderResultDto>.Failure(Error.Validation("Geçerli bir telefon numarası girin."));

        var salon = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";
        var body = string.IsNullOrWhiteSpace(request.Text)
            ? $"Merhaba! {salon} WhatsApp bağlantısı başarıyla test edildi. ✅"
            : request.Text!.Trim();

        var ctx = await ResolveSendContextAsync(tenantId, ct);
        if (!ctx.Live)
            return Result<ReminderResultDto>.Failure(Error.Conflict("Kurumun WhatsApp bağlantısı aktif değil. Önce numarayı bağlayın ve durumu 'Connected' yapın."));

        var outcome = await SendViaMetaAsync(ctx.PhoneNumberId!, ctx.Token, toPhone, body, ct);
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, null, null, null, WhatsAppMessageDirection.Outbound,
            toPhone, body, outcome.Success ? WhatsAppMessageStatus.Sent : WhatsAppMessageStatus.Failed,
            templateName: "connection-test", providerMessageId: outcome.ProviderMessageId, error: outcome.Error,
            category: WhatsAppMessageCategory.Utility, billingSource: WhatsAppBillingSource.None));
        await _db.SaveChangesAsync(ct);

        return Result<ReminderResultDto>.Success(new ReminderResultDto(outcome.Success, false, toPhone, body, outcome.ProviderMessageId, outcome.Error));
    }

    // ==================== GÖNDERİM ====================

    public async Task<Result<ReminderResultDto>> SendReminderAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsWhatsApp, ct))
            return Result<ReminderResultDto>.Failure(Error.Conflict("WhatsApp gönderimi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var appt = await _db.Appointments
            .Include(a => a.Customer)
            .Include(a => a.ServiceDefinition)
            .Include(a => a.Branch)
            .Include(a => a.StaffMember)
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
        if (appt is null) return Result<ReminderResultDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        var phone = appt.Customer?.Phone;
        if (string.IsNullOrWhiteSpace(phone))
            return Result<ReminderResultDto>.Failure(Error.Validation("Müşterinin telefon numarası yok; hatırlatma gönderilemez."));

        var settings = await _db.WhatsAppSettings.FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        var body = RenderTemplate(settings?.ReminderTemplate ?? DefaultTemplate, appt);

        var result = await DispatchAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null,
            phone!, body, WhatsAppMessageCategory.Utility, templateName: "reminder", ct);

        if (result.Blocked)
            return Result<ReminderResultDto>.Failure(Error.Conflict(result.BlockReason!));

        if (result.Success)
        {
            appt.MarkReminderSent();
            await _db.SaveChangesAsync(ct);
        }

        var resultPhone = IsStaffViewer ? PhoneMask.Mask(result.ToPhone) : result.ToPhone;
        return Result<ReminderResultDto>.Success(new ReminderResultDto(result.Success, result.Simulated, resultPhone, body, result.ProviderMessageId, result.Error));
    }

    public async Task<Result<IReadOnlyCollection<WhatsAppMessageDto>>> RecentMessagesAsync(Guid tenantId, Guid? appointmentId, CancellationToken ct = default)
    {
        var q = _db.WhatsAppMessages.AsNoTracking().Where(m => m.TenantId == tenantId);
        if (appointmentId.HasValue) q = q.Where(m => m.AppointmentId == appointmentId.Value);
        var rows = await q.OrderByDescending(m => m.CreatedAtUtc).Take(50)
            .Select(m => new WhatsAppMessageDto(m.Id, m.AppointmentId, m.CustomerId, m.Direction, m.Phone, m.Body, m.Status, m.Intent, m.ProviderMessageId, m.ErrorMessage, m.CreatedAtUtc, m.Category, m.BillingSource, m.ChargedAmountTry))
            .ToListAsync(ct);
        if (IsStaffViewer) rows = rows.Select(r => r with { Phone = PhoneMask.Mask(r.Phone) }).ToList();
        return Result<IReadOnlyCollection<WhatsAppMessageDto>>.Success(rows);
    }

    public async Task SendWaitlistOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken ct = default)
    {
        try
        {
            var entry = await _db.WaitlistEntries.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(w => w.TenantId == tenantId && w.Id == waitlistEntryId && !w.IsDeleted, ct);
            if (entry is null || entry.PreferredStartUtc is not { } startUtc) return;

            var customer = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == entry.CustomerId, ct);
            if (customer is null || string.IsNullOrWhiteSpace(customer.Phone)) return;

            var serviceName = entry.ServiceDefinitionId is { } sid
                ? await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking().Where(s => s.Id == sid).Select(s => s.Name).FirstOrDefaultAsync(ct) ?? string.Empty
                : string.Empty;
            var salonName = entry.BranchId is { } bid
                ? await _db.Branches.IgnoreQueryFilters().AsNoTracking().Where(b => b.Id == bid).Select(b => b.Name).FirstOrDefaultAsync(ct) ?? string.Empty
                : string.Empty;

            var body = RenderSlotTemplate(WaitlistOfferTemplate, customer.FullName, startUtc, serviceName, salonName);
            await DispatchAsync(tenantId, entry.BranchId, appointmentId: null, entry.CustomerId, waitlistEntryId: entry.Id, customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: "waitlist-offer", ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bekleme teklifi gönderilemedi: {Entry}", waitlistEntryId);
        }
    }

    public async Task SendRatingLinkAsync(Guid tenantId, Guid appointmentId, Guid ratingToken, CancellationToken ct = default)
    {
        try
        {
            var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Include(a => a.Customer)
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
            if (appt?.Customer is null || string.IsNullOrWhiteSpace(appt.Customer.Phone)) return;

            var salonName = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";

            var link = $"{FrontendBaseUrl()}/rate/{ratingToken}";
            var body = RatingLinkTemplate
                .Replace("{ad}", FirstName(appt.Customer.FullName))
                .Replace("{salon}", salonName)
                .Replace("{link}", link);
            await DispatchAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null, appt.Customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: "rating-link", ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Değerlendirme linki gönderilemedi: {Appointment}", appointmentId);
        }
    }

    public async Task SendWaitlistActivatedAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default)
    {
        try
        {
            var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Include(a => a.Customer).Include(a => a.ServiceDefinition).Include(a => a.Branch)
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
            if (appt?.Customer is null || string.IsNullOrWhiteSpace(appt.Customer.Phone)) return;

            var body = RenderSlotTemplate(WaitlistActivatedTemplate, appt.Customer.FullName, appt.StartUtc,
                appt.ServiceDefinition?.Name ?? string.Empty, appt.Branch?.Name ?? string.Empty);
            await DispatchAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null, appt.Customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: "waitlist-activated", ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Aktifleşti mesajı gönderilemedi: {Appt}", appointmentId);
        }
    }

    /// <summary>Bağlantı çözümü: canlı gönderim yapılabilir mi, hangi numara ve token ile?</summary>
    private async Task<SendContext> ResolveSendContextAsync(Guid tenantId, CancellationToken ct)
    {
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        if (settings is null || !settings.IsConnected || string.IsNullOrWhiteSpace(settings.PhoneNumberId))
            return SendContext.Offline;

        // Token: önce kuruma özel override, yoksa platform sistem token'ı (tek Business Manager).
        string? token = null;
        if (!string.IsNullOrWhiteSpace(settings.AccessTokenEncrypted))
            token = _encryption.Decrypt(settings.AccessTokenEncrypted);
        else
        {
            var platform = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
            if (platform is { WhatsAppEnabled: true } && !string.IsNullOrWhiteSpace(platform.WhatsAppAccessTokenEncrypted))
                token = _encryption.Decrypt(platform.WhatsAppAccessTokenEncrypted);
        }
        if (string.IsNullOrWhiteSpace(token)) return SendContext.Offline;
        return new SendContext(true, settings.PhoneNumberId, token!);
    }

    /// <summary>
    /// Ortak gönderim: bağlantı çözümü → faturalama rezervasyonu (kota/kontör) → canlı/sim gönderim → mesaj kaydı.
    /// Engellenirse (kota/kontör/izin) mesaj gönderilmez; sonuç Blocked=true döner (reminder yolu kullanıcıya iletir,
    /// best-effort yollar yok sayar).
    /// </summary>
    private async Task<DispatchResult> DispatchAsync(
        Guid tenantId, Guid? branchId, Guid? appointmentId, Guid? customerId, Guid? waitlistEntryId,
        string phone, string body, WhatsAppMessageCategory category, string? templateName, CancellationToken ct)
    {
        var toPhone = NormalizePhone(phone);
        if (toPhone.Length == 0) return DispatchResult.Skipped;

        // Paket kapısı: WhatsApp özelliği açık değilse hiç gönderme (best-effort yollar sessizce atlar).
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsWhatsApp, ct))
            return new DispatchResult(true, "WhatsApp gönderimi paketinizde yok.", null, false, false, IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone, body, null, null);

        var ctx = await ResolveSendContextAsync(tenantId, ct);

        var decision = await _billing.ReserveAsync(tenantId, category, ctx.Live, ct);
        if (!decision.Allowed)
        {
            _logger.LogInformation("[WhatsApp] Gönderim engellendi ({Tenant}/{Category}): {Reason}", tenantId, category, decision.BlockReason);
            return new DispatchResult(true, decision.BlockReason, null, false, false, IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone, body, null, null);
        }

        WhatsAppSendOutcome outcome;
        bool simulated;
        if (ctx.Live)
        {
            outcome = await SendViaMetaAsync(ctx.PhoneNumberId!, ctx.Token, toPhone, body, ct);
            simulated = false;
        }
        else
        {
            _logger.LogInformation("[WhatsApp SIM] {Tenant} -> {Phone}: {Body}", tenantId, toPhone, body);
            outcome = new WhatsAppSendOutcome(true, $"sim-{Guid.NewGuid():N}", null);
            simulated = true;
        }

        var status = !outcome.Success ? WhatsAppMessageStatus.Failed : simulated ? WhatsAppMessageStatus.Simulated : WhatsAppMessageStatus.Sent;
        var msg = new WhatsAppMessage(
            tenantId, branchId, appointmentId, customerId, WhatsAppMessageDirection.Outbound,
            toPhone, body, status, templateName: templateName, providerMessageId: outcome.ProviderMessageId,
            error: outcome.Error, waitlistEntryId: waitlistEntryId,
            category: decision.Category, billingSource: decision.Source, chargedAmountTry: decision.AmountTry);
        _db.WhatsAppMessages.Add(msg);

        // Canlı gönderim ANINDA başarısızsa (Meta hata döndü) kontör rezervasyonunu geri al.
        if (!outcome.Success)
            await _billing.RefundInlineAsync(tenantId, msg, ct);

        await _db.SaveChangesAsync(ct);

        var outPhone = IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone;
        return new DispatchResult(false, null, msg, outcome.Success, simulated, outPhone, body, outcome.ProviderMessageId, outcome.Error);
    }

    // ==================== WEBHOOK ====================

    public async Task<string?> VerifyWebhookAsync(string? mode, string? verifyToken, string? challenge, CancellationToken ct = default)
    {
        if (!string.Equals(mode, "subscribe", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(verifyToken))
            return null;

        // 1) Platform geneli verify token (DB) — tek Business Manager modeli.
        var platformToken = await _db.PlatformIntegrationSettings.AsNoTracking().Select(p => p.WhatsAppVerifyToken).FirstOrDefaultAsync(ct);
        if (!string.IsNullOrEmpty(platformToken) && verifyToken == platformToken) return challenge;

        // 2) Config fallback.
        var appToken = _config["WhatsApp:VerifyToken"];
        if (!string.IsNullOrEmpty(appToken) && verifyToken == appToken) return challenge;

        // 3) Eski kuruma özel verify token (geriye uyumluluk).
        var matches = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(s => !s.IsDeleted && s.VerifyToken == verifyToken, ct);
        return matches ? challenge : null;
    }

    public async Task HandleInboundAsync(string payloadJson, string? signatureHeader, CancellationToken ct = default)
    {
        if (!await VerifyInboundSignatureAsync(payloadJson, signatureHeader, ct))
        {
            _logger.LogWarning("WhatsApp webhook imza doğrulaması başarısız — istek işlenmeden yok sayıldı.");
            return;
        }

        JsonDocument doc;
        try { doc = JsonDocument.Parse(payloadJson); }
        catch (JsonException) { return; }
        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("entry", out var entries)) return;
            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("changes", out var changes)) continue;
                foreach (var change in changes.EnumerateArray())
                {
                    if (!change.TryGetProperty("value", out var value)) continue;

                    // 1) Teslim/okundu/başarısız durum bildirimleri → kontör kesinleşme/iade.
                    if (value.TryGetProperty("statuses", out var statuses))
                    {
                        foreach (var st in statuses.EnumerateArray())
                        {
                            var wamid = st.TryGetProperty("id", out var sid) ? sid.GetString() : null;
                            var statusStr = st.TryGetProperty("status", out var ss) ? ss.GetString() : null;
                            if (string.IsNullOrWhiteSpace(wamid) || string.IsNullOrWhiteSpace(statusStr)) continue;
                            await ProcessStatusAsync(wamid!, statusStr!, ct);
                        }
                    }

                    // 2) Gelen mesajlar → niyet motoru (onay/iptal/erteleme).
                    var phoneNumberId = value.TryGetProperty("metadata", out var meta) && meta.TryGetProperty("phone_number_id", out var pnid) ? pnid.GetString() : null;
                    if (string.IsNullOrWhiteSpace(phoneNumberId)) continue;
                    if (!value.TryGetProperty("messages", out var messages)) continue;

                    var settings = await _db.WhatsAppSettings.IgnoreQueryFilters()
                        .FirstOrDefaultAsync(s => !s.IsDeleted && s.PhoneNumberId == phoneNumberId, ct);
                    if (settings is null) continue;
                    var tenantId = settings.TenantId;

                    foreach (var msg in messages.EnumerateArray())
                    {
                        var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;
                        if (type != "text") continue;
                        var from = msg.TryGetProperty("from", out var f) ? f.GetString() : null;
                        var text = msg.TryGetProperty("text", out var txt) && txt.TryGetProperty("body", out var b) ? b.GetString() : null;
                        if (string.IsNullOrWhiteSpace(from) || text is null) continue;

                        await ProcessInboundMessageAsync(tenantId, from!, text, ct);
                    }
                }
            }
        }
    }

    /// <summary>Meta teslim durumu (delivered/read/failed) → mesajı işaretle + kontörü kesinleştir/iade et.</summary>
    private async Task ProcessStatusAsync(string wamid, string status, CancellationToken ct)
    {
        var msg = await _db.WhatsAppMessages.IgnoreQueryFilters()
            .FirstOrDefaultAsync(m => m.ProviderMessageId == wamid && m.Direction == WhatsAppMessageDirection.Outbound, ct);
        if (msg is null) return;

        switch (status.ToLowerInvariant())
        {
            case "delivered":
            case "read":
            {
                var firstDelivery = msg.MarkDelivered();
                if (status.Equals("read", StringComparison.OrdinalIgnoreCase)) msg.MarkRead();
                await _db.SaveChangesAsync(ct);
                if (firstDelivery) await _billing.CaptureAsync(msg, ct); // kontörü kesinleştir (teslim edildi)
                break;
            }
            case "failed":
            {
                if (msg.MarkFailed("Meta: teslim edilemedi"))
                {
                    await _db.SaveChangesAsync(ct);
                    await _billing.RefundAsync(msg, ct); // rezervasyonu iade et
                }
                break;
            }
        }
    }

    /// <summary>
    /// Meta webhook imzasını doğrular. Anahtar kaynağı: önce platform App Secret (DB, şifreli), yoksa
    /// <c>WhatsApp:AppSecret</c> config. App secret tanımlı değilse Development'ta izin, Production'da RED.
    /// </summary>
    private async Task<bool> VerifyInboundSignatureAsync(string rawBody, string? signatureHeader, CancellationToken ct)
    {
        string? appSecret = null;
        var platformSecretEnc = await _db.PlatformIntegrationSettings.AsNoTracking().Select(p => p.WhatsAppAppSecretEncrypted).FirstOrDefaultAsync(ct);
        if (!string.IsNullOrWhiteSpace(platformSecretEnc))
            appSecret = _encryption.Decrypt(platformSecretEnc);
        appSecret ??= _config["WhatsApp:AppSecret"];

        if (string.IsNullOrWhiteSpace(appSecret))
        {
            var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
            var isDevelopment = string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase);
            if (!isDevelopment)
                _logger.LogError("WhatsApp App Secret tanımlı değil — webhook imzası doğrulanamıyor, istek reddedildi. " +
                                 "Platform ayarlarından App Secret girin ya da WhatsApp__AppSecret ortam değişkenini tanımlayın.");
            return isDevelopment;
        }

        const string prefix = "sha256=";
        if (string.IsNullOrWhiteSpace(signatureHeader) ||
            !signatureHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;

        byte[] provided;
        try { provided = Convert.FromHexString(signatureHeader[prefix.Length..].Trim()); }
        catch (FormatException) { return false; }

        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), Encoding.UTF8.GetBytes(rawBody));
        return CryptographicOperations.FixedTimeEquals(provided, expected);
    }

    private async Task ProcessInboundMessageAsync(Guid tenantId, string fromPhone, string text, CancellationToken ct)
    {
        var since = DateTime.UtcNow.AddDays(-3);
        var recentOutbound = await _db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(m => m.TenantId == tenantId && m.Direction == WhatsAppMessageDirection.Outbound && m.CreatedAtUtc >= since)
            .OrderByDescending(m => m.CreatedAtUtc).Take(25).ToListAsync(ct);
        var match = recentOutbound.FirstOrDefault(m => PhonesMatch(m.Phone, fromPhone));

        var intent = Interpret(text);
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, match?.BranchId, match?.AppointmentId, match?.CustomerId, WhatsAppMessageDirection.Inbound,
            NormalizePhone(fromPhone), text, WhatsAppMessageStatus.Received, intent: intent, waitlistEntryId: match?.WaitlistEntryId,
            category: WhatsAppMessageCategory.Service, billingSource: WhatsAppBillingSource.None));
        await _db.SaveChangesAsync(ct);

        if (match is null || intent == WhatsAppReplyIntent.Unknown) return;

        // 1) Bekleme listesi teklifine yanıt.
        if (match.WaitlistEntryId is { } waitlistId)
        {
            if (intent == WhatsAppReplyIntent.Confirm)
            {
                var res = await _waitlist.AcceptOfferAsync(tenantId, waitlistId, ct);
                if (res.IsSuccess && res.Value is { } newApptId) await SendWaitlistActivatedAsync(tenantId, newApptId, ct);
            }
            else if (intent == WhatsAppReplyIntent.Cancel)
            {
                var next = await _waitlist.DeclineOfferAsync(tenantId, waitlistId, ct);
                if (next.IsSuccess && next.Value is { } nextId) await SendWaitlistOfferAsync(tenantId, nextId, ct);
            }
            return;
        }

        // 2) Randevu hatırlatmasına yanıt.
        if (match.AppointmentId is { } apptId)
        {
            var appt = await _db.Appointments.IgnoreQueryFilters()
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == apptId, ct);
            if (appt is null) return;

            appt.SetCustomerConfirmation(intent switch
            {
                WhatsAppReplyIntent.Confirm => WhatsAppConfirmationStatus.Confirmed,
                WhatsAppReplyIntent.Cancel => WhatsAppConfirmationStatus.Declined,
                WhatsAppReplyIntent.Reschedule => WhatsAppConfirmationStatus.RescheduleRequested,
                _ => WhatsAppConfirmationStatus.Pending,
            });

            if (intent == WhatsAppReplyIntent.Cancel &&
                appt.Status is not (AppointmentStatus.Cancelled or AppointmentStatus.Completed or AppointmentStatus.NoShow))
            {
                appt.Cancel("Müşteri WhatsApp ile iptal etti");
                await _db.SaveChangesAsync(ct);
                var offer = await _waitlist.SelectAndMarkOfferAsync(tenantId, appt.Id, ct);
                if (offer.IsSuccess && offer.Value is { } offeredId) await SendWaitlistOfferAsync(tenantId, offeredId, ct);
            }
            else
            {
                await _db.SaveChangesAsync(ct);
            }

            var (title, severity) = intent switch
            {
                WhatsAppReplyIntent.Confirm => ("Müşteri randevusunu onayladı", AppNotificationSeverity.Success),
                WhatsAppReplyIntent.Cancel => ("Müşteri randevusunu iptal etti", AppNotificationSeverity.Warning),
                WhatsAppReplyIntent.Reschedule => ("Müşteri erteleme istedi", AppNotificationSeverity.Warning),
                _ => (string.Empty, AppNotificationSeverity.Info),
            };
            if (!string.IsNullOrEmpty(title))
            {
                var custName = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                    .Where(c => c.Id == appt.CustomerId).Select(c => c.FullName).FirstOrDefaultAsync(ct);
                await _notifications.NotifyRolesAsync(
                    tenantId, appt.BranchId,
                    new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
                    AppNotificationType.WhatsAppReply, severity,
                    title,
                    $"{(string.IsNullOrWhiteSpace(custName) ? "Müşteri" : custName)} · {appt.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}",
                    data: new { route = "/appointments", id = appt.Id.ToString() },
                    dedupeKey: $"wa-reply:{appt.Id}:{intent}",
                    ct: ct);
            }
        }
    }

    private async Task<WhatsAppSendOutcome> SendViaMetaAsync(string phoneNumberId, string accessToken, string toPhone, string body, CancellationToken ct)
    {
        try
        {
            var client = _httpFactory.CreateClient("WhatsApp");
            var url = $"https://graph.facebook.com/v21.0/{phoneNumberId}/messages";
            var payload = new { messaging_product = "whatsapp", recipient_type = "individual", to = toPhone, type = "text", text = new { preview_url = false, body } };
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(payload) };
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var resp = await client.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                var trimmed = raw.Length > 300 ? raw[..300] : raw;
                return new WhatsAppSendOutcome(false, null, $"Meta {(int)resp.StatusCode}: {trimmed}");
            }
            string? messageId = null;
            try
            {
                using var d = JsonDocument.Parse(raw);
                if (d.RootElement.TryGetProperty("messages", out var m) && m.GetArrayLength() > 0 && m[0].TryGetProperty("id", out var id))
                    messageId = id.GetString();
            }
            catch (JsonException) { /* id parse edilemese de gönderim başarılı */ }
            return new WhatsAppSendOutcome(true, messageId, null);
        }
        catch (Exception ex)
        {
            return new WhatsAppSendOutcome(false, null, ex.Message);
        }
    }

    // ---- yardımcılar ----

    private WhatsAppSettingsDto BuildSettingsDto(WhatsAppSettings? s)
    {
        var webhookUrl = BuildWebhookUrl();
        if (s is null)
            return new WhatsAppSettingsDto(false, null, null, WhatsAppConnectionStatus.NotConnected.ToString(), false, null, null, "Meta", webhookUrl, false, false, null);
        return new WhatsAppSettingsDto(
            s.Enabled, s.PhoneNumberId, s.DisplayPhoneNumber, s.ConnectionStatus.ToString(), s.IsConnected,
            s.BusinessAccountId, s.ReminderTemplate, s.Provider, webhookUrl,
            s.MarketingEnabled, s.AllowWalletOverage, s.MonthlySpendCapTry);
    }

    private string BuildWebhookUrl()
    {
        var baseUrl = _config["WhatsApp:PublicBaseUrl"]
            ?? _config["Urls"]?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault()
            ?? "http://localhost:5019";
        return $"{baseUrl.TrimEnd('/')}/api/whatsapp/webhook";
    }

    /// <summary>Rate sayfasının (Next.js) tabanı — API tabanından farklı olabilir.</summary>
    private string FrontendBaseUrl() =>
        (_config["Frontend:PublicBaseUrl"] ?? _config["WhatsApp:PublicBaseUrl"] ?? "http://localhost:3000").TrimEnd('/');

    private static string FirstName(string? fullName) =>
        string.IsNullOrWhiteSpace(fullName) ? "Değerli müşterimiz" : fullName.Trim().Split(' ')[0];

    private static string RenderSlotTemplate(string template, string? name, DateTime startUtc, string serviceName, string salonName)
    {
        var local = startUtc.AddHours(3); // Türkiye UTC+3
        return template
            .Replace("{ad}", name ?? string.Empty)
            .Replace("{tarih}", local.ToString("dd.MM.yyyy"))
            .Replace("{saat}", local.ToString("HH:mm"))
            .Replace("{hizmet}", serviceName)
            .Replace("{personel}", string.Empty)
            .Replace("{salon}", salonName);
    }

    private static string RenderTemplate(string template, Appointment appt)
    {
        var local = appt.StartUtc.AddHours(3); // Türkiye UTC+3
        return template
            .Replace("{ad}", appt.Customer?.FullName ?? "")
            .Replace("{tarih}", local.ToString("dd.MM.yyyy"))
            .Replace("{saat}", local.ToString("HH:mm"))
            .Replace("{hizmet}", appt.ServiceDefinition?.Name ?? "")
            .Replace("{personel}", appt.StaffMember?.FullName ?? "")
            .Replace("{salon}", appt.Branch?.Name ?? "");
    }

    private static string NormalizePhone(string? p) => new string((p ?? string.Empty).Where(char.IsDigit).ToArray());

    private static bool PhonesMatch(string a, string b)
    {
        var na = NormalizePhone(a);
        var nb = NormalizePhone(b);
        if (na.Length == 0 || nb.Length == 0) return false;
        if (na == nb) return true;
        var min = Math.Min(Math.Min(na.Length, nb.Length), 10);
        return na[^min..] == nb[^min..];
    }

    private static WhatsAppReplyIntent Interpret(string text)
    {
        var t = NormalizeTr(text);
        if (t.Length == 0) return WhatsAppReplyIntent.Unknown;
        var words = t.Split(new[] { ' ', '\t', '\n', '\r', '.', ',', '!', '?', ';' }, StringSplitOptions.RemoveEmptyEntries);
        bool Has(params string[] keys) => keys.Contains(t) || words.Any(w => keys.Contains(w));
        if (t is "e" or "1" || Has("evet", "onay", "onayliyorum", "onayla", "tamam", "olur", "geliyorum", "katiliyorum", "geldim")) return WhatsAppReplyIntent.Confirm;
        if (t is "h" or "2" || Has("hayir", "iptal", "gelemeyecegim", "gelemeyecem", "gelmiyorum", "gelemiyorum", "gelemem")) return WhatsAppReplyIntent.Cancel;
        if (t is "3" || Has("ertele", "ertelensin", "erteleme", "erteleyelim", "degistir", "baska")) return WhatsAppReplyIntent.Reschedule;
        return WhatsAppReplyIntent.Unknown;
    }

    private static string NormalizeTr(string? text)
    {
        var s = (text ?? string.Empty).Trim().Replace('İ', 'i').Replace('I', 'i').Replace('ı', 'i').ToLowerInvariant();
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s)
        {
            switch (ch)
            {
                case 'ı': sb.Append('i'); break;
                case 'ş': sb.Append('s'); break;
                case 'ğ': sb.Append('g'); break;
                case 'ü': sb.Append('u'); break;
                case 'ö': sb.Append('o'); break;
                case 'ç': sb.Append('c'); break;
                case '̇': break;
                default: sb.Append(ch); break;
            }
        }
        return sb.ToString();
    }

    private readonly record struct SendContext(bool Live, string? PhoneNumberId, string Token)
    {
        public static readonly SendContext Offline = new(false, null, string.Empty);
    }

    private sealed record DispatchResult(bool Blocked, string? BlockReason, WhatsAppMessage? Message, bool Success, bool Simulated, string ToPhone, string Body, string? ProviderMessageId, string? Error)
    {
        public static readonly DispatchResult Skipped = new(false, null, null, false, false, string.Empty, string.Empty, null, null);
    }
}

internal sealed record WhatsAppSendOutcome(bool Success, string? ProviderMessageId, string? Error);

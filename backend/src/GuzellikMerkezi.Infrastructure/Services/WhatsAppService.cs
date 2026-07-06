using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Usage;
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

    private readonly GuzellikDbContext _db;
    private readonly IEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<WhatsAppService> _logger;
    private readonly IFeatureService _features;
    private readonly IUsageService _usage;
    private readonly ICurrentUser _currentUser;
    private readonly IWaitlistService _waitlist;
    private readonly Application.Features.AppNotifications.IAppNotificationService _notifications;

    public WhatsAppService(GuzellikDbContext db, IEncryptionService encryption, IHttpClientFactory httpFactory, IConfiguration config, ILogger<WhatsAppService> logger, IFeatureService features, IUsageService usage, ICurrentUser currentUser, IWaitlistService waitlist, Application.Features.AppNotifications.IAppNotificationService notifications)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
        _features = features;
        _usage = usage;
        _currentUser = currentUser;
        _waitlist = waitlist;
        _notifications = notifications;
    }

    // Personel müşteri telefonunu yalnızca son 4 hane görür; ham numara API'den hiç çıkmaz.
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

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
        // Token boş gelirse mevcut korunur; doluysa şifrele.
        string? encToken = string.IsNullOrWhiteSpace(request.AccessToken) ? null : _encryption.Encrypt(request.AccessToken!.Trim());
        s.Update(request.Enabled, request.PhoneNumberId, encToken, request.BusinessAccountId, request.VerifyToken, request.ReminderTemplate);
        await _db.SaveChangesAsync(ct);
        return Result<WhatsAppSettingsDto>.Success(BuildSettingsDto(s));
    }

    public async Task<Result<ReminderResultDto>> SendReminderAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default)
    {
        // Paket kapısı: özellik + aylık WhatsApp kotası
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsWhatsApp, ct))
            return Result<ReminderResultDto>.Failure(Error.Conflict("WhatsApp gönderimi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));
        var quota = await _usage.CheckLimitAsync(tenantId, "whatsapp", ct);
        if (quota.IsFailure) return Result<ReminderResultDto>.Failure(quota.Error);

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
        var toPhone = NormalizePhone(phone);

        var live = settings is { Enabled: true } && settings.HasCredentials;
        WhatsAppSendOutcome outcome;
        bool simulated;
        if (live)
        {
            var token = _encryption.Decrypt(settings!.AccessTokenEncrypted);
            outcome = await SendViaMetaAsync(settings.PhoneNumberId!, token ?? string.Empty, toPhone, body, ct);
            simulated = false;
        }
        else
        {
            _logger.LogInformation("[WhatsApp SIM] {Tenant} -> {Phone}: {Body}", tenantId, toPhone, body);
            outcome = new WhatsAppSendOutcome(true, $"sim-{Guid.NewGuid():N}", null);
            simulated = true;
        }

        var status = !outcome.Success ? WhatsAppMessageStatus.Failed : simulated ? WhatsAppMessageStatus.Simulated : WhatsAppMessageStatus.Sent;
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, appt.BranchId, appt.Id, appt.CustomerId, WhatsAppMessageDirection.Outbound,
            toPhone, body, status, templateName: null, providerMessageId: outcome.ProviderMessageId, error: outcome.Error));

        if (outcome.Success) appt.MarkReminderSent();
        await _db.SaveChangesAsync(ct);

        var resultPhone = IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone;
        return Result<ReminderResultDto>.Success(new ReminderResultDto(outcome.Success, simulated, resultPhone, body, outcome.ProviderMessageId, outcome.Error));
    }

    public async Task<Result<IReadOnlyCollection<WhatsAppMessageDto>>> RecentMessagesAsync(Guid tenantId, Guid? appointmentId, CancellationToken ct = default)
    {
        var q = _db.WhatsAppMessages.AsNoTracking().Where(m => m.TenantId == tenantId);
        if (appointmentId.HasValue) q = q.Where(m => m.AppointmentId == appointmentId.Value);
        var rows = await q.OrderByDescending(m => m.CreatedAtUtc).Take(50)
            .Select(m => new WhatsAppMessageDto(m.Id, m.AppointmentId, m.CustomerId, m.Direction, m.Phone, m.Body, m.Status, m.Intent, m.ProviderMessageId, m.ErrorMessage, m.CreatedAtUtc))
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
            await TrySendAsync(tenantId, entry.BranchId, appointmentId: null, entry.CustomerId, waitlistEntryId: entry.Id, customer.Phone!, body, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bekleme teklifi gönderilemedi: {Entry}", waitlistEntryId);
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
            await TrySendAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null, appt.Customer.Phone!, body, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Aktifleşti mesajı gönderilemedi: {Appt}", appointmentId);
        }
    }

    /// <summary>Ortak gönderim: feature+kota (best-effort), canlı/simülasyon, mesaj loglama. Başarılıysa true.</summary>
    private async Task<bool> TrySendAsync(Guid tenantId, Guid? branchId, Guid? appointmentId, Guid? customerId, Guid? waitlistEntryId, string phone, string body, CancellationToken ct)
    {
        // Feature ya da kota kapalıysa akışı bozmadan sessizce atla.
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsWhatsApp, ct)) return false;
        if ((await _usage.CheckLimitAsync(tenantId, "whatsapp", ct)).IsFailure) return false;

        var toPhone = NormalizePhone(phone);
        if (toPhone.Length == 0) return false;

        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        var live = settings is { Enabled: true } && settings.HasCredentials;
        WhatsAppSendOutcome outcome;
        bool simulated;
        if (live)
        {
            var token = _encryption.Decrypt(settings!.AccessTokenEncrypted);
            outcome = await SendViaMetaAsync(settings.PhoneNumberId!, token ?? string.Empty, toPhone, body, ct);
            simulated = false;
        }
        else
        {
            _logger.LogInformation("[WhatsApp SIM] {Tenant} -> {Phone}: {Body}", tenantId, toPhone, body);
            outcome = new WhatsAppSendOutcome(true, $"sim-{Guid.NewGuid():N}", null);
            simulated = true;
        }

        var status = !outcome.Success ? WhatsAppMessageStatus.Failed : simulated ? WhatsAppMessageStatus.Simulated : WhatsAppMessageStatus.Sent;
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, branchId, appointmentId, customerId, WhatsAppMessageDirection.Outbound,
            toPhone, body, status, templateName: null, providerMessageId: outcome.ProviderMessageId,
            error: outcome.Error, waitlistEntryId: waitlistEntryId));
        await _db.SaveChangesAsync(ct);
        return outcome.Success;
    }

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

    public async Task<string?> VerifyWebhookAsync(string? mode, string? verifyToken, string? challenge, CancellationToken ct = default)
    {
        if (!string.Equals(mode, "subscribe", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(verifyToken))
            return null;
        var appToken = _config["WhatsApp:VerifyToken"];
        if (!string.IsNullOrEmpty(appToken) && verifyToken == appToken) return challenge;
        var matches = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(s => !s.IsDeleted && s.VerifyToken == verifyToken, ct);
        return matches ? challenge : null;
    }

    public async Task HandleInboundAsync(string payloadJson, string? signatureHeader, CancellationToken ct = default)
    {
        // GÜVENLİK: gövdeyi işlemeden önce Meta imzasını doğrula. Geçersiz/eksik imza → hiçbir yan etki
        // uygulanmaz (aksi halde anonim bir istek sahte "iptal"/"onay" ile gerçek randevuları manipüle edebilirdi).
        if (!VerifyInboundSignature(payloadJson, signatureHeader))
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
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Meta webhook imzasını (X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(appSecret, rawBody))) doğrular.
    /// Anahtar kaynağı: <c>WhatsApp:AppSecret</c> (Meta App Dashboard → App Secret). Sabit-zamanlı karşılaştırma.
    /// App secret tanımlı DEĞİLSE: Development'ta izin verilir (simülasyon/yerel test), Production'da REDDEDİLİR
    /// (fail-closed) — canlıda imzasız webhook işlenmez.
    /// </summary>
    private bool VerifyInboundSignature(string rawBody, string? signatureHeader)
    {
        var appSecret = _config["WhatsApp:AppSecret"];
        if (string.IsNullOrWhiteSpace(appSecret))
        {
            var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
            var isDevelopment = string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase);
            if (!isDevelopment)
                _logger.LogError("WhatsApp:AppSecret tanımlı değil — webhook imzası doğrulanamıyor, istek reddedildi. " +
                                 "Üretimde Meta App Secret'ı WhatsApp__AppSecret ortam değişkeni ile geçirin.");
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
        // En son giden mesaj (hatırlatma ya da bekleme teklifi) bu telefona hangi bağlamı açtıysa onu izleriz.
        var match = recentOutbound.FirstOrDefault(m => PhonesMatch(m.Phone, fromPhone));

        var intent = Interpret(text);
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, match?.BranchId, match?.AppointmentId, match?.CustomerId, WhatsAppMessageDirection.Inbound,
            NormalizePhone(fromPhone), text, WhatsAppMessageStatus.Received, intent: intent, waitlistEntryId: match?.WaitlistEntryId));
        await _db.SaveChangesAsync(ct); // gelen mesajı kalıcılaştır; otomasyon adımları ayrı iş birimleri

        if (match is null || intent == WhatsAppReplyIntent.Unknown) return;

        // 1) Bekleme listesi teklifine yanıt: Evet → randevu aç + aktifleşti; Hayır → sıradakine teklif.
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

        // 2) Randevu hatırlatmasına yanıt: onay durumunu güncelle; "İptal" → randevuyu otomatik iptal et.
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

            // Otomatik iptal kararı: müşteri "İptal" dedi → randevuyu iptal et, slotu bekleme listesine aç.
            if (intent == WhatsAppReplyIntent.Cancel &&
                appt.Status is not (AppointmentStatus.Cancelled or AppointmentStatus.Completed or AppointmentStatus.NoShow))
            {
                appt.Cancel("Müşteri WhatsApp ile iptal etti");
                await _db.SaveChangesAsync(ct); // overlap DB'den okunacağı için iptali ÖNCE kaydet
                var offer = await _waitlist.SelectAndMarkOfferAsync(tenantId, appt.Id, ct);
                if (offer.IsSuccess && offer.Value is { } offeredId) await SendWaitlistOfferAsync(tenantId, offeredId, ct);
            }
            else
            {
                await _db.SaveChangesAsync(ct);
            }

            // Kurum/şube yöneticisine müşteri yanıtı bildirimi (onay/iptal/erteleme).
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
            return new WhatsAppSettingsDto(false, null, false, null, null, null, "Meta", webhookUrl, false);
        return new WhatsAppSettingsDto(
            s.Enabled, s.PhoneNumberId, !string.IsNullOrWhiteSpace(s.AccessTokenEncrypted), s.BusinessAccountId,
            s.VerifyToken, s.ReminderTemplate, s.Provider, webhookUrl, s.HasCredentials);
    }

    private string BuildWebhookUrl()
    {
        var baseUrl = _config["WhatsApp:PublicBaseUrl"]
            ?? _config["Urls"]?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault()
            ?? "http://localhost:5019";
        return $"{baseUrl.TrimEnd('/')}/api/whatsapp/webhook";
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
        var t = NormalizeTr(text); // Türkçe'yi ASCII'ye indir (İ/ı/ş/ğ/ü/ö/ç) → anahtar kelimeler güvenle eşleşir
        if (t.Length == 0) return WhatsAppReplyIntent.Unknown;
        var words = t.Split(new[] { ' ', '\t', '\n', '\r', '.', ',', '!', '?', ';' }, StringSplitOptions.RemoveEmptyEntries);
        bool Has(params string[] keys) => keys.Contains(t) || words.Any(w => keys.Contains(w));
        if (t is "e" or "1" || Has("evet", "onay", "onayliyorum", "onayla", "tamam", "olur", "geliyorum", "katiliyorum", "geldim")) return WhatsAppReplyIntent.Confirm;
        if (t is "h" or "2" || Has("hayir", "iptal", "gelemeyecegim", "gelemeyecem", "gelmiyorum", "gelemiyorum", "gelemem")) return WhatsAppReplyIntent.Cancel;
        if (t is "3" || Has("ertele", "ertelensin", "erteleme", "erteleyelim", "degistir", "baska")) return WhatsAppReplyIntent.Reschedule;
        return WhatsAppReplyIntent.Unknown;
    }

    /// <summary>Türkçe metni eşleştirme için ASCII'ye indirir (İ→i, ş→s, ...) ve combining dot kalıntısını temizler.</summary>
    private static string NormalizeTr(string? text)
    {
        // ToLowerInvariant 'İ'yi (U+0130) çevirmez — Türkçe büyük I/İ/ı'yı önce 'i'ye indir.
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
                case '̇': break; // İ → "i̇" lowercasing kalıntısı (combining dot above)
                default: sb.Append(ch); break;
            }
        }
        return sb.ToString();
    }
}

internal sealed record WhatsAppSendOutcome(bool Success, string? ProviderMessageId, string? Error);

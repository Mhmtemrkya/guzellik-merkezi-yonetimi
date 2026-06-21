using System.Net.Http.Json;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Usage;
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

    private readonly GuzellikDbContext _db;
    private readonly IEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<WhatsAppService> _logger;
    private readonly IFeatureService _features;
    private readonly IUsageService _usage;
    private readonly ICurrentUser _currentUser;

    public WhatsAppService(GuzellikDbContext db, IEncryptionService encryption, IHttpClientFactory httpFactory, IConfiguration config, ILogger<WhatsAppService> logger, IFeatureService features, IUsageService usage, ICurrentUser currentUser)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
        _features = features;
        _usage = usage;
        _currentUser = currentUser;
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

    public async Task HandleInboundAsync(string payloadJson, CancellationToken ct = default)
    {
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
            NormalizePhone(fromPhone), text, WhatsAppMessageStatus.Received, intent: intent));

        if (match?.AppointmentId is { } apptId && intent != WhatsAppReplyIntent.Unknown)
        {
            var appt = await _db.Appointments.IgnoreQueryFilters()
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == apptId, ct);
            appt?.SetCustomerConfirmation(intent switch
            {
                WhatsAppReplyIntent.Confirm => WhatsAppConfirmationStatus.Confirmed,
                WhatsAppReplyIntent.Cancel => WhatsAppConfirmationStatus.Declined,
                WhatsAppReplyIntent.Reschedule => WhatsAppConfirmationStatus.RescheduleRequested,
                _ => WhatsAppConfirmationStatus.Pending,
            });
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

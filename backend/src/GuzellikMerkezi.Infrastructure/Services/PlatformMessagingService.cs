using System.Net;
using System.Net.Http.Headers;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class PlatformMessagingService : IPlatformMessagingService
{
    private readonly GuzellikDbContext _db;
    private readonly IEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<PlatformMessagingService> _logger;

    public PlatformMessagingService(GuzellikDbContext db, IEncryptionService encryption, IHttpClientFactory httpFactory, ILogger<PlatformMessagingService> logger)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public async Task<Result<PlatformIntegrationSettingsDto>> GetSettingsAsync(CancellationToken ct = default)
    {
        var s = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        return Result<PlatformIntegrationSettingsDto>.Success(ToDto(s));
    }

    public async Task<Result<PlatformIntegrationSettingsDto>> SaveSettingsAsync(SavePlatformMessagingRequest r, CancellationToken ct = default)
    {
        var s = await _db.PlatformIntegrationSettings.FirstOrDefaultAsync(ct);
        if (s is null) { s = new PlatformIntegrationSettings(); _db.PlatformIntegrationSettings.Add(s); }
        var smsKeyEnc = string.IsNullOrWhiteSpace(r.SmsApiKey) ? null : _encryption.Encrypt(r.SmsApiKey!.Trim());
        var smsSecretEnc = string.IsNullOrWhiteSpace(r.SmsApiSecret) ? null : _encryption.Encrypt(r.SmsApiSecret!.Trim());
        var smtpPwEnc = string.IsNullOrWhiteSpace(r.SmtpPassword) ? null : _encryption.Encrypt(r.SmtpPassword!.Trim());
        s.UpdateSms(r.SmsEnabled, r.SmsProvider, smsKeyEnc, smsSecretEnc, r.SmsSender, r.SmsApiUrl);
        s.UpdateEmail(r.EmailEnabled, r.EmailFromAddress, r.EmailFromName, r.SmtpHost, r.SmtpPort, r.SmtpUsername, smtpPwEnc, r.SmtpUseSsl);
        await _db.SaveChangesAsync(ct);
        return Result<PlatformIntegrationSettingsDto>.Success(ToDto(s));
    }

    public async Task<Result<MessagingTestResult>> SendTestSmsAsync(string toPhone, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(toPhone)) return Result<MessagingTestResult>.Failure(Error.Validation("Telefon numarası gerekli."));
        return Result<MessagingTestResult>.Success(await SendSmsAsync(toPhone, "Armonessa platform test SMS — SMS altyapısı çalışıyor.", ct));
    }

    public async Task<Result<MessagingTestResult>> SendTestEmailAsync(string toEmail, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(toEmail)) return Result<MessagingTestResult>.Failure(Error.Validation("E-posta adresi gerekli."));
        return Result<MessagingTestResult>.Success(await SendEmailAsync(toEmail, "Armonessa test e-postası",
            "<div style='font-family:sans-serif'><h2>Test e-postası ✅</h2><p>E-posta altyapısı çalışıyor.</p></div>", ct));
    }

    public async Task<MessagingTestResult> SendSmsAsync(string toPhone, string message, CancellationToken ct = default)
    {
        var s = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        var phone = NormalizePhone(toPhone);
        if (s is null || !s.SmsEnabled || !s.SmsConfigured)
            return Simulate("SMS", phone, message);

        var apiKey = _encryption.Decrypt(s.SmsApiKeyEncrypted) ?? string.Empty;
        var apiSecret = _encryption.Decrypt(s.SmsApiSecretEncrypted) ?? string.Empty;
        try
        {
            return s.SmsProvider.ToLowerInvariant() switch
            {
                "twilio" => await SendViaTwilioAsync(apiKey, apiSecret, s.SmsSender ?? string.Empty, phone, message, ct),
                "netgsm" => await SendViaNetgsmAsync(apiKey, apiSecret, s.SmsSender ?? string.Empty, phone, message, s.SmsApiUrl, ct),
                _ => Simulate("SMS", phone, message),
            };
        }
        catch (Exception ex) { return new MessagingTestResult(false, false, null, ex.Message); }
    }

    public async Task<MessagingTestResult> SendEmailAsync(string toEmail, string subject, string htmlBody, CancellationToken ct = default)
    {
        var s = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
        if (s is null || !s.EmailEnabled || !s.EmailConfigured)
            return Simulate("EMAIL", toEmail, subject);
        try
        {
            var pw = _encryption.Decrypt(s.SmtpPasswordEncrypted) ?? string.Empty;
            using var msg = new MailMessage
            {
                From = new MailAddress(s.EmailFromAddress!, s.EmailFromName ?? s.EmailFromAddress!),
                Subject = subject,
                Body = htmlBody,
                IsBodyHtml = true,
            };
            msg.To.Add(toEmail);
            using var client = new SmtpClient(s.SmtpHost!, s.SmtpPort) { EnableSsl = s.SmtpUseSsl };
            if (!string.IsNullOrWhiteSpace(s.SmtpUsername))
                client.Credentials = new NetworkCredential(s.SmtpUsername, pw);
            await client.SendMailAsync(msg, ct);
            return new MessagingTestResult(true, false, null, null);
        }
        catch (Exception ex) { return new MessagingTestResult(false, false, null, ex.Message); }
    }

    // --- sağlayıcılar ---

    private async Task<MessagingTestResult> SendViaTwilioAsync(string sid, string token, string from, string to, string body, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient("Sms");
        var url = $"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json";
        var form = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("To", "+" + to),
            new KeyValuePair<string, string>("From", from),
            new KeyValuePair<string, string>("Body", body),
        });
        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = form };
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{sid}:{token}")));
        using var resp = await client.SendAsync(req, ct);
        var raw = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode) return new MessagingTestResult(false, false, null, $"Twilio {(int)resp.StatusCode}: {Clip(raw)}");
        return new MessagingTestResult(true, false, ExtractJson(raw, "sid"), null);
    }

    private async Task<MessagingTestResult> SendViaNetgsmAsync(string usercode, string password, string header, string to, string body, string? apiUrl, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient("Sms");
        var baseUrl = string.IsNullOrWhiteSpace(apiUrl) ? "https://api.netgsm.com.tr/sms/send/get" : apiUrl!;
        var qs = $"?usercode={Uri.EscapeDataString(usercode)}&password={Uri.EscapeDataString(password)}" +
                 $"&gsmno={Uri.EscapeDataString(to)}&message={Uri.EscapeDataString(body)}&msgheader={Uri.EscapeDataString(header)}";
        using var resp = await client.GetAsync(baseUrl + qs, ct);
        var raw = (await resp.Content.ReadAsStringAsync(ct)).Trim();
        // Netgsm: "00"/"01"/"02" + bulkid => başarı; 20/30/40/70 => hata
        var code = raw.Split(' ', '\n', '\r')[0];
        if (code is "00" or "01" or "02") return new MessagingTestResult(true, false, raw, null);
        return new MessagingTestResult(false, false, null, $"Netgsm hata kodu: {raw}");
    }

    private MessagingTestResult Simulate(string channel, string target, string content)
    {
        _logger.LogInformation("[{Channel} SIM] -> {Target}: {Content}", channel, target, content);
        return new MessagingTestResult(true, true, $"sim-{Guid.NewGuid():N}", null);
    }

    private static PlatformIntegrationSettingsDto ToDto(PlatformIntegrationSettings? s)
    {
        if (s is null)
            return new PlatformIntegrationSettingsDto(false, "Simulation", false, false, null, null, false, false, null, null, null, 587, null, false, true, false);
        return new PlatformIntegrationSettingsDto(
            s.SmsEnabled, s.SmsProvider, !string.IsNullOrWhiteSpace(s.SmsApiKeyEncrypted), !string.IsNullOrWhiteSpace(s.SmsApiSecretEncrypted), s.SmsSender, s.SmsApiUrl, s.SmsConfigured,
            s.EmailEnabled, s.EmailFromAddress, s.EmailFromName, s.SmtpHost, s.SmtpPort, s.SmtpUsername, !string.IsNullOrWhiteSpace(s.SmtpPasswordEncrypted), s.SmtpUseSsl, s.EmailConfigured);
    }

    private static string NormalizePhone(string? p) => new string((p ?? string.Empty).Where(char.IsDigit).ToArray());
    private static string Clip(string s) => s.Length > 300 ? s[..300] : s;
    private static string? ExtractJson(string raw, string prop)
    {
        try { using var d = JsonDocument.Parse(raw); return d.RootElement.TryGetProperty(prop, out var v) ? v.GetString() : null; }
        catch (JsonException) { return null; }
    }
}

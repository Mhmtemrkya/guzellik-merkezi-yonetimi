using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.PlatformMessaging;

/// <summary>Platform geneli SMS + e-posta gönderim altyapısı (yalnızca PlatformAdmin yönetir).</summary>
public interface IPlatformMessagingService
{
    Task<Result<PlatformIntegrationSettingsDto>> GetSettingsAsync(CancellationToken cancellationToken = default);
    Task<Result<PlatformIntegrationSettingsDto>> SaveSettingsAsync(SavePlatformMessagingRequest request, CancellationToken cancellationToken = default);
    Task<Result<MessagingTestResult>> SendTestSmsAsync(string toPhone, CancellationToken cancellationToken = default);
    Task<Result<MessagingTestResult>> SendTestEmailAsync(string toEmail, CancellationToken cancellationToken = default);

    /// <summary>Diğer servislerin kullanması için yeniden kullanılabilir gönderim (yapılandırılmamışsa simülasyon).</summary>
    Task<MessagingTestResult> SendSmsAsync(string toPhone, string message, CancellationToken cancellationToken = default);
    Task<MessagingTestResult> SendEmailAsync(string toEmail, string subject, string htmlBody, CancellationToken cancellationToken = default);
}

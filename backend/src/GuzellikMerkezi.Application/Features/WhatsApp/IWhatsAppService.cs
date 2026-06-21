using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>Kuruma özel WhatsApp hatırlatma + 2 yönlü onay (Meta Cloud API / dev'de simülasyon).</summary>
public interface IWhatsAppService
{
    Task<Result<WhatsAppSettingsDto>> GetSettingsAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<WhatsAppSettingsDto>> SaveSettingsAsync(Guid tenantId, SaveWhatsAppSettingsRequest request, CancellationToken cancellationToken = default);
    Task<Result<ReminderResultDto>> SendReminderAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyCollection<WhatsAppMessageDto>>> RecentMessagesAsync(Guid tenantId, Guid? appointmentId, CancellationToken cancellationToken = default);

    /// <summary>Meta webhook doğrulaması (GET). Eşleşen verify token varsa challenge döner.</summary>
    Task<string?> VerifyWebhookAsync(string? mode, string? verifyToken, string? challenge, CancellationToken cancellationToken = default);

    /// <summary>Meta webhook gelen mesaj gövdesi (POST) — tenant phone_number_id ile çözülür, yanıt yorumlanır.</summary>
    Task HandleInboundAsync(string payloadJson, CancellationToken cancellationToken = default);
}

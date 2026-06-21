using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Notifications;

public interface INotificationService
{
    Task<Result<PagedResult<NotificationTemplateDto>>> ListTemplatesAsync(Guid tenantId, PageRequest page, CancellationToken ct = default);
    Task<Result<NotificationTemplateDto>> GetTemplateAsync(Guid tenantId, Guid id, CancellationToken ct = default);
    Task<Result<NotificationTemplateDto>> CreateTemplateAsync(Guid tenantId, CreateNotificationTemplateRequest req, CancellationToken ct = default);
    Task<Result<NotificationTemplateDto>> UpdateTemplateAsync(Guid tenantId, Guid id, UpdateNotificationTemplateRequest req, CancellationToken ct = default);
    Task<Result> DeleteTemplateAsync(Guid tenantId, Guid id, CancellationToken ct = default);

    Task<Result<PagedResult<NotificationLogDto>>> ListLogsAsync(Guid tenantId, Guid? templateId, PageRequest page, CancellationToken ct = default);
    Task<Result<NotificationSummaryDto>> GetSummaryAsync(Guid tenantId, CancellationToken ct = default);

    Task<Result<SendNotificationResultDto>> SendAsync(Guid tenantId, SendNotificationRequest req, CancellationToken ct = default);

    /// <summary>Vadesi gelmiş/geçmiş ve ödenmemiş taksiti olan müşteri Id'leri (allocation bazlı).</summary>
    Task<IReadOnlyList<Guid>> GetPaymentDueTargetsAsync(Guid tenantId, DateOnly today, CancellationToken ct = default);

    /// <summary>Geri kazanım (win-back) hedefi: uzun süredir gelmeyen pasif müşteri Id'leri.</summary>
    Task<IReadOnlyList<Guid>> GetWinBackTargetsAsync(Guid tenantId, CancellationToken ct = default);

    /// <summary>Vadesi geçen taksit hatırlatmasını şimdi çalıştırır; gönderilen mesaj sayısını döndürür.</summary>
    Task<Result<int>> RunPaymentDueRemindersAsync(Guid tenantId, CancellationToken ct = default);
}

using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Consents;

/// <summary>
/// Onam formu (rıza/onay formu) yönetimi: şablonlar, hizmet bağları, müşteri kayıtları ve
/// tablet üzerinden dijital imza oturumu.
/// </summary>
public interface IConsentService
{
    // --- şablonlar ---
    Task<Result<IReadOnlyCollection<ConsentTemplateDto>>> ListTemplatesAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<ConsentTemplateDto>> CreateTemplateAsync(Guid tenantId, UpsertConsentTemplateRequest request, CancellationToken cancellationToken = default);
    Task<Result<ConsentTemplateDto>> UpdateTemplateAsync(Guid tenantId, Guid id, UpsertConsentTemplateRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteTemplateAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    // --- müşteri kayıtları ---
    Task<Result<IReadOnlyCollection<ConsentFormDto>>> ListCustomerFormsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);
    Task<Result<ConsentFormDto>> GetFormAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<ConsentFormDto>> CreateFormAsync(Guid tenantId, CreateConsentFormRequest request, CancellationToken cancellationToken = default);
    Task<Result<ConsentFormDto>> UpdateFormAsync(Guid tenantId, Guid id, UpdateConsentFormRequest request, CancellationToken cancellationToken = default);
    Task<Result> CancelFormAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    // --- imza oturumu (tablet) ---
    Task<Result<ConsentFormDto>> StartSessionAsync(Guid tenantId, Guid id, StartConsentSessionRequest request, CancellationToken cancellationToken = default);
    Task<Result> CancelSessionAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    /// <summary>Tablet yoklaması: bu istasyona gönderilmiş bekleyen form (yoksa null döner).</summary>
    Task<Result<ConsentFormDto?>> GetPendingForStationAsync(Guid tenantId, string? stationName, CancellationToken cancellationToken = default);
    Task<Result<ConsentFormDto>> GetBySessionAsync(Guid tenantId, Guid sessionToken, CancellationToken cancellationToken = default);
    Task<Result<ConsentFormDto>> SignAsync(Guid tenantId, Guid sessionToken, SignConsentFormRequest request, CancellationToken cancellationToken = default);

    // --- durum / uyarılar ---
    Task<Result<ConsentStatusDto>> GetAppointmentStatusAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default);
    Task<Result<ConsentStatusDto>> GetCustomerStatusAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);
}

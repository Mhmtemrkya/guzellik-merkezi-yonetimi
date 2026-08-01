using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Appointments;

public interface IAppointmentService
{
    Task<Result<PagedResult<AppointmentDto>>> ListAsync(Guid tenantId, DateTime? fromUtc, DateTime? toUtc, PageRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null, Guid? customerId = null);
    Task<Result<AppointmentDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result<AppointmentDto>> CreateAsync(Guid tenantId, CreateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result<AppointmentDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result<AppointmentDto>> ChangeStatusAsync(Guid tenantId, Guid id, ChangeAppointmentStatusRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    /// <summary>Kurum yöneticisi taslak randevuyu onaylar (Draft → Scheduled). Personel çağıramaz.</summary>
    Task<Result<AppointmentDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    /// <summary>Kurum yöneticisi aksiyon kutusu: saati gelmiş randevular + onay bekleyen taslaklar.</summary>
    Task<Result<AppointmentInboxDto>> GetInboxAsync(Guid tenantId, DateTime nowUtc, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result<AppointmentDto>> ChangeNotesAsync(Guid tenantId, Guid id, ChangeAppointmentNotesRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);

    /// <summary>
    /// Zaman + durum + notu TEK transaction'da günceller (bkz. <see cref="UpdateAppointmentRequest"/>).
    /// Adımlardan biri başarısız olursa hiçbiri kalıcı olmaz — yarım kaydedilmiş randevu kalmaz.
    /// </summary>
    Task<Result<AppointmentDto>> UpdateAsync(Guid tenantId, Guid id, UpdateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
}

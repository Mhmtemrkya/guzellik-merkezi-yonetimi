using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CustomerPortal;

/// <summary>
/// Online randevu portalı (mobil müşteri). Tüm işlemler müşterinin kendi kurumuna (TenantId) kısıtlıdır;
/// başka kurumun şube/hizmet/personeli görülemez. Randevular web ve mobil personel takvimiyle aynı
/// <c>appointments</c> tablosuna düşer → tam senkron, çakışmasız.
/// </summary>
public interface ICustomerPortalService
{
    Task<Result<PortalProfileDto>> GetProfileAsync(Guid customerId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyCollection<PortalBranchDto>>> ListBranchesAsync(Guid customerId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyCollection<PortalServiceDto>>> ListServicesAsync(Guid customerId, Guid branchId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyCollection<PortalStaffDto>>> ListStaffAsync(Guid customerId, Guid branchId, Guid serviceId, CancellationToken cancellationToken = default);
    Task<Result<PortalAvailabilityDto>> GetAvailabilityAsync(Guid customerId, Guid branchId, Guid staffId, Guid serviceId, DateOnly date, CancellationToken cancellationToken = default);
    Task<Result<PortalAppointmentDto>> CreateAppointmentAsync(Guid customerId, CreatePortalAppointmentRequest request, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyCollection<PortalAppointmentDto>>> ListMyAppointmentsAsync(Guid customerId, CancellationToken cancellationToken = default);
    /// <summary>Müşteri kendi randevusunu iptal eder (başlangıca ≥ 2 saat varken).</summary>
    Task<Result> CancelMyAppointmentAsync(Guid customerId, Guid appointmentId, CancellationToken cancellationToken = default);
    /// <summary>Müşteri kendi randevusunu erteler — yeni saat yönetici onayına (Draft) düşer.</summary>
    Task<Result> RescheduleMyAppointmentAsync(Guid customerId, Guid appointmentId, ReschedulePortalAppointmentRequest request, CancellationToken cancellationToken = default);
}

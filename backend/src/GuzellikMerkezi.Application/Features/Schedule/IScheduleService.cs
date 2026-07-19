using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Schedule;

public interface IScheduleService
{
    Task<Result<IReadOnlyCollection<StaffTimeOffDto>>> ListTimeOffAsync(Guid tenantId, DateOnly fromDate, DateOnly toDate, CancellationToken cancellationToken = default);
    Task<Result<StaffTimeOffDto>> AddTimeOffAsync(Guid tenantId, CreateTimeOffRequest request, CancellationToken cancellationToken = default);
    Task<Result> RemoveTimeOffAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Personelin haftalık çalışma şablonu (satırı olmayan gün = kısıt yok).</summary>
    Task<Result<StaffWorkingHoursDto>> GetWorkingHoursAsync(Guid tenantId, Guid staffMemberId, CancellationToken cancellationToken = default);
    /// <summary>Şablonu tamamen değiştirir (gönderilen günler yazılır, gönderilmeyenler silinir).</summary>
    Task<Result<StaffWorkingHoursDto>> SetWorkingHoursAsync(Guid tenantId, Guid staffMemberId, SetWorkingHoursRequest request, CancellationToken cancellationToken = default);

    /// <summary>Kurum genelinde çalışma saatleri kısıtı (yönetici kapatabilir).</summary>
    Task<Result<WorkingHoursEnforcementDto>> GetWorkingHoursEnforcementAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<WorkingHoursEnforcementDto>> SetWorkingHoursEnforcementAsync(Guid tenantId, WorkingHoursEnforcementDto request, CancellationToken cancellationToken = default);
}

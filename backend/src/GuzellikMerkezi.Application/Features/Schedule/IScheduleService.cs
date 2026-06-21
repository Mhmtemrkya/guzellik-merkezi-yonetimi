using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Schedule;

public interface IScheduleService
{
    Task<Result<IReadOnlyCollection<StaffTimeOffDto>>> ListTimeOffAsync(Guid tenantId, DateOnly fromDate, DateOnly toDate, CancellationToken cancellationToken = default);
    Task<Result<StaffTimeOffDto>> AddTimeOffAsync(Guid tenantId, CreateTimeOffRequest request, CancellationToken cancellationToken = default);
    Task<Result> RemoveTimeOffAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}

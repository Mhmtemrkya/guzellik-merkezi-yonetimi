using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Schedule;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class ScheduleService : IScheduleService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public ScheduleService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result<IReadOnlyCollection<StaffTimeOffDto>>> ListTimeOffAsync(Guid tenantId, DateOnly fromDate, DateOnly toDate, CancellationToken cancellationToken = default)
    {
        var rows = await _db.StaffTimeOffs.AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.Date >= fromDate && t.Date <= toDate)
            .ToListAsync(cancellationToken);

        var staffMap = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName })
            .ToDictionaryAsync(s => s.Id, s => s.FullName, cancellationToken);

        var dtos = rows
            .OrderBy(t => t.Date)
            .Select(t => new StaffTimeOffDto(t.Id, t.StaffMemberId,
                staffMap.TryGetValue(t.StaffMemberId, out var n) ? n : null, t.Date, t.Reason))
            .ToArray();
        return Result<IReadOnlyCollection<StaffTimeOffDto>>.Success(dtos);
    }

    public async Task<Result<StaffTimeOffDto>> AddTimeOffAsync(Guid tenantId, CreateTimeOffRequest request, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == request.StaffMemberId, cancellationToken);
        if (staff is null) return Result<StaffTimeOffDto>.Failure(Error.NotFound("Personel bulunamadı."));

        var exists = await _db.StaffTimeOffs.AnyAsync(t => t.TenantId == tenantId && t.StaffMemberId == request.StaffMemberId && t.Date == request.Date, cancellationToken);
        if (exists) return Result<StaffTimeOffDto>.Failure(Error.Conflict("Bu gün için zaten izin tanımlı."));

        var timeOff = new StaffTimeOff(tenantId, request.StaffMemberId, request.Date, request.Reason);
        _db.StaffTimeOffs.Add(timeOff);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, staff.BranchId, "Create", "StaffTimeOff", timeOff.Id,
            $"İzin: {staff.FullName} · {request.Date}", new { request.StaffMemberId, request.Date, request.Reason }, cancellationToken);

        return Result<StaffTimeOffDto>.Success(new StaffTimeOffDto(timeOff.Id, timeOff.StaffMemberId, staff.FullName, timeOff.Date, timeOff.Reason));
    }

    public async Task<Result> RemoveTimeOffAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var timeOff = await _db.StaffTimeOffs.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == id, cancellationToken);
        if (timeOff is null) return Result.Failure(Error.NotFound("İzin kaydı bulunamadı."));
        timeOff.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

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

        // (StaffMemberId, Date) UNIQUE index'i soft-deleted satırları da kapsar. Query filter'ı yok sayıp
        // fiziksel satırı ara: soft-deleted varsa canlandır (yeniden INSERT = unique çakışması = 500 önlenir),
        // aktif satır varsa çakışma döndür, hiç yoksa yeni ekle. (izin ver → iptal → tekrar ver toggle'ı için.)
        var existing = await _db.StaffTimeOffs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId && t.StaffMemberId == request.StaffMemberId && t.Date == request.Date, cancellationToken);

        StaffTimeOff timeOff;
        if (existing is not null)
        {
            if (!existing.IsDeleted) return Result<StaffTimeOffDto>.Failure(Error.Conflict("Bu gün için zaten izin tanımlı."));
            existing.Restore();
            existing.SetReason(request.Reason);
            timeOff = existing;
        }
        else
        {
            timeOff = new StaffTimeOff(tenantId, request.StaffMemberId, request.Date, request.Reason);
            _db.StaffTimeOffs.Add(timeOff);
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, staff.BranchId, "Create", "StaffTimeOff", timeOff.Id,
            $"İzin: {staff.FullName} · {request.Date}", new { request.StaffMemberId, request.Date, request.Reason }, cancellationToken);

        return Result<StaffTimeOffDto>.Success(new StaffTimeOffDto(timeOff.Id, timeOff.StaffMemberId, staff.FullName, timeOff.Date, timeOff.Reason));
    }

    public async Task<Result<StaffWorkingHoursDto>> GetWorkingHoursAsync(Guid tenantId, Guid staffMemberId, CancellationToken cancellationToken = default)
    {
        var rows = await _db.StaffWorkingHours.AsNoTracking()
            .Where(w => w.TenantId == tenantId && w.StaffMemberId == staffMemberId)
            .OrderBy(w => w.DayOfWeek)
            .Select(w => new WorkingHourDto(w.DayOfWeek, w.StartMinute, w.EndMinute, w.IsDayOff))
            .ToArrayAsync(cancellationToken);
        return Result<StaffWorkingHoursDto>.Success(new StaffWorkingHoursDto(staffMemberId, rows));
    }

    public async Task<Result<StaffWorkingHoursDto>> SetWorkingHoursAsync(Guid tenantId, Guid staffMemberId, SetWorkingHoursRequest request, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == staffMemberId, cancellationToken);
        if (staff is null) return Result<StaffWorkingHoursDto>.Failure(Error.NotFound("Personel bulunamadı."));

        var days = (request.Days ?? Array.Empty<WorkingHourDto>()).ToArray();
        if (days.Select(d => d.DayOfWeek).Distinct().Count() != days.Length)
            return Result<StaffWorkingHoursDto>.Failure(Error.Validation("Aynı gün için birden fazla satır gönderilemez."));
        foreach (var d in days)
        {
            if (d.DayOfWeek is < 0 or > 6) return Result<StaffWorkingHoursDto>.Failure(Error.Validation("Gün 0-6 aralığında olmalı."));
            if (!d.IsDayOff && (d.StartMinute < 0 || d.EndMinute > 1440 || d.EndMinute <= d.StartMinute))
                return Result<StaffWorkingHoursDto>.Failure(Error.Validation("Saat aralığı geçersiz (bitiş başlangıçtan sonra olmalı)."));
        }

        // Şablon tamamen değiştirilir: unique index (StaffMemberId, DayOfWeek) soft-deleted satırları da
        // kapsadığından fiziksel satırlar günceller/canlandırılır, artık gönderilmeyenler soft-delete edilir.
        var existing = await _db.StaffWorkingHours.IgnoreQueryFilters()
            .Where(w => w.TenantId == tenantId && w.StaffMemberId == staffMemberId)
            .ToListAsync(cancellationToken);
        var sentDays = days.ToDictionary(d => d.DayOfWeek);
        foreach (var row in existing)
        {
            if (sentDays.TryGetValue(row.DayOfWeek, out var d))
            {
                if (row.IsDeleted) row.Restore();
                row.SetHours(d.StartMinute, d.EndMinute, d.IsDayOff);
                sentDays.Remove(row.DayOfWeek);
            }
            else if (!row.IsDeleted)
            {
                row.SoftDelete();
            }
        }
        foreach (var d in sentDays.Values)
        {
            _db.StaffWorkingHours.Add(new StaffWorkingHour(tenantId, staffMemberId, d.DayOfWeek, d.StartMinute, d.EndMinute, d.IsDayOff));
        }
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, staff.BranchId, "Update", "StaffWorkingHours", staffMemberId,
            $"Çalışma saatleri güncellendi: {staff.FullName}", new { Days = days }, cancellationToken);
        return await GetWorkingHoursAsync(tenantId, staffMemberId, cancellationToken);
    }

    public async Task<Result<WorkingHoursEnforcementDto>> GetWorkingHoursEnforcementAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var enabled = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => (bool?)t.EnforceWorkingHours)
            .FirstOrDefaultAsync(cancellationToken);
        return enabled is null
            ? Result<WorkingHoursEnforcementDto>.Failure(Error.NotFound("Kurum bulunamadı."))
            : Result<WorkingHoursEnforcementDto>.Success(new WorkingHoursEnforcementDto(enabled.Value));
    }

    public async Task<Result<WorkingHoursEnforcementDto>> SetWorkingHoursEnforcementAsync(Guid tenantId, WorkingHoursEnforcementDto request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<WorkingHoursEnforcementDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        tenant.SetEnforceWorkingHours(request.Enabled);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "Update", "Tenant", tenantId,
            request.Enabled ? "Çalışma saatleri kısıtı açıldı" : "Çalışma saatleri kısıtı kapatıldı", null, cancellationToken);
        return Result<WorkingHoursEnforcementDto>.Success(new WorkingHoursEnforcementDto(tenant.EnforceWorkingHours));
    }

    public async Task<Result> RemoveTimeOffAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var timeOff = await _db.StaffTimeOffs.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == id, cancellationToken);
        // Zaten silinmişse idempotent davran: toggle'da hızlı çift-iptal 404/hata üretmesin (hedef durum = izin yok).
        if (timeOff is null) return Result.Success();
        timeOff.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

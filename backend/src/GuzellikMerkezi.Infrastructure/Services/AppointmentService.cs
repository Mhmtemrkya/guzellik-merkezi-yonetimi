using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AppointmentService : IAppointmentService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;

    public AppointmentService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
    }

    public async Task<Result<PagedResult<AppointmentDto>>> ListAsync(Guid tenantId, DateTime? fromUtc, DateTime? toUtc, PageRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var query = ApplyStaffScope(_db.Appointments.AsNoTracking().Where(x => x.TenantId == tenantId), staffTenantUserId)
            .OrderBy(x => x.StartUtc)
            .AsQueryable();
        if (fromUtc.HasValue) query = query.Where(x => x.StartUtc >= fromUtc.Value);
        if (toUtc.HasValue) query = query.Where(x => x.StartUtc <= toUtc.Value);
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip(request.Skip)
            .Take(request.SafePageSize)
            .Select(x => new AppointmentDto(
                x.Id,
                x.TenantId,
                x.BranchId,
                x.CustomerId,
                x.StaffMemberId,
                x.ServiceDefinitionId,
                x.StartUtc,
                x.EndUtc,
                x.Status,
                x.Price,
                x.Notes,
                x.CancellationReason,
                x.Customer != null ? x.Customer.FullName : null,
                x.StaffMember != null ? x.StaffMember.FullName : null,
                x.ServiceDefinition != null ? x.ServiceDefinition.Name : null,
                x.CustomerConfirmation,
                x.LastReminderAtUtc))
            .ToArrayAsync(cancellationToken);
        return Result<PagedResult<AppointmentDto>>.Success(new PagedResult<AppointmentDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<AppointmentDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId)
            .Include(x => x.Customer)
            .Include(x => x.StaffMember)
            .Include(x => x.ServiceDefinition)
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return appointment is null ? Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı.")) : Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result<AppointmentDto>> CreateAsync(Guid tenantId, CreateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "appointments", cancellationToken);
        if (limit.IsFailure) return Result<AppointmentDto>.Failure(limit.Error);

        if (!await IsStaffInScopeAsync(tenantId, request.StaffMemberId, staffTenantUserId, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.NotFound("Randevu personel kapsamı bulunamadı."));
        }

        // Kara liste: bu müşteriye randevu verilemez.
        if (await _db.Customers.AsNoTracking().AnyAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId && c.IsBlacklisted, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.Conflict("Bu müşteri kara listede; randevu oluşturulamaz."));
        }

        // Satış şartı: randevu yalnızca onaylanmış paket/hizmet satışı olan müşteriye verilebilir.
        if (!await HasApprovedSaleAsync(tenantId, request.CustomerId, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.Validation(
                "Randevu oluşturmak için müşterinin kurum sahibi tarafından onaylanmış bir paket veya hizmet satışı olmalı."));
        }

        var overlap = await HasOverlapAsync(tenantId, request.StaffMemberId, request.StartUtc, request.EndUtc, null, cancellationToken);
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında başka randevusu var."));

        var appointment = new Appointment(tenantId, request.BranchId, request.CustomerId, request.StaffMemberId, request.ServiceDefinitionId, request.StartUtc, request.EndUtc, request.Price, request.Notes);

        // Personel oluşturduysa randevu doğrudan aktif olmaz; taslak olarak kurum yöneticisi onayına düşer.
        var isStaffRequest = staffTenantUserId.HasValue;
        if (isStaffRequest) appointment.SubmitForApproval();

        _db.Appointments.Add(appointment);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Create", "Appointment", appointment.Id,
            isStaffRequest
                ? $"Taslak randevu onaya gönderildi ({appointment.StartUtc:dd.MM.yyyy HH:mm})"
                : $"Randevu oluşturuldu ({appointment.StartUtc:dd.MM.yyyy HH:mm})",
            new { appointment.StartUtc, appointment.EndUtc, appointment.CustomerId, appointment.StaffMemberId, appointment.Price, appointment.Status }, cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    /// <summary>Müşterinin onaylanmış satışı (paket seans bakiyesi ya da onaylı adisyonda satış kalemi) var mı?</summary>
    private async Task<bool> HasApprovedSaleAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        var hasPackage = await _db.CustomerPackageSessions.AsNoTracking()
            .AnyAsync(s => s.TenantId == tenantId && s.CustomerId == customerId, cancellationToken);
        if (hasPackage) return true;

        return await (
            from a in _db.Adisyonlar.AsNoTracking()
            join i in _db.AdisyonItems.AsNoTracking() on a.Id equals i.AdisyonId
            where a.TenantId == tenantId
                && a.CustomerId == customerId
                && a.Status == AdisyonStatus.Approved
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.Product || i.Type == AdisyonItemType.Extra)
            select a.Id).AnyAsync(cancellationToken);
    }

    public async Task<Result<AppointmentDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        var overlap = await HasOverlapAsync(tenantId, appointment.StaffMemberId, request.StartUtc, request.EndUtc, appointment.Id, cancellationToken);
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında başka randevusu var."));

        var prevStart = appointment.StartUtc;
        appointment.Reschedule(request.StartUtc, request.EndUtc);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Reschedule", "Appointment", appointment.Id,
            $"Randevu yeniden planlandı: {prevStart:dd.MM HH:mm} → {appointment.StartUtc:dd.MM HH:mm}",
            new { prevStart, NewStart = appointment.StartUtc, NewEnd = appointment.EndUtc }, cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result<AppointmentDto>> ChangeStatusAsync(Guid tenantId, Guid id, ChangeAppointmentStatusRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        // Zaten istenen durumdaysa no-op — bayat/tekrar onay isteği "tamamlanamaz" hatası vermesin (idempotent).
        if (appointment.Status == request.Status) return Result<AppointmentDto>.Success(appointment.ToDto());

        var prevStatus = appointment.Status;
        switch (request.Status)
        {
            case AppointmentStatus.Confirmed: appointment.Confirm(); break;
            case AppointmentStatus.Completed: appointment.Complete(); break;
            case AppointmentStatus.Cancelled: appointment.Cancel(request.Reason ?? "Belirtilmedi"); break;
            case AppointmentStatus.NoShow: appointment.MarkNoShow(); break;
        }

        // Randevu Tamamlandı'ya geçtiyse, müşterinin bu hizmete ait paket seansından otomatik düş.
        // Complete() yalnızca Scheduled/Confirmed'dan çağrılabildiği için bu blok randevu başına tek kez çalışır.
        if (request.Status == AppointmentStatus.Completed && prevStatus != AppointmentStatus.Completed)
        {
            var session = await _db.CustomerPackageSessions
                .Where(s => s.TenantId == tenantId
                         && s.CustomerId == appointment.CustomerId
                         && s.ServiceDefinitionId == appointment.ServiceDefinitionId
                         && (s.TotalSessions - s.UsedSessions) > 0)
                .OrderBy(s => s.CreatedAtUtc)
                .FirstOrDefaultAsync(cancellationToken);
            session?.TryConsume();
        }

        // İptalde yer açıldı → o güne bekleme listesinde sırada (Waiting) bekleyenleri otomatik
        // "Bilgilendirildi" (Notified) işaretle; personel sıradakine teklif götürebilir.
        var notifiedWaitlist = 0;
        if (request.Status == AppointmentStatus.Cancelled && prevStatus != AppointmentStatus.Cancelled)
        {
            var slotDate = DateOnly.FromDateTime(appointment.StartUtc);
            var waiting = (await _db.WaitlistEntries
                    .Where(w => w.TenantId == tenantId && w.Status == WaitlistStatus.Waiting)
                    .ToListAsync(cancellationToken))
                .Where(w => w.PreferredDate == slotDate
                         && (appointment.ServiceDefinitionId == Guid.Empty || w.ServiceDefinitionId == null || w.ServiceDefinitionId == appointment.ServiceDefinitionId))
                .ToList();
            foreach (var w in waiting) w.SetStatus(WaitlistStatus.Notified);
            notifiedWaitlist = waiting.Count;
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "ChangeStatus", "Appointment", appointment.Id,
            $"Randevu durumu: {prevStatus} → {appointment.Status}{(notifiedWaitlist > 0 ? $" · {notifiedWaitlist} bekleme kaydı bilgilendirildi" : "")}",
            new { prevStatus, NewStatus = appointment.Status, request.Reason, notifiedWaitlist }, cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result<AppointmentDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        // Onay yalnızca kurum yöneticisinde — personel (scope'lu) onaylayamaz.
        if (staffTenantUserId.HasValue) return Result<AppointmentDto>.Failure(Error.Unauthorized("Taslak randevuyu yalnızca kurum yöneticisi onaylayabilir."));

        var appointment = await _db.Appointments.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        if (appointment.Status != AppointmentStatus.Draft) return Result<AppointmentDto>.Failure(Error.Validation("Yalnızca taslak randevu onaylanabilir."));

        // Onay anında aktif randevularla çakışma kontrolü (taslak beklerken slot dolmuş olabilir).
        var overlap = await HasOverlapAsync(tenantId, appointment.StaffMemberId, appointment.StartUtc, appointment.EndUtc, appointment.Id, cancellationToken);
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında aktif bir randevusu var; taslak onaylanamadı."));

        appointment.ApproveDraft();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Approve", "Appointment", appointment.Id,
            $"Taslak randevu onaylandı → aktif ({appointment.StartUtc:dd.MM.yyyy HH:mm})",
            new { appointment.StartUtc, appointment.CustomerId, appointment.StaffMemberId }, cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result<AppointmentInboxDto>> GetInboxAsync(Guid tenantId, DateTime nowUtc, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        if (nowUtc.Kind != DateTimeKind.Utc) nowUtc = DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc);
        var scoped = ApplyStaffScope(_db.Appointments.AsNoTracking().Where(x => x.TenantId == tenantId), staffTenantUserId);

        // Saati gelmiş ama hâlâ açık (sonuç girilmemiş) randevular — yöneticiye "şimdi karar ver" bildirimi.
        var awaitingOutcome = await scoped
            .Where(x => x.StartUtc <= nowUtc && (x.Status == AppointmentStatus.Scheduled || x.Status == AppointmentStatus.Confirmed))
            .OrderBy(x => x.StartUtc)
            .Take(50)
            .Select(ToInboxDto)
            .ToArrayAsync(cancellationToken);

        // Personelin onaya gönderdiği taslaklar.
        var awaitingApproval = await scoped
            .Where(x => x.Status == AppointmentStatus.Draft)
            .OrderBy(x => x.StartUtc)
            .Take(50)
            .Select(ToInboxDto)
            .ToArrayAsync(cancellationToken);

        return Result<AppointmentInboxDto>.Success(new AppointmentInboxDto(awaitingOutcome, awaitingApproval));
    }

    // Inbox projeksiyonu — isimleri navigation'dan çeker (ListAsync ile aynı şekil).
    private static readonly System.Linq.Expressions.Expression<Func<Appointment, AppointmentDto>> ToInboxDto = x => new AppointmentDto(
        x.Id, x.TenantId, x.BranchId, x.CustomerId, x.StaffMemberId, x.ServiceDefinitionId,
        x.StartUtc, x.EndUtc, x.Status, x.Price, x.Notes, x.CancellationReason,
        x.Customer != null ? x.Customer.FullName : null,
        x.StaffMember != null ? x.StaffMember.FullName : null,
        x.ServiceDefinition != null ? x.ServiceDefinition.Name : null,
        x.CustomerConfirmation,
        x.LastReminderAtUtc);

    public async Task<Result<AppointmentDto>> ChangeNotesAsync(Guid tenantId, Guid id, ChangeAppointmentNotesRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        appointment.ChangeNotes(request.Notes);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "ChangeNotes", "Appointment", appointment.Id,
            "Randevu notu güncellendi", null, cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result.Failure(Error.NotFound("Randevu bulunamadı."));
        var snapshot = new { appointment.StartUtc, appointment.CustomerId, appointment.StaffMemberId };
        appointment.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Delete", "Appointment", appointment.Id,
            $"Randevu silindi ({appointment.StartUtc:dd.MM.yyyy HH:mm})", snapshot, cancellationToken);
        return Result.Success();
    }

    private Task<bool> HasOverlapAsync(Guid tenantId, Guid staffMemberId, DateTime startUtc, DateTime endUtc, Guid? excludingAppointmentId, CancellationToken cancellationToken)
    {
        // Taslak (onay bekleyen) randevular slotu bloke etmez; yalnızca aktif randevular çakışır.
        return _db.Appointments.AnyAsync(x => x.TenantId == tenantId && x.StaffMemberId == staffMemberId &&
            (!excludingAppointmentId.HasValue || x.Id != excludingAppointmentId.Value) &&
            x.Status != AppointmentStatus.Cancelled && x.Status != AppointmentStatus.NoShow && x.Status != AppointmentStatus.Draft &&
            x.StartUtc < endUtc && startUtc < x.EndUtc, cancellationToken);
    }

    private IQueryable<Appointment> ApplyStaffScope(IQueryable<Appointment> query, Guid? staffTenantUserId)
    {
        if (!staffTenantUserId.HasValue) return query;
        var tenantUserId = staffTenantUserId.Value;
        return query.Where(x => _db.StaffMembers.Any(s =>
            s.TenantId == x.TenantId &&
            s.Id == x.StaffMemberId &&
            s.TenantUserId == tenantUserId));
    }

    private Task<bool> IsStaffInScopeAsync(Guid tenantId, Guid staffMemberId, Guid? staffTenantUserId, CancellationToken cancellationToken)
    {
        if (!staffTenantUserId.HasValue) return Task.FromResult(true);
        var tenantUserId = staffTenantUserId.Value;
        return _db.StaffMembers.AnyAsync(x => x.TenantId == tenantId && x.Id == staffMemberId && x.TenantUserId == tenantUserId, cancellationToken);
    }
}

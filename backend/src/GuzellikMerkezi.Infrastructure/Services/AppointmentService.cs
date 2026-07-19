using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AppointmentService : IAppointmentService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;
    private readonly IWaitlistService _waitlist;
    private readonly IDurableJobQueue _jobs;
    private readonly IAppNotificationService _notifications;
    private readonly ICurrentUser _currentUser;

    public AppointmentService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit, IWaitlistService waitlist, IDurableJobQueue jobs, IAppNotificationService notifications, ICurrentUser currentUser)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
        _waitlist = waitlist;
        _jobs = jobs;
        _notifications = notifications;
        _currentUser = currentUser;
    }

    // Personel müşteri telefonunu yalnızca maskeli görür (PhoneMask kuralı).
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    /// <summary>Bildirim gövdesi için müşteri adı (şifreli kolon okuma anında çözülür). Yoksa "Müşteri".</summary>
    private async Task<string> CustomerNameAsync(Guid tenantId, Guid customerId, CancellationToken ct)
    {
        var name = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Id == customerId)
            .Select(c => c.FullName)
            .FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(name) ? "Müşteri" : name;
    }

    /// <summary>Randevunun atandığı personelin TenantUser kimliği (hesabı yoksa null).</summary>
    private async Task<Guid?> AssignedStaffUserIdAsync(Guid tenantId, Guid staffMemberId, CancellationToken ct)
    {
        var uid = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Id == staffMemberId)
            .Select(s => s.TenantUserId)
            .FirstOrDefaultAsync(ct);
        return uid == Guid.Empty ? null : uid;
    }

    /// <summary>
    /// Atanmış personele randevu bildirimi. Personel panelindeki bildirimler yönetici panelinden
    /// AYRIŞIR: personel yalnızca KENDİ randevu olaylarını görür (yönetim olayları rol hedeflidir).
    /// Olayı personelin kendisi tetiklediyse (actorStaffUserId) kendi kendine bildirim üretilmez.
    /// </summary>
    private async Task NotifyAssignedStaffAsync(
        Appointment appointment, Guid? actorStaffUserId,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string dedupePrefix, CancellationToken ct)
    {
        var uid = await AssignedStaffUserIdAsync(appointment.TenantId, appointment.StaffMemberId, ct);
        if (uid is null || uid == actorStaffUserId) return;
        var customerName = await CustomerNameAsync(appointment.TenantId, appointment.CustomerId, ct);
        await _notifications.NotifyUserAsync(
            appointment.TenantId, appointment.BranchId, uid.Value,
            type, severity,
            title,
            $"{customerName} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}",
            data: new { route = "/appointments", id = appointment.Id.ToString() },
            dedupeKey: $"{dedupePrefix}:{appointment.Id}",
            ct: ct);
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
                x.LastReminderAtUtc,
                x.IsOnline,
                x.Customer != null ? x.Customer.Phone : null))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer)
        {
            items = items.Select(a => a with { CustomerPhone = PhoneMask.Mask(a.CustomerPhone) }).ToArray();
        }
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
        // SlotFull kodu: frontend bunu "bekleme listesine ekle?" uyarısı için ayırt eder (kara liste 409'undan farklı).
        if (overlap) return Result<AppointmentDto>.Failure(Error.SlotFull("Bu saatte personelin uygun yeri yok. Bekleme listesine ekleyebilirsiniz."));

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

        // Yönetici oluşturduysa atanmış personele "yeni randevu" bildirimi (personel paneli farkı).
        if (!isStaffRequest)
        {
            await NotifyAssignedStaffAsync(appointment, staffTenantUserId,
                AppNotificationType.AppointmentCreated, AppNotificationSeverity.Info,
                "Sana yeni randevu atandı", "appt-assigned", cancellationToken);
        }
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
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında en fazla 2 randevusu olabilir."));

        var prevStart = appointment.StartUtc;
        appointment.Reschedule(request.StartUtc, request.EndUtc);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Reschedule", "Appointment", appointment.Id,
            $"Randevu yeniden planlandı: {prevStart:dd.MM HH:mm} → {appointment.StartUtc:dd.MM HH:mm}",
            new { prevStart, NewStart = appointment.StartUtc, NewEnd = appointment.EndUtc }, cancellationToken);

        // Saat değişikliğini atanmış personel de görsün (kendisi değiştirmediyse).
        await NotifyAssignedStaffAsync(appointment, staffTenantUserId,
            AppNotificationType.AppointmentUpdated, AppNotificationSeverity.Info,
            "Randevun yeniden planlandı", $"appt-resched:{appointment.StartUtc:yyyyMMddHHmm}", cancellationToken);
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

        // Durum değişikliğini (+ tamamlanınca seans düşümü) önce kaydet: bekleme listesi offer akışı
        // overlap'i DB'den okuyacağı için slot boşalması kalıcı olmalı.
        await _db.SaveChangesAsync(cancellationToken);

        // Tamamlanınca müşteriye WhatsApp'tan değerlendirme linki (personel + salon yıldızı) gönder.
        // Kalıcı kuyruğa yazılır (best-effort): link üretimi + Meta HTTP çağrısı istek yolunu bekletmez.
        if (request.Status == AppointmentStatus.Completed && prevStatus != AppointmentStatus.Completed)
        {
            await _jobs.EnqueueAsync(Background.DurableJobTypes.RatingLink,
                new Background.RatingLinkJob(tenantId, appointment.Id), cancellationToken);
        }

        // İptalde yer açıldı → bekleme listesindeki ilk uygun müşteriye WhatsApp'tan "yer açıldı, ister misiniz?"
        // teklifi götür (offer-first). Best-effort: teklif/gönderim başarısız olsa da iptal geçerli kalır.
        Guid? offeredWaitlistId = null;
        if (request.Status == AppointmentStatus.Cancelled && prevStatus != AppointmentStatus.Cancelled)
        {
            var offer = await _waitlist.SelectAndMarkOfferAsync(tenantId, appointment.Id, cancellationToken);
            if (offer.IsSuccess && offer.Value is { } offeredId)
            {
                offeredWaitlistId = offeredId;
                // WhatsApp teklifini (yavaş Meta HTTP) KALICI kuyruğa yaz → iptal yanıtı beklemez,
                // restart'ta kaybolmaz, başarısızlıkta otomatik yeniden denenir.
                await _jobs.EnqueueAsync(Background.DurableJobTypes.WaitlistOffer,
                    new Background.WaitlistOfferJob(tenantId, offeredId), cancellationToken);
            }
        }

        await _audit.LogAsync(tenantId, appointment.BranchId, "ChangeStatus", "Appointment", appointment.Id,
            $"Randevu durumu: {prevStatus} → {appointment.Status}{(offeredWaitlistId is not null ? " · bekleme listesine teklif gönderildi" : "")}",
            new { prevStatus, NewStatus = appointment.Status, request.Reason, offeredWaitlistId }, cancellationToken);

        // İptal / Gelmedi → kurum/şube yöneticisine bildirim (yeni randevu için slot boşaldı / takip).
        if ((request.Status == AppointmentStatus.Cancelled || request.Status == AppointmentStatus.NoShow)
            && prevStatus != request.Status)
        {
            var customerName = await CustomerNameAsync(tenantId, appointment.CustomerId, cancellationToken);
            var isCancel = request.Status == AppointmentStatus.Cancelled;
            await _notifications.NotifyRolesAsync(
                tenantId, appointment.BranchId,
                new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
                isCancel ? AppNotificationType.AppointmentCancelled : AppNotificationType.AppointmentUpdated,
                AppNotificationSeverity.Warning,
                isCancel ? "Randevu iptal edildi" : "Müşteri gelmedi",
                $"{customerName} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}"
                    + (offeredWaitlistId is not null ? " · bekleme listesine teklif gönderildi" : string.Empty),
                data: new { route = "/appointments", id = appointment.Id.ToString() },
                dedupeKey: $"appt-{appointment.Status}:{appointment.Id}",
                ct: cancellationToken);

            // Atanmış personel de kendi randevusunun iptalini/gelmediğini görür.
            await NotifyAssignedStaffAsync(appointment, staffTenantUserId,
                isCancel ? AppNotificationType.AppointmentCancelled : AppNotificationType.AppointmentUpdated,
                AppNotificationSeverity.Warning,
                isCancel ? "Randevun iptal edildi" : "Müşterin gelmedi",
                $"appt-staff-{appointment.Status}", cancellationToken);
        }

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
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında en fazla 2 randevusu olabilir; taslak onaylanamadı."));

        appointment.ApproveDraft();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Approve", "Appointment", appointment.Id,
            $"Taslak randevu onaylandı → aktif ({appointment.StartUtc:dd.MM.yyyy HH:mm})",
            new { appointment.StartUtc, appointment.CustomerId, appointment.StaffMemberId }, cancellationToken);

        // Randevu aktifleşti → atanan personelin kullanıcı hesabına bildirim ("randevunuz onaylandı").
        var staffUserId = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Id == appointment.StaffMemberId)
            .Select(s => s.TenantUserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (staffUserId is Guid uid && uid != Guid.Empty)
        {
            var customerName = await CustomerNameAsync(tenantId, appointment.CustomerId, cancellationToken);
            await _notifications.NotifyUserAsync(
                tenantId, appointment.BranchId, uid,
                AppNotificationType.AppointmentUpdated, AppNotificationSeverity.Success,
                "Randevu onaylandı",
                $"{customerName} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}",
                data: new { route = "/appointments", id = appointment.Id.ToString() },
                dedupeKey: $"appt-approve:{appointment.Id}",
                ct: cancellationToken);
        }

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

    /// <summary>Bir personel aynı saat aralığında en fazla bu kadar aktif randevu alabilir.</summary>
    private const int MaxConcurrentAppointmentsPerStaff = 2;

    private async Task<bool> HasOverlapAsync(Guid tenantId, Guid staffMemberId, DateTime startUtc, DateTime endUtc, Guid? excludingAppointmentId, CancellationToken cancellationToken)
    {
        // Taslak (onay bekleyen) randevular slotu bloke etmez; yalnızca aktif randevular çakışır.
        // Aynı personel aynı slotta en fazla 2 aktif randevu alabilir; 3.'sü engellenir.
        var overlapping = await _db.Appointments.CountAsync(x => x.TenantId == tenantId && x.StaffMemberId == staffMemberId &&
            (!excludingAppointmentId.HasValue || x.Id != excludingAppointmentId.Value) &&
            x.Status != AppointmentStatus.Cancelled && x.Status != AppointmentStatus.NoShow && x.Status != AppointmentStatus.Draft &&
            x.StartUtc < endUtc && startUtc < x.EndUtc, cancellationToken);
        return overlapping >= MaxConcurrentAppointmentsPerStaff;
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

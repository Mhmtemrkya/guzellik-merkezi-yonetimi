using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerPortal;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Linq.Expressions;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CustomerPortalService : ICustomerPortalService
{
    private static readonly TimeSpan TurkeyOffset = TimeSpan.FromHours(3);
    private const int MaxConcurrentAppointmentsPerStaff = 2;
    /// <summary>Müşterinin bir kurumda aynı anda açık (gelecek tarihli Draft/Scheduled/Confirmed) randevu sayısı sınırı — spam freni.</summary>
    private const int MaxUpcomingAppointmentsPerCustomer = 3;
    /// <summary>Son 90 günde bu kadar "gelmedi" (NoShow) kaydı olan müşteri online randevu alamaz.</summary>
    private const int NoShowBlockThreshold = 3;
    private const int NoShowLookbackDays = 90;

    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;
    private readonly Application.Features.AppNotifications.IAppNotificationService _notifications;

    public CustomerPortalService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit, IFeatureService features, Application.Features.AppNotifications.IAppNotificationService notifications)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
        _features = features;
        _notifications = notifications;
    }

    // --- Kimlik / kapsam yardımcıları ---

    private async Task<Customer?> LoadCustomerAsync(Guid customerId, CancellationToken ct) =>
        await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == customerId && !c.IsDeleted, ct);

    private async Task<Guid?> IndividualTenantIdAsync(CancellationToken ct) =>
        await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Slug == SystemTenant.IndividualSlug).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);

    /// <summary>Pazaryerinde randevu alınabilecek kurumlar: aktif/deneme, iptal-askıda değil, bireysel kurum hariç.</summary>
    private static bool TenantBookable(Tenant t) =>
        t.Status is TenantStatus.Active or TenantStatus.Trial && t.Slug != SystemTenant.IndividualSlug;

    private static string NormalizeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return string.Empty;
        return string.Join(' ', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
    }

    public async Task<Result<PortalProfileDto>> GetProfileAsync(Guid customerId, CancellationToken cancellationToken = default)
    {
        var customer = await LoadCustomerAsync(customerId, cancellationToken);
        if (customer is null) return Result<PortalProfileDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        var individualTenantId = await IndividualTenantIdAsync(cancellationToken);
        var isMarketplace = customer.TenantId == individualTenantId;
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == customer.TenantId, cancellationToken);
        return Result<PortalProfileDto>.Success(new PortalProfileDto(
            customer.Id, customer.FullName, customer.Phone, customer.TenantId,
            isMarketplace ? string.Empty : (tenant?.Name ?? string.Empty), customer.BranchId, false, isMarketplace));
    }

    public async Task<Result<IReadOnlyCollection<PortalBranchDto>>> ListBranchesAsync(Guid customerId, CancellationToken cancellationToken = default)
    {
        var customer = await LoadCustomerAsync(customerId, cancellationToken);
        if (customer is null) return Result<IReadOnlyCollection<PortalBranchDto>>.Failure(Error.NotFound("Müşteri bulunamadı."));
        var individualTenantId = await IndividualTenantIdAsync(cancellationToken);
        var isMarketplace = customer.TenantId == individualTenantId;

        // Paket gating: online randevu yalnızca planında "appointments.onlinebooking" olan kurumlara açık.
        if (!isMarketplace && !await _features.IsFeatureAllowedAsync(customer.TenantId, FeatureCatalog.AppointmentsOnlineBooking, cancellationToken))
            return Result<IReadOnlyCollection<PortalBranchDto>>.Failure(Error.Conflict("Bu kurumda online randevu özelliği aktif değil. Lütfen salonla iletişime geçin."));

        var query = _db.Branches.IgnoreQueryFilters().AsNoTracking().Where(b => !b.IsDeleted);
        query = isMarketplace
            // Pazaryeri: bireysel kurum hariç, aktif/deneme ve planında online randevu olan kurumların şubeleri.
            ? query.Where(b => b.TenantId != individualTenantId
                            && b.Tenant != null
                            && (b.Tenant.Status == TenantStatus.Active || b.Tenant.Status == TenantStatus.Trial)
                            && b.Tenant.SubscriptionPlan != null
                            && b.Tenant.SubscriptionPlan.Features != null
                            && b.Tenant.SubscriptionPlan.Features.Contains(FeatureCatalog.AppointmentsOnlineBooking))
            // Kuruma bağlı müşteri: yalnız kendi kurumunun şubeleri.
            : query.Where(b => b.TenantId == customer.TenantId);

        var branches = await query
            .OrderBy(b => b.Tenant!.Name).ThenByDescending(b => b.IsDefault).ThenBy(b => b.Name)
            .Select(b => new PortalBranchDto(b.Id, b.Name, b.City, b.IsDefault, b.TenantId, b.Tenant!.Name))
            .ToArrayAsync(cancellationToken);
        return Result<IReadOnlyCollection<PortalBranchDto>>.Success(branches);
    }

    /// <summary>Şubenin kuruma ait olduğunu ve müşterinin o şubede işlem yapabileceğini doğrular; izinliyse şubenin tenantId'sini döner.</summary>
    private async Task<(bool ok, Guid tenantId)> AuthorizeBranchAsync(Customer customer, Guid branchId, CancellationToken ct)
    {
        var individualTenantId = await IndividualTenantIdAsync(ct);
        var isMarketplace = customer.TenantId == individualTenantId;
        var branch = await _db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.Id == branchId && !b.IsDeleted)
            .Select(b => new { b.TenantId, Status = b.Tenant!.Status, b.Tenant.Slug })
            .FirstOrDefaultAsync(ct);
        if (branch is null) return (false, Guid.Empty);

        if (isMarketplace)
        {
            // Pazaryeri: bireysel kurum hariç, aktif/deneme her kurum.
            var marketOk = branch.Slug != SystemTenant.IndividualSlug && branch.Status is TenantStatus.Active or TenantStatus.Trial;
            if (!marketOk) return (false, Guid.Empty);
        }
        else if (branch.TenantId != customer.TenantId)
        {
            // Kuruma bağlı: yalnız kendi kurumu.
            return (false, Guid.Empty);
        }

        // Paket gating: kurumun planında online randevu yoksa portal işlemleri kapalı.
        if (!await _features.IsFeatureAllowedAsync(branch.TenantId, FeatureCatalog.AppointmentsOnlineBooking, ct))
            return (false, Guid.Empty);

        return (true, branch.TenantId);
    }

    public async Task<Result<IReadOnlyCollection<PortalServiceDto>>> ListServicesAsync(Guid customerId, Guid branchId, CancellationToken cancellationToken = default)
    {
        var customer = await LoadCustomerAsync(customerId, cancellationToken);
        if (customer is null) return Result<IReadOnlyCollection<PortalServiceDto>>.Failure(Error.NotFound("Müşteri bulunamadı."));
        var (ok, tenantId) = await AuthorizeBranchAsync(customer, branchId, cancellationToken);
        if (!ok) return Result<IReadOnlyCollection<PortalServiceDto>>.Failure(Error.NotFound("Şube bulunamadı."));

        var services = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.IsActive && !s.IsDeleted && (s.BranchId == branchId || s.BranchId == null))
            .OrderBy(s => s.Category).ThenBy(s => s.Name)
            .Select(s => new PortalServiceDto(s.Id, s.Name, s.Category, s.DurationMinutes, s.Price, s.IconKey))
            .ToArrayAsync(cancellationToken);
        return Result<IReadOnlyCollection<PortalServiceDto>>.Success(services);
    }

    public async Task<Result<IReadOnlyCollection<PortalStaffDto>>> ListStaffAsync(Guid customerId, Guid branchId, Guid serviceId, CancellationToken cancellationToken = default)
    {
        var customer = await LoadCustomerAsync(customerId, cancellationToken);
        if (customer is null) return Result<IReadOnlyCollection<PortalStaffDto>>.Failure(Error.NotFound("Müşteri bulunamadı."));
        var (ok, tenantId) = await AuthorizeBranchAsync(customer, branchId, cancellationToken);
        if (!ok) return Result<IReadOnlyCollection<PortalStaffDto>>.Failure(Error.NotFound("Şube bulunamadı."));

        var service = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == serviceId, cancellationToken);
        if (service is null) return Result<IReadOnlyCollection<PortalStaffDto>>.Failure(Error.NotFound("Hizmet bulunamadı."));

        var staff = await _db.StaffMembers.IgnoreQueryFilters().AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.BranchId == branchId && s.IsActive && !s.IsDeleted)
            .OrderBy(s => s.FullName)
            .ToListAsync(cancellationToken);

        bool Matches(StaffMember s) =>
            !string.IsNullOrWhiteSpace(s.Specialties)
            && ((service.Name.Length > 0 && s.Specialties!.Contains(service.Name, StringComparison.OrdinalIgnoreCase))
                || (!string.IsNullOrWhiteSpace(service.Category) && s.Specialties!.Contains(service.Category!, StringComparison.OrdinalIgnoreCase)));

        var matched = staff.Where(Matches).ToList();
        var result = (matched.Count > 0 ? matched : staff)
            .Select(s => new PortalStaffDto(s.Id, s.FullName, s.Title, s.Specialties, s.PhotoUrl))
            .ToArray();
        return Result<IReadOnlyCollection<PortalStaffDto>>.Success(result);
    }

    public async Task<Result<PortalAvailabilityDto>> GetAvailabilityAsync(Guid customerId, Guid branchId, Guid staffId, Guid serviceId, DateOnly date, CancellationToken cancellationToken = default)
    {
        var customer = await LoadCustomerAsync(customerId, cancellationToken);
        if (customer is null) return Result<PortalAvailabilityDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        var (ok, tenantId) = await AuthorizeBranchAsync(customer, branchId, cancellationToken);
        if (!ok) return Result<PortalAvailabilityDto>.Failure(Error.NotFound("Şube bulunamadı."));

        var branch = await _db.Branches.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(b => b.Id == branchId, cancellationToken);
        var service = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == serviceId, cancellationToken);
        if (branch is null || service is null) return Result<PortalAvailabilityDto>.Failure(Error.NotFound("Hizmet bulunamadı."));

        if (!await _db.StaffMembers.IgnoreQueryFilters().AsNoTracking().AnyAsync(s => s.TenantId == tenantId && s.Id == staffId && s.BranchId == branchId && s.IsActive, cancellationToken))
            return Result<PortalAvailabilityDto>.Failure(Error.NotFound("Uzman bulunamadı."));

        var hasTimeOff = await _db.StaffTimeOffs.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(t => t.TenantId == tenantId && t.StaffMemberId == staffId && t.Date == date, cancellationToken);

        var dayStartUtc = ToUtc(date, branch.OpenTime);
        var dayEndUtc = ToUtc(date, branch.CloseTime);
        var dayAppointments = hasTimeOff
            ? null
            : await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.StaffMemberId == staffId
                         && a.Status != AppointmentStatus.Cancelled && a.Status != AppointmentStatus.NoShow && a.Status != AppointmentStatus.Draft
                         && a.StartUtc < dayEndUtc && a.EndUtc > dayStartUtc)
                .Select(a => new { a.StartUtc, a.EndUtc })
                .ToListAsync(cancellationToken);

        var nowUtc = DateTime.UtcNow;
        var slots = new List<PortalSlotDto>();
        var step = TimeSpan.FromMinutes(branch.SlotMinutes);
        var duration = TimeSpan.FromMinutes(service.DurationMinutes);

        for (var t = branch.OpenTime; ; t = t.Add(step))
        {
            var slotEndLocal = t.ToTimeSpan() + duration;
            if (slotEndLocal > branch.CloseTime.ToTimeSpan()) break;
            var startUtc = ToUtc(date, t);
            var endUtc = startUtc + duration;
            var available = !hasTimeOff && startUtc > nowUtc
                && (dayAppointments is null || dayAppointments.Count(a => a.StartUtc < endUtc && startUtc < a.EndUtc) < MaxConcurrentAppointmentsPerStaff);
            slots.Add(new PortalSlotDto(t.ToString("HH:mm"), TimeOnly.FromTimeSpan(slotEndLocal).ToString("HH:mm"), available));
            if (t.Add(step) <= t) break;
        }
        return Result<PortalAvailabilityDto>.Success(new PortalAvailabilityDto(date, slots));
    }

    public async Task<Result<PortalAppointmentDto>> CreateAppointmentAsync(Guid customerId, CreatePortalAppointmentRequest request, CancellationToken cancellationToken = default)
    {
        // Müşteri kimliği (kendi takip kaydı). Pazaryeri müşterisinde randevu, kurum altında gölge müşteriye bağlanır.
        var identity = await _db.Customers.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.Id == customerId && !c.IsDeleted, cancellationToken);
        if (identity is null) return Result<PortalAppointmentDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        if (identity.IsBlacklisted) return Result<PortalAppointmentDto>.Failure(Error.Conflict("Hesabınızla randevu oluşturulamıyor."));

        var (ok, tenantId) = await AuthorizeBranchAsync(identity, request.BranchId, cancellationToken);
        if (!ok) return Result<PortalAppointmentDto>.Failure(Error.NotFound("Şube bulunamadı."));

        var limit = await _usage.CheckLimitAsync(tenantId, "appointments", cancellationToken);
        if (limit.IsFailure) return Result<PortalAppointmentDto>.Failure(limit.Error);

        var branch = await _db.Branches.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(b => b.Id == request.BranchId, cancellationToken);
        var service = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == request.ServiceDefinitionId && s.IsActive
                                   && (s.BranchId == request.BranchId || s.BranchId == null), cancellationToken);
        if (branch is null || service is null) return Result<PortalAppointmentDto>.Failure(Error.NotFound("Hizmet bulunamadı."));

        if (!await _db.StaffMembers.IgnoreQueryFilters().AsNoTracking().AnyAsync(s => s.TenantId == tenantId && s.Id == request.StaffMemberId && s.BranchId == request.BranchId && s.IsActive, cancellationToken))
            return Result<PortalAppointmentDto>.Failure(Error.NotFound("Uzman bulunamadı."));

        var startUtc = DateTime.SpecifyKind(request.StartUtc, DateTimeKind.Utc);
        if (startUtc <= DateTime.UtcNow) return Result<PortalAppointmentDto>.Failure(Error.Validation("Geçmiş bir saat için randevu alınamaz."));
        var endUtc = startUtc.AddMinutes(service.DurationMinutes);

        var date = DateOnly.FromDateTime(new DateTimeOffset(startUtc, TimeSpan.Zero).ToOffset(TurkeyOffset).DateTime);
        if (await _db.StaffTimeOffs.IgnoreQueryFilters().AsNoTracking().AnyAsync(t => t.TenantId == tenantId && t.StaffMemberId == request.StaffMemberId && t.Date == date, cancellationToken))
            return Result<PortalAppointmentDto>.Failure(Error.Conflict("Seçilen uzman o gün için müsait değil."));

        var concurrent = await _db.Appointments.IgnoreQueryFilters().CountAsync(a => a.TenantId == tenantId && a.StaffMemberId == request.StaffMemberId
            && a.Status != AppointmentStatus.Cancelled && a.Status != AppointmentStatus.NoShow && a.Status != AppointmentStatus.Draft
            && a.StartUtc < endUtc && startUtc < a.EndUtc, cancellationToken);
        if (concurrent >= MaxConcurrentAppointmentsPerStaff)
            return Result<PortalAppointmentDto>.Failure(Error.Conflict("Seçilen saat dolu. Lütfen başka bir saat seçin."));

        // Randevunun bağlanacağı (kurum altındaki) müşteri kaydını çöz/oluştur — kurum izolasyonu için.
        var bookingCustomerId = await ResolveTenantCustomerAsync(identity, tenantId, request.BranchId, cancellationToken);

        // Spam freni: müşterinin bu kurumda aynı anda sınırlı sayıda açık (gelecek tarihli) randevusu olabilir.
        var nowUtc = DateTime.UtcNow;
        var upcoming = await _db.Appointments.IgnoreQueryFilters().CountAsync(a => a.TenantId == tenantId && a.CustomerId == bookingCustomerId
            && a.StartUtc > nowUtc
            && (a.Status == AppointmentStatus.Draft || a.Status == AppointmentStatus.Scheduled || a.Status == AppointmentStatus.Confirmed), cancellationToken);
        if (upcoming >= MaxUpcomingAppointmentsPerCustomer)
            return Result<PortalAppointmentDto>.Failure(Error.Conflict($"Aynı anda en fazla {MaxUpcomingAppointmentsPerCustomer} açık randevunuz olabilir. Yeni randevu için mevcut randevularınızın tamamlanmasını bekleyin."));

        // Gelmeme freni: yakın geçmişte tekrarlanan "gelmedi" kaydı olan müşteriye online kanal kapatılır.
        var noShowSinceUtc = nowUtc.AddDays(-NoShowLookbackDays);
        var noShows = await _db.Appointments.IgnoreQueryFilters().CountAsync(a => a.TenantId == tenantId && a.CustomerId == bookingCustomerId
            && a.Status == AppointmentStatus.NoShow && a.StartUtc >= noShowSinceUtc, cancellationToken);
        if (noShows >= NoShowBlockThreshold)
            return Result<PortalAppointmentDto>.Failure(Error.Conflict("Gelinmeyen randevularınız nedeniyle online randevu geçici olarak kapalı. Lütfen salonla iletişime geçin."));

        // Kategori yetkisi: uzman yalnızca yetkili olduğu kategorideki hizmete online randevu alabilir.
        var skillBlock = await StaffSkill.BlockReasonAsync(_db, tenantId, request.StaffMemberId, request.ServiceDefinitionId, cancellationToken);
        if (skillBlock is not null)
            return Result<PortalAppointmentDto>.Failure(Error.Validation("Seçilen uzman bu hizmeti vermiyor. Lütfen farklı bir uzman seçin."));

        // Çalışma saatleri: uzmanın mesai penceresi dışındaki saat online da seçilemez.
        var hoursBlock = await WorkingHoursGuard.BlockReasonAsync(_db, tenantId, request.StaffMemberId, startUtc, endUtc, cancellationToken);
        if (hoursBlock is not null)
            return Result<PortalAppointmentDto>.Failure(Error.Validation("Seçilen uzman bu saatte çalışmıyor. Lütfen farklı bir saat seçin."));

        var appointment = new Appointment(tenantId, request.BranchId, bookingCustomerId, request.StaffMemberId, request.ServiceDefinitionId,
            startUtc, endUtc, service.Price, request.Notes, isOnline: true);
        // Online randevu doğrudan takvime düşmez: kurum yöneticisi onayına (Draft) gönderilir.
        // Yönetici onay kutusunda (inbox) görür; onaylayınca Scheduled olur. Draft slot bloke etmez.
        appointment.SubmitForApproval();
        _db.Appointments.Add(appointment);
        await _db.SaveChangesAsync(cancellationToken);

        await _audit.LogAsync(tenantId, request.BranchId, "Create", "Appointment", appointment.Id,
            $"Online randevu talebi alındı — yönetici onayı bekliyor ({appointment.StartUtc:dd.MM.yyyy HH:mm})",
            new { appointment.StartUtc, appointment.EndUtc, BookingCustomerId = bookingCustomerId, appointment.StaffMemberId, appointment.Price, IsOnline = true, appointment.Status }, cancellationToken);

        // Kurum/şube yöneticisine "yeni online randevu talebi" bildirimi (onay kutusunda görünecek).
        var bookingName = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.Id == bookingCustomerId).Select(c => c.FullName).FirstOrDefaultAsync(cancellationToken);
        await _notifications.NotifyRolesAsync(
            tenantId, request.BranchId,
            new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
            AppNotificationType.OnlineBookingRequest, AppNotificationSeverity.Info,
            "Yeni online randevu talebi",
            $"{(string.IsNullOrWhiteSpace(bookingName) ? "Müşteri" : bookingName)} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm} — onay bekliyor",
            data: new { route = "/appointments/inbox", id = appointment.Id.ToString() },
            dedupeKey: $"appt-online:{appointment.Id}",
            ct: cancellationToken);

        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        return Result<PortalAppointmentDto>.Success(new PortalAppointmentDto(
            appointment.Id, appointment.BranchId, $"{tenant?.Name} · {branch.Name}", appointment.StaffMemberId, null,
            appointment.ServiceDefinitionId, service.Name, appointment.StartUtc, appointment.EndUtc, appointment.Status, appointment.Price, true));
    }

    /// <summary>
    /// Randevunun bağlanacağı, hedef kurum (tenantId) altındaki müşteri kaydını döndürür.
    /// Müşteri zaten o kurumda (kendi tenant'ı) ise kendisi; pazaryeri müşterisi ise kimliğe (telefon+doğum+ad)
    /// göre o kurumda eşleşen kayıt, yoksa yeni "gölge" müşteri oluşturulur.
    /// </summary>
    private async Task<Guid> ResolveTenantCustomerAsync(Customer identity, Guid tenantId, Guid branchId, CancellationToken ct)
    {
        if (identity.TenantId == tenantId) return identity.Id;

        var key = PhoneMask.LoginKey(identity.Phone);
        var name = NormalizeName(identity.FullName);
        var existing = await _db.Customers.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && !c.IsDeleted && c.BirthDate == identity.BirthDate)
            .ToListAsync(ct);
        var match = existing.FirstOrDefault(c => PhoneMask.LoginKey(c.Phone) == key && NormalizeName(c.FullName) == name);
        if (match is not null) return match.Id;

        var shadow = new Customer(tenantId, branchId, identity.FullName, identity.Phone, identity.Email);
        shadow.UpdateProfile(identity.BirthDate, identity.Gender, kvkkConsent: true, notes: "Online randevu (pazaryeri) ile oluşturuldu.");
        _db.Customers.Add(shadow);
        // SaveChanges çağıran tarafta (randevu ile birlikte) yapılır.
        return shadow.Id;
    }

    public async Task<Result<IReadOnlyCollection<PortalAppointmentDto>>> ListMyAppointmentsAsync(Guid customerId, CancellationToken cancellationToken = default)
    {
        var identity = await LoadCustomerAsync(customerId, cancellationToken);
        if (identity is null) return Result<IReadOnlyCollection<PortalAppointmentDto>>.Failure(Error.NotFound("Müşteri bulunamadı."));
        var individualTenantId = await IndividualTenantIdAsync(cancellationToken);
        var isMarketplace = identity.TenantId == individualTenantId;

        List<Guid> customerIds;
        if (isMarketplace)
        {
            // Pazaryeri: kimliğe (telefon+doğum+ad) uyan tüm kurum-altı müşteri kayıtlarının randevuları.
            var key = PhoneMask.LoginKey(identity.Phone);
            var name = NormalizeName(identity.FullName);
            var sameDob = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .Where(c => !c.IsDeleted && c.BirthDate == identity.BirthDate)
                .Select(c => new { c.Id, c.Phone, c.FullName })
                .ToListAsync(cancellationToken);
            customerIds = sameDob.Where(c => PhoneMask.LoginKey(c.Phone) == key && NormalizeName(c.FullName) == name).Select(c => c.Id).ToList();
        }
        else
        {
            customerIds = new List<Guid> { identity.Id };
        }

        if (customerIds.Count == 0)
            return Result<IReadOnlyCollection<PortalAppointmentDto>>.Success(Array.Empty<PortalAppointmentDto>());

        // Not: MySql.EntityFrameworkCore, IgnoreQueryFilters ile birlikte parametreli Guid koleksiyonunu
        // (`IN @list`) çeviremiyor ("type mapping" hatası). Bu yüzden her müşteri-id'si için ayrı, skaler
        // eşitlik (`= @id`) sorgusu çalıştırıp birleştiriyoruz; ad sözlükleri de LoadNamesAsync ile aynı
        // yöntemle çözülür. customerIds küçük (kullanıcının randevu aldığı kurum sayısı kadar).
        var rows = new List<ApptRow>();
        foreach (var cid in customerIds)
        {
            rows.AddRange(await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.CustomerId == cid)
                .Select(a => new ApptRow(a.Id, a.BranchId, a.StaffMemberId, a.ServiceDefinitionId, a.TenantId, a.StartUtc, a.EndUtc, a.Status, a.Price, a.IsOnline))
                .ToListAsync(cancellationToken));
        }

        if (rows.Count == 0)
            return Result<IReadOnlyCollection<PortalAppointmentDto>>.Success(Array.Empty<PortalAppointmentDto>());

        rows = rows.OrderByDescending(r => r.StartUtc).ToList();

        var branchNames = await LoadNamesAsync(_db.Branches.IgnoreQueryFilters().AsNoTracking(), b => b.Id, b => b.Name, rows.Select(r => r.BranchId), cancellationToken);
        var tenantNames = await LoadNamesAsync(_db.Tenants.IgnoreQueryFilters().AsNoTracking(), t => t.Id, t => t.Name, rows.Select(r => r.TenantId), cancellationToken);
        var staffNames = await LoadNamesAsync(_db.StaffMembers.IgnoreQueryFilters().AsNoTracking(), s => s.Id, s => s.FullName, rows.Select(r => r.StaffMemberId), cancellationToken);
        var svcNames = await LoadNamesAsync(_db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking(), s => s.Id, s => s.Name, rows.Select(r => r.ServiceDefinitionId), cancellationToken);

        var items = rows.Select(r => new PortalAppointmentDto(
            r.Id, r.BranchId,
            string.Join(" · ", new[] { tenantNames.GetValueOrDefault(r.TenantId), branchNames.GetValueOrDefault(r.BranchId) }
                .Where(x => !string.IsNullOrWhiteSpace(x))),
            r.StaffMemberId, staffNames.GetValueOrDefault(r.StaffMemberId),
            r.ServiceDefinitionId, svcNames.GetValueOrDefault(r.ServiceDefinitionId),
            r.StartUtc, r.EndUtc, r.Status, r.Price, r.IsOnline)).ToArray();
        return Result<IReadOnlyCollection<PortalAppointmentDto>>.Success(items);
    }

    private static DateTime ToUtc(DateOnly date, TimeOnly localTime) =>
        new DateTimeOffset(date.ToDateTime(localTime), TurkeyOffset).UtcDateTime;

    private sealed record ApptRow(Guid Id, Guid BranchId, Guid StaffMemberId, Guid ServiceDefinitionId, Guid TenantId,
        DateTime StartUtc, DateTime EndUtc, AppointmentStatus Status, decimal Price, bool IsOnline);

    /// <summary>
    /// Verilen id kümesine ait (Id → ad) sözlüğü döner. MySql.EntityFrameworkCore, IgnoreQueryFilters ile
    /// birlikte parametreli Guid koleksiyonunu (`IN @list`) çeviremediği için her id'yi ayrı, skaler
    /// eşitlik (`= @id`) sorgusuyla çözeriz; bu yol sağlayıcıda sorunsuz çevriliyor. Listeler küçük
    /// (bir müşterinin randevularındaki ayrık kurum/şube/personel/hizmet sayısı kadar).
    /// </summary>
    private static async Task<Dictionary<Guid, string>> LoadNamesAsync<TEntity>(
        IQueryable<TEntity> source,
        Expression<Func<TEntity, Guid>> idSelector,
        Expression<Func<TEntity, string>> nameSelector,
        IEnumerable<Guid> ids,
        CancellationToken ct)
    {
        var result = new Dictionary<Guid, string>();
        foreach (var id in ids.Distinct())
        {
            // x => idSelector(x) == id  (id yakalanan değişken → skaler @id parametresi)
            var predicate = Expression.Lambda<Func<TEntity, bool>>(
                Expression.Equal(idSelector.Body, Expression.Property(Expression.Constant(new { id }), "id")),
                idSelector.Parameters);
            var name = await source.Where(predicate).Select(nameSelector).FirstOrDefaultAsync(ct);
            result[id] = name ?? string.Empty;
        }
        return result;
    }
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class WaitlistService : IWaitlistService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;
    private readonly Application.Features.AppNotifications.IAppNotificationService _notifications;
    private readonly ICurrentUser _currentUser;

    public WaitlistService(GuzellikDbContext db, IAuditLogger audit, IFeatureService features, Application.Features.AppNotifications.IAppNotificationService notifications, ICurrentUser currentUser)
    {
        _db = db;
        _audit = audit;
        _features = features;
        _notifications = notifications;
        _currentUser = currentUser;
    }

    // Personel müşteri telefonunu yalnızca maskeli görür (PhoneMask kuralı).
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    private const string FeatureDeniedMessage = "Bekleme listesi özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz.";

    /// <summary>Bir personel aynı slotta en fazla bu kadar aktif randevu alabilir (AppointmentService ile aynı kural).</summary>
    private const int MaxConcurrentAppointmentsPerStaff = 2;

    public async Task<Result<IReadOnlyCollection<WaitlistEntryDto>>> ListAsync(Guid tenantId, bool? activeOnly, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.AppointmentsWaitlist, cancellationToken))
            return Result<IReadOnlyCollection<WaitlistEntryDto>>.Failure(Error.Conflict(FeatureDeniedMessage));
        var query = _db.WaitlistEntries.AsNoTracking().Where(w => w.TenantId == tenantId);
        if (activeOnly == true)
        {
            query = query.Where(w => w.Status == WaitlistStatus.Waiting || w.Status == WaitlistStatus.Notified);
        }
        var rows = await query
            .OrderBy(w => w.PreferredDate)
            .ThenBy(w => w.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        // Satırlarda ad/telefon göstermek için müşteri bilgisi — istemcinin tüm müşteri
        // listesini çekmesine gerek kalmasın. Bekleme listesi küçük olduğundan id başına
        // tekil sorgu yeterli (Guid listesi .Contains MySQL'de çevrilemiyor).
        var customerInfo = new Dictionary<Guid, (string Name, string? Phone)>();
        foreach (var cid in rows.Select(w => w.CustomerId).Distinct())
        {
            var c = await _db.Customers.AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.Id == cid)
                .Select(x => new { x.FullName, x.Phone })
                .FirstOrDefaultAsync(cancellationToken);
            if (c is not null) customerInfo[cid] = (c.FullName, c.Phone);
        }

        var dtos = rows.Select(w =>
        {
            var info = customerInfo.TryGetValue(w.CustomerId, out var i) ? i : default;
            var phone = IsStaffViewer ? PhoneMask.Mask(info.Phone) : info.Phone;
            return ToDto(w) with { CustomerName = info.Name, CustomerPhone = phone };
        }).ToArray();
        return Result<IReadOnlyCollection<WaitlistEntryDto>>.Success(dtos);
    }

    public async Task<Result<WaitlistEntryDto>> CreateAsync(Guid tenantId, CreateWaitlistRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.AppointmentsWaitlist, cancellationToken))
            return Result<WaitlistEntryDto>.Failure(Error.Conflict(FeatureDeniedMessage));
        try
        {
            var startUtc = request.PreferredStartUtc is { } s
                ? DateTime.SpecifyKind(s, DateTimeKind.Utc)
                : (DateTime?)null;
            var entry = new WaitlistEntry(tenantId, request.BranchId, request.CustomerId,
                request.ServiceDefinitionId, request.StaffMemberId, request.PreferredDate, request.Note,
                startUtc, request.DurationMinutes);
            _db.WaitlistEntries.Add(entry);
            await _db.SaveChangesAsync(cancellationToken);
            await _audit.LogAsync(tenantId, entry.BranchId, "Create", "WaitlistEntry", entry.Id, "Bekleme listesine eklendi", null, cancellationToken);
            return Result<WaitlistEntryDto>.Success(ToDto(entry));
        }
        catch (DomainException ex)
        {
            return Result<WaitlistEntryDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result<WaitlistEntryDto>> SetStatusAsync(Guid tenantId, Guid id, UpdateWaitlistStatusRequest request, CancellationToken cancellationToken = default)
    {
        var entry = await _db.WaitlistEntries.FirstOrDefaultAsync(w => w.TenantId == tenantId && w.Id == id, cancellationToken);
        if (entry is null) return Result<WaitlistEntryDto>.Failure(Error.NotFound("Bekleme kaydı bulunamadı."));
        entry.SetStatus(request.Status);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<WaitlistEntryDto>.Success(ToDto(entry));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var entry = await _db.WaitlistEntries.FirstOrDefaultAsync(w => w.TenantId == tenantId && w.Id == id, cancellationToken);
        if (entry is null) return Result.Failure(Error.NotFound("Bekleme kaydı bulunamadı."));
        entry.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    // ---- Otomatik doldurma akışı (offer → accept/decline) ----
    // Not: Bu metotlar hem admin isteği (query filter aktif) hem anonim WhatsApp webhook'u (filtre yok)
    // bağlamından çağrılır → IgnoreQueryFilters + explicit tenant/branch ile bağlamdan bağımsız çalışır.

    public async Task<Result<Guid?>> SelectAndMarkOfferAsync(Guid tenantId, Guid cancelledAppointmentId, CancellationToken cancellationToken = default)
    {
        // Feature kapalıysa otomasyonu başlatma (iptali bozmadan sessizce atla).
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.AppointmentsWaitlist, cancellationToken))
            return Result<Guid?>.Success(null);

        var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == cancelledAppointmentId && !a.IsDeleted, cancellationToken);
        if (appt is null) return Result<Guid?>.Success(null);

        // DB'den okunan DateTime Kind=Unspecified döner; UTC işaretle (değer zaten UTC instant).
        var slot = new OfferSlot(
            DateTime.SpecifyKind(appt.StartUtc, DateTimeKind.Utc),
            DateTime.SpecifyKind(appt.EndUtc, DateTimeKind.Utc),
            appt.StaffMemberId, appt.ServiceDefinitionId, appt.BranchId);
        var entry = await FindBestWaitingAsync(tenantId, slot, null, cancellationToken);
        if (entry is null) return Result<Guid?>.Success(null);

        entry.MarkOffered(slot.StartUtc, slot.DurationMinutes, slot.StaffMemberId, slot.ServiceDefinitionId, slot.BranchId);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, entry.BranchId, "Offer", "WaitlistEntry", entry.Id,
            $"Boşalan slot teklif edildi ({slot.StartUtc:dd.MM.yyyy HH:mm})", new { cancelledAppointmentId }, cancellationToken);
        return Result<Guid?>.Success(entry.Id);
    }

    public async Task<Result<Guid?>> AcceptOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken cancellationToken = default)
    {
        var entry = await _db.WaitlistEntries.IgnoreQueryFilters()
            .FirstOrDefaultAsync(w => w.TenantId == tenantId && w.Id == waitlistEntryId && !w.IsDeleted, cancellationToken);
        if (entry is null) return Result<Guid?>.Failure(Error.NotFound("Bekleme kaydı bulunamadı."));
        if (entry.Status == WaitlistStatus.Booked) return Result<Guid?>.Success(null); // idempotent
        if (entry.PreferredStartUtc is not { } rawStart || entry.StaffMemberId is not { } staffId || entry.ServiceDefinitionId is not { } serviceId)
            return Result<Guid?>.Failure(Error.Validation("Bu kayıtta randevu açmak için slot bilgisi (saat/personel/hizmet) eksik."));

        // DB'den okunan DateTime Kind=Unspecified döner; Appointment UTC beklediği için işaretle.
        var startUtc = DateTime.SpecifyKind(rawStart, DateTimeKind.Utc);
        var duration = entry.DurationMinutes is > 0 ? entry.DurationMinutes!.Value : 30;
        var endUtc = startUtc.AddMinutes(duration);

        // Kara liste: bu müşteriye randevu verilemez.
        if (await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(c => c.TenantId == tenantId && c.Id == entry.CustomerId && c.IsBlacklisted && !c.IsDeleted, cancellationToken))
            return Result<Guid?>.Failure(Error.Conflict("Müşteri kara listede; randevu oluşturulamaz."));

        // Teklif ile yanıt arasında slot yeniden dolmuş olabilir — overlap'i tekrar kontrol et.
        if (await HasOverlapAsync(tenantId, staffId, startUtc, endUtc, cancellationToken))
            return Result<Guid?>.Failure(Error.SlotFull("Bu slot bu arada yeniden doldu; randevu açılamadı."));

        var branchId = entry.BranchId ?? await ResolveBranchAsync(tenantId, cancellationToken);
        if (branchId is null) return Result<Guid?>.Failure(Error.Validation("Randevu için şube bulunamadı."));

        // Kategori yetkisi: bekleme kaydından açılan randevu da personel yetki kuralına uyar.
        var skillBlock = await StaffSkill.BlockReasonAsync(_db, tenantId, staffId, serviceId, cancellationToken);
        if (skillBlock is not null) return Result<Guid?>.Failure(Error.Validation(skillBlock));

        var appointment = new Appointment(tenantId, branchId.Value, entry.CustomerId, staffId, serviceId,
            startUtc, endUtc, 0m, "Bekleme listesinden aktifleşti");
        _db.Appointments.Add(appointment);
        entry.SetStatus(WaitlistStatus.Booked);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, branchId, "Book", "WaitlistEntry", entry.Id,
            $"Bekleme kaydı randevuya döndü ({startUtc:dd.MM.yyyy HH:mm})", new { appointmentId = appointment.Id }, cancellationToken);

        // Bekleme teklifi kabul edildi → yeni randevu oluştu; kurum/şube yöneticisine bildir.
        var custName = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.Id == entry.CustomerId).Select(c => c.FullName).FirstOrDefaultAsync(cancellationToken);
        await _notifications.NotifyRolesAsync(
            tenantId, branchId,
            new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
            AppNotificationType.WaitlistOffer, AppNotificationSeverity.Success,
            "Bekleme listesinden randevu oluştu",
            $"{(string.IsNullOrWhiteSpace(custName) ? "Müşteri" : custName)} · {startUtc.AddHours(3):dd.MM.yyyy HH:mm}",
            data: new { route = "/appointments", id = appointment.Id.ToString() },
            dedupeKey: $"waitlist-book:{appointment.Id}",
            ct: cancellationToken);

        return Result<Guid?>.Success(appointment.Id);
    }

    public async Task<Result<Guid?>> DeclineOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken cancellationToken = default)
    {
        var entry = await _db.WaitlistEntries.IgnoreQueryFilters()
            .FirstOrDefaultAsync(w => w.TenantId == tenantId && w.Id == waitlistEntryId && !w.IsDeleted, cancellationToken);
        if (entry is null) return Result<Guid?>.Failure(Error.NotFound("Bekleme kaydı bulunamadı."));

        entry.SetStatus(WaitlistStatus.Cancelled);

        // Aynı slot için sıradaki bekleyene teklif götür.
        Guid? nextId = null;
        if (entry.PreferredStartUtc is { } rawStart && entry.StaffMemberId is { } staffId && entry.ServiceDefinitionId is { } serviceId)
        {
            var startUtc = DateTime.SpecifyKind(rawStart, DateTimeKind.Utc); // DB → Unspecified; UTC işaretle
            var duration = entry.DurationMinutes is > 0 ? entry.DurationMinutes!.Value : 30;
            var slot = new OfferSlot(startUtc, startUtc.AddMinutes(duration), staffId, serviceId, entry.BranchId);
            var next = await FindBestWaitingAsync(tenantId, slot, entry.Id, cancellationToken);
            if (next is not null)
            {
                next.MarkOffered(slot.StartUtc, slot.DurationMinutes, slot.StaffMemberId, slot.ServiceDefinitionId, slot.BranchId);
                nextId = next.Id;
            }
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, entry.BranchId, "Decline", "WaitlistEntry", entry.Id,
            nextId is null ? "Teklif reddedildi" : "Teklif reddedildi → sıradakine teklif edildi", null, cancellationToken);
        return Result<Guid?>.Success(nextId);
    }

    // ---- yardımcılar ----

    /// <summary>Slot için sıradaki (FIFO) uygun Waiting kaydı — branch/personel/zaman(veya tarih) eşleşmesiyle bellekte süzülür.</summary>
    private async Task<WaitlistEntry?> FindBestWaitingAsync(Guid tenantId, OfferSlot slot, Guid? excludeId, CancellationToken cancellationToken)
    {
        // Bekleme tablosu doğası gereği küçük — Waiting kayıtları çekip UTC/yerel tarih tuzağına düşmeden bellekte eşleştir.
        var candidates = await _db.WaitlistEntries.IgnoreQueryFilters()
            .Where(w => !w.IsDeleted && w.TenantId == tenantId && w.Status == WaitlistStatus.Waiting)
            .OrderBy(w => w.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var localDate = DateOnly.FromDateTime(slot.StartUtc.AddHours(3)); // Türkiye UTC+3
        var utcDate = DateOnly.FromDateTime(slot.StartUtc);

        return candidates.FirstOrDefault(w =>
        {
            if (excludeId is { } ex && w.Id == ex) return false;
            // Şube: kayıt şubesizse (esnek) ya da slotun şubesiyle aynıysa uyar.
            if (w.BranchId is { } wb && slot.BranchId is { } sb && wb != sb) return false;
            // Personel: kayıt personel belirtmişse slotun personeliyle aynı olmalı.
            if (w.StaffMemberId is { } ws && ws != slot.StaffMemberId) return false;
            // Zaman: saatli kayıt → slotla çakışmalı; saatsiz (eski) kayıt → aynı güne (yerel/UTC) düşmeli.
            if (w.PreferredStartUtc is { } start)
            {
                var end = start.AddMinutes(w.DurationMinutes is > 0 ? w.DurationMinutes!.Value : slot.DurationMinutes);
                return start < slot.EndUtc && slot.StartUtc < end;
            }
            return w.PreferredDate == localDate || w.PreferredDate == utcDate;
        });
    }

    private async Task<bool> HasOverlapAsync(Guid tenantId, Guid staffMemberId, DateTime startUtc, DateTime endUtc, CancellationToken cancellationToken)
    {
        var overlapping = await _db.Appointments.IgnoreQueryFilters().CountAsync(x => !x.IsDeleted && x.TenantId == tenantId && x.StaffMemberId == staffMemberId &&
            x.Status != AppointmentStatus.Cancelled && x.Status != AppointmentStatus.NoShow && x.Status != AppointmentStatus.Draft &&
            x.StartUtc < endUtc && startUtc < x.EndUtc, cancellationToken);
        return overlapping >= MaxConcurrentAppointmentsPerStaff;
    }

    private async Task<Guid?> ResolveBranchAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        return await _db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.TenantId == tenantId && !b.IsDeleted)
            .OrderByDescending(b => b.IsDefault)
            .Select(b => (Guid?)b.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static WaitlistEntryDto ToDto(WaitlistEntry w) => new(
        w.Id, w.TenantId, w.BranchId, w.CustomerId, w.ServiceDefinitionId, w.StaffMemberId,
        w.PreferredDate, w.Status, w.Note, w.CreatedAtUtc, w.PreferredStartUtc, w.DurationMinutes);

    /// <summary>Boşalan somut slot: başlangıç/bitiş (UTC), personel, hizmet, şube.</summary>
    private readonly record struct OfferSlot(DateTime StartUtc, DateTime EndUtc, Guid StaffMemberId, Guid ServiceDefinitionId, Guid? BranchId)
    {
        public int DurationMinutes => Math.Max(5, (int)(EndUtc - StartUtc).TotalMinutes);
    }
}

using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Ratings;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Müşteri memnuniyet yıldızı akışı. Randevu tamamlanınca link üretilir (IssueAsync);
/// müşteri QR ile public sayfaya gelir (GetPublicAsync) ve telefon eşleşmesiyle yıldız gönderir (SubmitAsync).
/// Public okuma/yazma tenant context olmadan çalışır → IgnoreQueryFilters ile token üzerinden erişilir.
/// </summary>
public sealed class RatingService : IRatingService
{
    private readonly GuzellikDbContext _db;

    public RatingService(GuzellikDbContext db) => _db = db;

    public async Task<Result<RatingTokenDto>> IssueAsync(Guid tenantId, Guid appointmentId, int? lifetimeMinutes = null, CancellationToken cancellationToken = default)
    {
        var appt = await _db.Appointments.AsNoTracking()
            .Include(a => a.Customer)
            .Include(a => a.StaffMember)
            .Include(a => a.ServiceDefinition)
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, cancellationToken);
        if (appt is null) return Result<RatingTokenDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        var now = DateTime.UtcNow;

        // Bu randevu zaten puanlanmışsa yeni link üretme.
        var alreadySubmitted = await _db.AppointmentRatings
            .AnyAsync(r => r.TenantId == tenantId && r.AppointmentId == appointmentId && r.Status == RatingStatus.Submitted, cancellationToken);
        if (alreadySubmitted) return Result<RatingTokenDto>.Failure(Error.Conflict("Bu randevu zaten puanlanmış."));

        // Süresi geçmemiş aktif link varsa onu döndür (idempotent — tekrar tıklamada aynı QR).
        var existing = await _db.AppointmentRatings
            .Where(r => r.TenantId == tenantId && r.AppointmentId == appointmentId && r.Status == RatingStatus.Pending && r.ExpiresAtUtc > now)
            .OrderByDescending(r => r.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        if (existing is not null) return Result<RatingTokenDto>.Success(ToTokenDto(existing));

        var businessName = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken);

        var rating = new AppointmentRating(
            tenantId,
            appt.BranchId,
            appt.Id,
            appt.StaffMemberId,
            appt.CustomerId,
            appt.Customer?.Phone ?? string.Empty,
            appt.StaffMember?.FullName ?? "Personel",
            appt.ServiceDefinition?.Name,
            businessName,
            now,
            lifetimeMinutes ?? AppointmentRating.WhatsAppLinkLifetimeMinutes);
        _db.AppointmentRatings.Add(rating);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<RatingTokenDto>.Success(ToTokenDto(rating));
    }

    public async Task<Result<PublicRatingDto>> GetPublicAsync(Guid token, CancellationToken cancellationToken = default)
    {
        var rating = await _db.AppointmentRatings.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.Token == token && !r.IsDeleted, cancellationToken);
        if (rating is null) return Result<PublicRatingDto>.Failure(Error.NotFound("Puanlama bağlantısı bulunamadı."));

        if (rating.IsExpiredAt(DateTime.UtcNow))
        {
            rating.MarkExpired();
            await _db.SaveChangesAsync(cancellationToken);
        }
        return Result<PublicRatingDto>.Success(ToPublicDto(rating));
    }

    public async Task<Result<PublicRatingDto>> SubmitAsync(Guid token, SubmitRatingRequest request, CancellationToken cancellationToken = default)
    {
        var rating = await _db.AppointmentRatings.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.Token == token && !r.IsDeleted, cancellationToken);
        if (rating is null) return Result<PublicRatingDto>.Failure(Error.NotFound("Puanlama bağlantısı bulunamadı."));

        if (rating.Status == RatingStatus.Submitted)
            return Result<PublicRatingDto>.Failure(Error.Conflict("Bu randevu için zaten puan verilmiş."));

        var now = DateTime.UtcNow;
        if (rating.IsExpiredAt(now))
        {
            rating.MarkExpired();
            await _db.SaveChangesAsync(cancellationToken);
            return Result<PublicRatingDto>.Failure(Error.Validation("Puanlama bağlantısının süresi dolmuştur."));
        }

        if (request.Stars is < 1 or > 5)
            return Result<PublicRatingDto>.Failure(Error.Validation("Lütfen 1-5 arasında yıldız verin."));

        if (request.SalonStars is null or < 1 or > 5)
            return Result<PublicRatingDto>.Failure(Error.Validation("Lütfen salonu da 1-5 arasında puanlayın."));

        if (!rating.PhoneMatches(request.Phone))
            return Result<PublicRatingDto>.Failure(Error.Validation("Telefon numarası eşleşmedi. Lütfen randevuda kullandığınız numarayı girin."));

        try
        {
            rating.Submit(request.Stars, request.SalonStars, request.Comment, now);
        }
        catch (Exception ex) when (ex is DomainException or BusinessRuleException)
        {
            return Result<PublicRatingDto>.Failure(Error.Validation(ex.Message));
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result<PublicRatingDto>.Success(ToPublicDto(rating));
    }

    // MySQL'den okunan DateTime Kind=Unspecified döner; 'Z'siz serialize edilmemesi için UTC işaretle.
    private static DateTime AsUtc(DateTime dt) => DateTime.SpecifyKind(dt, DateTimeKind.Utc);

    private static RatingTokenDto ToTokenDto(AppointmentRating r) =>
        new(r.Token, AsUtc(r.ExpiresAtUtc), r.MaskedPhone(), r.StaffName, r.ServiceName, AppointmentRating.LinkLifetimeMinutes);

    private static PublicRatingDto ToPublicDto(AppointmentRating r) =>
        new(r.Status.ToString(), r.StaffName, r.ServiceName, r.BusinessName, r.MaskedPhone(), AsUtc(r.ExpiresAtUtc),
            r.Status == RatingStatus.Submitted ? r.Stars : null,
            r.Status == RatingStatus.Submitted ? r.SalonStars : null);
}

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

    public WaitlistService(GuzellikDbContext db, IAuditLogger audit, IFeatureService features)
    {
        _db = db;
        _audit = audit;
        _features = features;
    }

    private const string FeatureDeniedMessage = "Bekleme listesi özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz.";

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
        return Result<IReadOnlyCollection<WaitlistEntryDto>>.Success(rows.Select(ToDto).ToArray());
    }

    public async Task<Result<WaitlistEntryDto>> CreateAsync(Guid tenantId, CreateWaitlistRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.AppointmentsWaitlist, cancellationToken))
            return Result<WaitlistEntryDto>.Failure(Error.Conflict(FeatureDeniedMessage));
        try
        {
            var entry = new WaitlistEntry(tenantId, request.BranchId, request.CustomerId,
                request.ServiceDefinitionId, request.StaffMemberId, request.PreferredDate, request.Note);
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

    private static WaitlistEntryDto ToDto(WaitlistEntry w) => new(
        w.Id, w.TenantId, w.BranchId, w.CustomerId, w.ServiceDefinitionId, w.StaffMemberId,
        w.PreferredDate, w.Status, w.Note, w.CreatedAtUtc);
}

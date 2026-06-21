using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Campaigns;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CampaignService : ICampaignService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public CampaignService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result<IReadOnlyCollection<CampaignDto>>> ListAsync(Guid tenantId, bool? runningOnly, CancellationToken cancellationToken = default)
    {
        var rows = await _db.Campaigns.AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderByDescending(c => c.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var dtos = rows
            .Select(c => ToDto(c, today))
            .Where(d => runningOnly != true || d.IsRunning)
            .ToArray();
        return Result<IReadOnlyCollection<CampaignDto>>.Success(dtos);
    }

    public async Task<Result<CampaignDto>> CreateAsync(Guid tenantId, UpsertCampaignRequest request, CancellationToken cancellationToken = default)
    {
        try
        {
            var campaign = new Campaign(tenantId, request.BranchId, request.Name, request.DiscountType, request.DiscountValue,
                request.Target, request.TargetId, request.StartDate, request.EndDate);
            if (!request.IsActive) campaign.Deactivate();
            _db.Campaigns.Add(campaign);
            await _db.SaveChangesAsync(cancellationToken);
            await _audit.LogAsync(tenantId, campaign.BranchId, "Create", "Campaign", campaign.Id, $"Kampanya: {campaign.Name}", null, cancellationToken);
            return Result<CampaignDto>.Success(ToDto(campaign, DateOnly.FromDateTime(DateTime.UtcNow)));
        }
        catch (DomainException ex)
        {
            return Result<CampaignDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result<CampaignDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCampaignRequest request, CancellationToken cancellationToken = default)
    {
        var campaign = await _db.Campaigns.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id, cancellationToken);
        if (campaign is null) return Result<CampaignDto>.Failure(Error.NotFound("Kampanya bulunamadı."));
        try
        {
            campaign.Rename(request.Name);
            campaign.SetDiscount(request.DiscountType, request.DiscountValue);
            campaign.SetTarget(request.Target, request.TargetId);
            campaign.SetDates(request.StartDate, request.EndDate);
            if (request.IsActive) campaign.Activate(); else campaign.Deactivate();
            await _db.SaveChangesAsync(cancellationToken);
            return Result<CampaignDto>.Success(ToDto(campaign, DateOnly.FromDateTime(DateTime.UtcNow)));
        }
        catch (DomainException ex)
        {
            return Result<CampaignDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var campaign = await _db.Campaigns.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id, cancellationToken);
        if (campaign is null) return Result.Failure(Error.NotFound("Kampanya bulunamadı."));
        campaign.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private static CampaignDto ToDto(Campaign c, DateOnly today) => new(
        c.Id, c.TenantId, c.BranchId, c.Name, c.DiscountType, c.DiscountValue,
        c.Target, c.TargetId, c.StartDate, c.EndDate, c.IsActive, c.IsRunning(today));
}

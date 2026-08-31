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
    private readonly ITenantContext _tenantContext;
    private readonly ICurrentUser _currentUser;

    public CampaignService(GuzellikDbContext db, IAuditLogger audit, ITenantContext tenantContext, ICurrentUser currentUser)
    {
        _db = db;
        _audit = audit;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
    }

    /// <summary>
    /// KAPSAM SORGUSU (pentest YÜKSEK-2'nin kampanyalardaki kopyası — raporda yoktu, bu turda bulundu).
    /// <c>Campaign.BranchId</c> vardı ama HİÇBİR sorguda uygulanmıyordu: şube yöneticisi kardeş
    /// şubenin kampanyasını listeleyebiliyor, değiştirebiliyor ve silebiliyordu.
    /// Kuralın neden burada olduğu (global query filter yerine):
    /// bkz. GuzellikDbContext.ConfigureServiceDefinition.
    /// </summary>
    private IQueryable<Campaign> InScope(Guid tenantId)
    {
        var branchId = _tenantContext.BranchId;
        return _db.Campaigns
            .Where(c => c.TenantId == tenantId && (branchId == null || c.BranchId == null || c.BranchId == branchId));
    }

    public async Task<Result<IReadOnlyCollection<CampaignDto>>> ListAsync(Guid tenantId, bool? runningOnly, CancellationToken cancellationToken = default)
    {
        var rows = await InScope(tenantId).AsNoTracking()
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
        // Kapsam sorgusu OKUMAYI kapsar, INSERT'i kapsamaz: gövdedeki şube ayrıca doğrulanmalı.
        var (branchId, branchError) = await BranchScopeGuard.ResolveForWriteAsync(
            _db, _tenantContext, _currentUser, tenantId, request.BranchId, cancellationToken);
        if (branchError is not null) return Result<CampaignDto>.Failure(branchError);

        try
        {
            var campaign = new Campaign(tenantId, branchId, request.Name, request.DiscountType, request.DiscountValue,
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
        var campaign = await InScope(tenantId).FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
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
        var campaign = await InScope(tenantId).FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (campaign is null) return Result.Failure(Error.NotFound("Kampanya bulunamadı."));
        campaign.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private static CampaignDto ToDto(Campaign c, DateOnly today) => new(
        c.Id, c.TenantId, c.BranchId, c.Name, c.DiscountType, c.DiscountValue,
        c.Target, c.TargetId, c.StartDate, c.EndDate, c.IsActive, c.IsRunning(today));
}

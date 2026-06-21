using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Campaigns;

public sealed record CampaignDto(
    Guid Id,
    Guid TenantId,
    Guid? BranchId,
    string Name,
    DiscountType DiscountType,
    decimal DiscountValue,
    CampaignTarget Target,
    Guid? TargetId,
    DateOnly StartDate,
    DateOnly EndDate,
    bool IsActive,
    bool IsRunning);

public sealed record UpsertCampaignRequest(
    Guid? BranchId,
    string Name,
    DiscountType DiscountType,
    decimal DiscountValue,
    CampaignTarget Target,
    Guid? TargetId,
    DateOnly StartDate,
    DateOnly EndDate,
    bool IsActive);

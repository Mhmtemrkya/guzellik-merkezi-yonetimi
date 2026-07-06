using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.SubscriptionPlans;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class SubscriptionPlanService : ISubscriptionPlanService
{
    private readonly GuzellikDbContext _db;
    private readonly IFeatureService _features;

    public SubscriptionPlanService(GuzellikDbContext db, IFeatureService features)
    {
        _db = db;
        _features = features;
    }

    public async Task<Result<IReadOnlyList<SubscriptionPlanDto>>> ListAsync(CancellationToken ct = default)
    {
        var plans = await _db.SubscriptionPlans.AsNoTracking()
            .OrderBy(p => p.DisplayOrder).ThenBy(p => p.MonthlyPriceTRY)
            .ToListAsync(ct);
        var planIds = plans.Select(p => p.Id).ToList();
        var counts = await _db.Tenants.AsNoTracking()
            .Where(t => t.SubscriptionPlanId != null)
            .Select(t => new { t.SubscriptionPlanId })
            .ToListAsync(ct);
        var byPlan = counts.Where(c => c.SubscriptionPlanId.HasValue)
            .GroupBy(c => c.SubscriptionPlanId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        var items = plans.Select(p => ToDto(p, byPlan.TryGetValue(p.Id, out var n) ? n : 0)).ToArray();
        return Result<IReadOnlyList<SubscriptionPlanDto>>.Success(items);
    }

    public async Task<Result<SubscriptionPlanDto>> GetAsync(Guid id, CancellationToken ct = default)
    {
        var p = await _db.SubscriptionPlans.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return Result<SubscriptionPlanDto>.Failure(Error.NotFound("Paket bulunamadı."));
        var n = await _db.Tenants.CountAsync(t => t.SubscriptionPlanId == id, ct);
        return Result<SubscriptionPlanDto>.Success(ToDto(p, n));
    }

    public async Task<Result<SubscriptionPlanDto>> GetByKeyAsync(string planKey, CancellationToken ct = default)
    {
        var p = await _db.SubscriptionPlans.FirstOrDefaultAsync(x => x.PlanKey == planKey, ct);
        if (p is null) return Result<SubscriptionPlanDto>.Failure(Error.NotFound("Paket bulunamadı."));
        var n = await _db.Tenants.CountAsync(t => t.SubscriptionPlanId == p.Id, ct);
        return Result<SubscriptionPlanDto>.Success(ToDto(p, n));
    }

    public async Task<Result<SubscriptionPlanDto>> CreateAsync(CreateSubscriptionPlanRequest req, CancellationToken ct = default)
    {
        try
        {
            var existing = await _db.SubscriptionPlans.AnyAsync(x => x.PlanKey == req.PlanKey, ct);
            if (existing) return Result<SubscriptionPlanDto>.Failure(Error.Conflict($"'{req.PlanKey}' anahtarı zaten kullanılıyor."));

            var plan = new SubscriptionPlan(req.PlanKey, req.Name, req.MonthlyPriceTRY,
                req.MaxBranches, req.MaxStaff, req.MaxCustomers, req.MaxMonthlyAppointments, req.MaxMonthlySmsCount,
                req.Features, req.Description, req.DisplayOrder, req.MaxMonthlyWhatsAppCount, req.MaxMonthlyEmailCount,
                req.YearlyPriceTRY);
            _db.SubscriptionPlans.Add(plan);
            await _db.SaveChangesAsync(ct);
            return Result<SubscriptionPlanDto>.Success(ToDto(plan, 0));
        }
        catch (Exception ex)
        {
            return Result<SubscriptionPlanDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result<SubscriptionPlanDto>> UpdateAsync(Guid id, UpdateSubscriptionPlanRequest req, CancellationToken ct = default)
    {
        var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (plan is null) return Result<SubscriptionPlanDto>.Failure(Error.NotFound("Paket bulunamadı."));
        try
        {
            plan.Rename(req.Name);
            plan.SetDescription(req.Description);
            plan.SetPrice(req.MonthlyPriceTRY);
            plan.SetYearlyPrice(req.YearlyPriceTRY);
            plan.SetLimits(req.MaxBranches, req.MaxStaff, req.MaxCustomers, req.MaxMonthlyAppointments, req.MaxMonthlySmsCount);
            plan.SetMessagingLimits(req.MaxMonthlyWhatsAppCount, req.MaxMonthlyEmailCount);
            plan.SetFeatures(req.Features);
            plan.SetDisplayOrder(req.DisplayOrder);
            if (req.IsActive) plan.Activate(); else plan.Deactivate();
            await _db.SaveChangesAsync(ct);
            // Feature listesi/limitler değişmiş olabilir → bu plandaki tüm tenant'ların feature-set önbelleğini boşalt.
            var affectedTenantIds = await _db.Tenants.AsNoTracking()
                .Where(t => t.SubscriptionPlanId == id).Select(t => t.Id).ToListAsync(ct);
            foreach (var tid in affectedTenantIds) _features.InvalidateTenant(tid);
            return Result<SubscriptionPlanDto>.Success(ToDto(plan, affectedTenantIds.Count));
        }
        catch (Exception ex)
        {
            return Result<SubscriptionPlanDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (plan is null) return Result.Failure(Error.NotFound("Paket bulunamadı."));
        var inUse = await _db.Tenants.AnyAsync(t => t.SubscriptionPlanId == id, ct);
        if (inUse) return Result.Failure(Error.Conflict("Bu pakete bağlı kurumlar var; önce başka pakete taşıyın."));
        plan.SoftDelete();
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> AssignToTenantAsync(Guid tenantId, Guid subscriptionPlanId, BillingPeriod period, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null) return Result.Failure(Error.NotFound("Kurum bulunamadı."));
        var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == subscriptionPlanId, ct);
        if (plan is null) return Result.Failure(Error.NotFound("Paket bulunamadı."));
        if (!plan.IsActive) return Result.Failure(Error.Conflict("Pasif pakete atama yapılamaz."));
        // Paket atama = ücretli aboneliği başlat/yenile: dönem (Aylık/Yıllık) ile bitiş tarihi hesaplanır,
        // kurum Aktif olur. Süre dolduğunda trial gibi otomatik Suspended olur.
        tenant.StartSubscription(plan, period, DateTime.UtcNow);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private static SubscriptionPlanDto ToDto(SubscriptionPlan p, int tenantCount) => new(
        p.Id, p.PlanKey, p.Name, p.Description, p.MonthlyPriceTRY, p.YearlyPriceTRY,
        p.MaxBranches, p.MaxStaff, p.MaxCustomers, p.MaxMonthlyAppointments, p.MaxMonthlySmsCount,
        p.MaxMonthlyWhatsAppCount, p.MaxMonthlyEmailCount,
        p.Features, p.DisplayOrder, p.IsActive, tenantCount);
}

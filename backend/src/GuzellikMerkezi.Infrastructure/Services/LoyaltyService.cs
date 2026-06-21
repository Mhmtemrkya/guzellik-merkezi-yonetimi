using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Loyalty;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class LoyaltyService : ILoyaltyService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;

    public LoyaltyService(GuzellikDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result<LoyaltyBalanceDto>> GetBalanceAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var dto = await BuildBalanceAsync(tenantId, customerId, cancellationToken);
        return Result<LoyaltyBalanceDto>.Success(dto);
    }

    public async Task<Result<LoyaltyBalanceDto>> AdjustAsync(Guid tenantId, AdjustLoyaltyRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId, cancellationToken);
        if (customer is null) return Result<LoyaltyBalanceDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        if (request.Points == 0) return Result<LoyaltyBalanceDto>.Failure(Error.Validation("Puan sıfır olamaz."));

        if (request.Points < 0)
        {
            var balance = await BalanceValueAsync(tenantId, request.CustomerId, cancellationToken);
            if (balance + request.Points < 0) return Result<LoyaltyBalanceDto>.Failure(Error.Validation("Yetersiz puan bakiyesi."));
        }

        try
        {
            _db.LoyaltyTransactions.Add(new LoyaltyTransaction(
                tenantId, request.CustomerId, request.Points,
                request.Points > 0 ? "Adjust" : "Redeem", null,
                request.Description ?? (request.Points > 0 ? "Manuel puan" : "Puan kullanımı"), DateTime.UtcNow));
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DomainException ex)
        {
            return Result<LoyaltyBalanceDto>.Failure(Error.Validation(ex.Message));
        }

        await _audit.LogAsync(tenantId, null, "AdjustLoyalty", "LoyaltyTransaction", request.CustomerId,
            $"Puan {(request.Points > 0 ? "+" : "")}{request.Points}", new { request.CustomerId, request.Points }, cancellationToken);

        var dto = await BuildBalanceAsync(tenantId, request.CustomerId, cancellationToken);
        return Result<LoyaltyBalanceDto>.Success(dto);
    }

    private async Task<int> BalanceValueAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        var pts = await _db.LoyaltyTransactions.AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.CustomerId == customerId)
            .Select(t => t.Points)
            .ToListAsync(cancellationToken);
        return pts.Sum();
    }

    private async Task<LoyaltyBalanceDto> BuildBalanceAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        var rows = await _db.LoyaltyTransactions.AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.CustomerId == customerId)
            .OrderByDescending(t => t.OccurredAtUtc)
            .ToListAsync(cancellationToken);

        var history = rows
            .Select(t => new LoyaltyTransactionDto(t.Id, t.CustomerId, t.Points, t.SourceType, t.Description, t.OccurredAtUtc))
            .ToArray();

        return new LoyaltyBalanceDto(
            customerId,
            rows.Sum(t => t.Points),
            rows.Where(t => t.Points > 0).Sum(t => t.Points),
            -rows.Where(t => t.Points < 0).Sum(t => t.Points),
            history);
    }
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class PendingOperationService : IPendingOperationService
{
    private readonly GuzellikDbContext _db;
    private readonly IApprovalDispatcher _dispatcher;
    private readonly IApprovalReplayer _replayer;
    private readonly IAuditLogger _audit;

    public PendingOperationService(GuzellikDbContext db, IApprovalDispatcher dispatcher, IApprovalReplayer replayer, IAuditLogger audit)
    {
        _db = db;
        _dispatcher = dispatcher;
        _replayer = replayer;
        _audit = audit;
    }

    public async Task<Result<PagedResult<PendingOperationDto>>> ListAsync(Guid tenantId, PendingOperationFilter filter, PageRequest pageRequest, CancellationToken cancellationToken = default)
    {
        var query = _db.PendingOperations
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId);

        if (filter.Status.HasValue) query = query.Where(x => x.Status == filter.Status.Value);
        if (filter.RequestedByUserId.HasValue) query = query.Where(x => x.RequestedByUserId == filter.RequestedByUserId.Value);
        if (filter.OperationType.HasValue) query = query.Where(x => x.OperationType == filter.OperationType.Value);

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(x => x.RequestedAtUtc)
            .Skip(pageRequest.Skip)
            .Take(pageRequest.SafePageSize)
            .Select(x => x.ToDto())
            .ToArrayAsync(cancellationToken);
        return Result<PagedResult<PendingOperationDto>>.Success(new PagedResult<PendingOperationDto>(items, total, pageRequest.SafePage, pageRequest.SafePageSize));
    }

    public async Task<Result<PendingOperationDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var op = await _db.PendingOperations.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return op is null ? Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı.")) : Result<PendingOperationDto>.Success(op.ToDto());
    }

    public async Task<Result<PendingOperationDto>> CreateAsync(Guid tenantId, Guid? branchId, Guid requestedByUserId, string requestedByName, CreatePendingOperationRequest request, CancellationToken cancellationToken = default)
    {
        var op = new PendingOperation(
            tenantId,
            branchId,
            requestedByUserId,
            requestedByName,
            request.OperationType,
            request.Title,
            request.Summary,
            request.PayloadJson);
        _db.PendingOperations.Add(op);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, branchId, "Submit", "PendingOperation", op.Id,
            $"Onaya gönderildi: {op.Title} ({op.OperationType})",
            new { op.OperationType, op.Title, op.Summary }, cancellationToken);
        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    public async Task<Result<PendingOperationDto>> ApproveAsync(Guid tenantId, Guid id, Guid decidedByUserId, CancellationToken cancellationToken = default)
    {
        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));
        if (op.Status != PendingOperationStatus.Pending) return Result<PendingOperationDto>.Failure(Error.Conflict("Bu işlem zaten karara bağlanmış."));

        // Asıl operasyonu yürüt — evrensel kapı (HttpReplay) ise isteği replay et, değilse tipli dispatcher.
        var dispatchResult = op.OperationType == PendingOperationType.HttpReplay
            ? await _replayer.ReplayAsync(op.PayloadJson, cancellationToken)
            : await _dispatcher.DispatchAsync(tenantId, op.OperationType, op.PayloadJson, cancellationToken);
        if (dispatchResult.IsFailure)
            return Result<PendingOperationDto>.Failure(dispatchResult.Error);

        op.Approve(decidedByUserId, dispatchResult.Value);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, op.BranchId, "Approve", "PendingOperation", op.Id,
            $"Onaylandı: {op.Title} ({op.OperationType}) · gönderen {op.RequestedByName}",
            new { op.OperationType, op.Title, op.RequestedByName, op.ResultEntityId }, cancellationToken);
        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    public async Task<Result<PendingOperationDto>> RejectAsync(Guid tenantId, Guid id, Guid decidedByUserId, RejectPendingOperationRequest request, CancellationToken cancellationToken = default)
    {
        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result<PendingOperationDto>.Failure(Error.NotFound("İşlem bulunamadı."));
        if (op.Status != PendingOperationStatus.Pending) return Result<PendingOperationDto>.Failure(Error.Conflict("Bu işlem zaten karara bağlanmış."));

        op.Reject(decidedByUserId, request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, op.BranchId, "Reject", "PendingOperation", op.Id,
            $"Reddedildi: {op.Title} · {op.RejectionReason}",
            new { op.OperationType, op.RejectionReason, op.RequestedByName }, cancellationToken);
        return Result<PendingOperationDto>.Success(op.ToDto());
    }

    public async Task<Result> CancelAsync(Guid tenantId, Guid id, Guid decidedByUserId, CancellationToken cancellationToken = default)
    {
        var op = await _db.PendingOperations.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (op is null) return Result.Failure(Error.NotFound("İşlem bulunamadı."));
        if (op.Status != PendingOperationStatus.Pending) return Result.Failure(Error.Conflict("Bu işlem zaten karara bağlanmış."));

        op.Cancel(decidedByUserId);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

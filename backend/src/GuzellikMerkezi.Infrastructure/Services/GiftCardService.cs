using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.GiftCards;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class GiftCardService : IGiftCardService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;

    public GiftCardService(GuzellikDbContext db, IAuditLogger audit, IFeatureService features)
    {
        _db = db;
        _audit = audit;
        _features = features;
    }

    private const string FeatureDeniedMessage = "Hediye çeki & kupon özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz.";

    // Karışmasın diye benzer karakterler (0/O, 1/I) çıkarıldı.
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public async Task<Result<IReadOnlyCollection<GiftCardDto>>> ListAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.MarketingGiftCards, cancellationToken))
            return Result<IReadOnlyCollection<GiftCardDto>>.Failure(Error.Conflict(FeatureDeniedMessage));
        var rows = await _db.GiftCards.AsNoTracking()
            .Where(g => g.TenantId == tenantId)
            .OrderByDescending(g => g.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        var now = DateTime.UtcNow;
        var dtos = rows.Select(g => ToDto(g, now)).ToArray();
        return Result<IReadOnlyCollection<GiftCardDto>>.Success(dtos);
    }

    public async Task<Result<GiftCardDto>> CreateAsync(Guid tenantId, CreateGiftCardRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.MarketingGiftCards, cancellationToken))
            return Result<GiftCardDto>.Failure(Error.Conflict(FeatureDeniedMessage));
        try
        {
            var code = string.IsNullOrWhiteSpace(request.Code)
                ? await GenerateUniqueCodeAsync(tenantId, cancellationToken)
                : request.Code.Trim().ToUpperInvariant();

            var exists = await _db.GiftCards.AsNoTracking().AnyAsync(g => g.TenantId == tenantId && g.Code == code, cancellationToken);
            if (exists) return Result<GiftCardDto>.Failure(Error.Conflict("Bu kod zaten kullanılıyor."));

            var card = new GiftCard(tenantId, request.BranchId, code, request.Kind, request.Value,
                request.ValidUntilUtc, request.MaxUses, request.Note, request.CustomerId);
            _db.GiftCards.Add(card);
            await _db.SaveChangesAsync(cancellationToken);
            await _audit.LogAsync(tenantId, card.BranchId, "Create", "GiftCard", card.Id, $"Hediye çeki/kupon: {card.Code}", null, cancellationToken);
            return Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
        }
        catch (DomainException ex)
        {
            return Result<GiftCardDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result<GiftCardDto>> GetByCodeAsync(Guid tenantId, string code, CancellationToken cancellationToken = default)
    {
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        var card = await _db.GiftCards.AsNoTracking()
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Code == normalized, cancellationToken);
        return card is null
            ? Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."))
            : Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
    }

    public async Task<Result<GiftCardDto>> RedeemAsync(Guid tenantId, Guid id, RedeemGiftCardRequest request, CancellationToken cancellationToken = default)
    {
        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id, cancellationToken);
        if (card is null) return Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."));
        try
        {
            card.Redeem(request.Amount, DateTime.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
            await _audit.LogAsync(tenantId, card.BranchId, "Redeem", "GiftCard", card.Id, $"Kullanım: {card.Code}", null, cancellationToken);
            return Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
        }
        catch (DomainException ex)
        {
            return Result<GiftCardDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result<GiftCardDto>> SetActiveAsync(Guid tenantId, Guid id, SetGiftCardActiveRequest request, CancellationToken cancellationToken = default)
    {
        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id, cancellationToken);
        if (card is null) return Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."));
        card.SetActive(request.Active);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id, cancellationToken);
        if (card is null) return Result.Failure(Error.NotFound("Kod bulunamadı."));
        card.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<string> GenerateUniqueCodeAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 8; attempt++)
        {
            var code = "HD-" + RandomCode(6);
            var exists = await _db.GiftCards.AsNoTracking().AnyAsync(g => g.TenantId == tenantId && g.Code == code, cancellationToken);
            if (!exists) return code;
        }
        // Çok düşük olasılık — zaman damgalı geri dönüş.
        return "HD-" + DateTime.UtcNow.Ticks.ToString().AsSpan(^6).ToString();
    }

    private static string RandomCode(int length)
    {
        Span<char> buffer = stackalloc char[length];
        for (var i = 0; i < length; i++)
        {
            buffer[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
        }
        return new string(buffer);
    }

    private static GiftCardDto ToDto(GiftCard g, DateTime nowUtc) => new(
        g.Id, g.TenantId, g.BranchId, g.Code, g.Kind, g.Value, g.Balance,
        g.ValidUntilUtc, g.MaxUses, g.UsedCount, g.IsActive, g.Note, g.CustomerId, g.IsValid(nowUtc));
}

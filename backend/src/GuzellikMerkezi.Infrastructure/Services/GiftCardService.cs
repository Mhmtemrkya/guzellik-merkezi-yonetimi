using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.GiftCards;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
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
                request.ValidUntilUtc, request.MaxUses, request.Note, request.CustomerId,
                request.ValidFromUtc, request.ScopeLabel, request.RecipientName,
                request.ServiceDefinitionId, request.ServicePackageId);
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

    /// <inheritdoc />
    public async Task<Result<IReadOnlyCollection<GiftCardDto>>> ListForCustomerAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var rows = await _db.GiftCards.AsNoTracking()
            .Where(g => g.TenantId == tenantId && g.CustomerId == customerId && g.IsActive)
            .OrderByDescending(g => g.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        // Geçerlilik SUNUCUDA süzülür: satış ekranına süresi dolmuş çeki "kullanılabilir" diye
        // göndermek, kullanıcıyı uygulanmayacak bir indirime hazırlardı.
        var dtos = rows.Where(g => g.IsValid(now)).Select(g => ToDto(g, now)).ToArray();
        return Result<IReadOnlyCollection<GiftCardDto>>.Success(dtos);
    }

    /// <inheritdoc />
    public async Task<Result<GiftCardDto>> AssignCustomerAsync(Guid tenantId, AssignGiftCardCustomerRequest request, CancellationToken cancellationToken = default)
    {
        var normalized = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (normalized.Length == 0) return Result<GiftCardDto>.Failure(Error.Validation("Kart kodu okunamadı."));

        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Code == normalized, cancellationToken);
        if (card is null) return Result<GiftCardDto>.Failure(Error.NotFound("Bu koda ait kart bulunamadı."));

        // Müşteri gerçekten bu kuruma ait mi? Aksi hâlde uç, başka kurumun müşterisine kart
        // bağlayan bir yol olurdu.
        var customerExists = await _db.Customers.AsNoTracking()
            .AnyAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId && !c.IsDeleted, cancellationToken);
        if (!customerExists) return Result<GiftCardDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        // GEÇERSİZ KART EŞLEŞTİRİLMEZ: süresi dolmuş çeki müşteriye tanımlamak, satış ekranında
        // kullanılamayacak bir hak varmış gibi görünmesine yol açar.
        if (!card.IsValid(DateTime.UtcNow))
            return Result<GiftCardDto>.Failure(Error.Validation("Kart geçerli değil (pasif, süresi dolmuş, hakkı bitmiş veya bakiyesi yok)."));

        try
        {
            card.AssignCustomer(request.CustomerId, request.AllowReassign);
        }
        catch (DomainException ex)
        {
            // "Zaten başka müşteriye tanımlı" — istemci onay alıp AllowReassign ile tekrar dener.
            return Result<GiftCardDto>.Failure(Error.Conflict(ex.Message));
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, card.BranchId, "AssignCustomer", "GiftCard", card.Id,
            $"Hediye çeki müşteriye tanımlandı: {card.Code}", null, cancellationToken);
        return Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
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

    /// <summary>
    /// Hediye çeki/kupon kullanımı — KİLİT ALTINDA.
    ///
    /// <para>
    /// SOMUT AÇIK: <c>gift_cards</c> zaten ortak kilit protokolündeydi ve adisyon onayı/iptali bu
    /// satırı kilitliyordu; ama DOĞRUDAN kullanım ucu (bu metot) protokole hiç katılmıyordu. Kalan
    /// bakiye kontrolü ile düşümü <see cref="GiftCard.Redeem"/> içinde yapılıyor, iki eşzamanlı
    /// istek aynı bakiyeyi okuyup ikisi de geçebiliyordu: 100 ₺'lik çek iki kez 100 ₺ kullanılıp
    /// kasadan 200 ₺'lik indirim çıkabilirdi. Aynı satırın bir yolu korumalı, diğeri açıktı.
    /// </para>
    /// </summary>
    public async Task<Result<GiftCardDto>> RedeemAsync(Guid tenantId, Guid id, RedeemGiftCardRequest request, CancellationToken cancellationToken = default)
    {
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        if (relational) await RowLock.LockRowAsync(_db, "gift_cards", id, cancellationToken);

        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id, cancellationToken);
        if (card is null) return Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."));
        // Kilitten ÖNCE okunmuş olabilir (izleyicide bayat nesne) → kilit altında yeniden oku.
        if (relational)
        {
            await _db.Entry(card).ReloadAsync(cancellationToken);
            if (_db.Entry(card).State == EntityState.Detached)
                return Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."));
        }

        try
        {
            card.Redeem(request.Amount, DateTime.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
            if (tx is not null) await tx.CommitAsync(cancellationToken);
            await _audit.LogAsync(tenantId, card.BranchId, "Redeem", "GiftCard", card.Id, $"Kullanım: {card.Code}", null, cancellationToken);
            return Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
        }
        catch (DomainException ex)
        {
            return Result<GiftCardDto>.Failure(Error.Validation(ex.Message));
        }
    }

    /// <summary>
    /// KİLİT HER İKİ TARAFTA DA ALINIR. Yalnız kullanım (Redeem) kilitlenseydi koruma yarım kalırdı:
    /// aktiflik değişimi aynı satırı kilitsiz yazar ve "son yazan kazanır" ile kullanım sonucunu
    /// ezebilirdi (ör. kullanım bakiyeyi düşürürken pasifleştirme bayat kopyayı geri yazar).
    /// </summary>
    public async Task<Result<GiftCardDto>> SetActiveAsync(Guid tenantId, Guid id, SetGiftCardActiveRequest request, CancellationToken cancellationToken = default)
    {
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational) await RowLock.LockRowAsync(_db, "gift_cards", id, cancellationToken);

        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id, cancellationToken);
        if (card is null) return Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."));
        if (relational)
        {
            await _db.Entry(card).ReloadAsync(cancellationToken);
            if (_db.Entry(card).State == EntityState.Detached)
                return Result<GiftCardDto>.Failure(Error.NotFound("Kod bulunamadı."));
        }

        card.SetActive(request.Active);
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        return Result<GiftCardDto>.Success(ToDto(card, DateTime.UtcNow));
    }

    /// <inheritdoc cref="SetActiveAsync" />
    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational) await RowLock.LockRowAsync(_db, "gift_cards", id, cancellationToken);

        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id, cancellationToken);
        if (card is null) return Result.Failure(Error.NotFound("Kod bulunamadı."));
        if (relational)
        {
            await _db.Entry(card).ReloadAsync(cancellationToken);
            if (_db.Entry(card).State == EntityState.Detached)
                return Result.Failure(Error.NotFound("Kod bulunamadı."));
        }

        // AÇIK FİŞTE KULLANILIYORSA SİLİNEMEZ. Kod, uygulandığı adisyon onaylanmadan silinince
        // indirim kalemi fişte kalıyor ama onayda karşılığı bulunamıyordu: müşteri o kadar az
        // borçlanıyor, çekin bakiyesi/kullanım sayısı ise hiç düşmüyordu (bedava indirim).
        var openUsage = await _db.AdisyonItems.AsNoTracking()
            .AnyAsync(i => i.RefId == id
                        && i.Type == AdisyonItemType.Discount
                        && _db.Adisyonlar.Any(a => a.Id == i.AdisyonId
                                                && a.TenantId == tenantId
                                                && a.Status == AdisyonStatus.Open), cancellationToken);
        if (openUsage)
        {
            return Result.Failure(Error.Conflict(
                "Bu kod henüz onaylanmamış bir adisyonda kullanılıyor; silinemez. Önce ilgili fişten indirim " +
                "kalemini kaldırın ya da fişi onaylayın."));
        }

        card.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
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

    /// <summary>
    /// Anonim doğrulama. Tenant filtresi devre dışıdır (istekte oturum yok), bu yüzden kurum
    /// slug'dan çözülür ve sorgu AÇIKÇA o kuruma bağlanır — filtreyi kapatıp kapsamı da
    /// bırakmak tüm kurumların kodlarını tek havuz yapardı.
    /// </summary>
    public async Task<Result<PublicGiftCardDto>> GetPublicByCodeAsync(string slug, string code, CancellationToken cancellationToken = default)
    {
        var normalizedSlug = (slug ?? string.Empty).Trim().ToLowerInvariant();
        var normalizedCode = (code ?? string.Empty).Trim().ToUpperInvariant();
        if (normalizedSlug.Length == 0 || normalizedCode.Length == 0)
            return Result<PublicGiftCardDto>.Failure(Error.NotFound("Kart bulunamadı."));

        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => !t.IsDeleted && t.Slug == normalizedSlug)
            .Select(t => new { t.Id, t.Name })
            .FirstOrDefaultAsync(cancellationToken);
        if (tenant is null) return Result<PublicGiftCardDto>.Failure(Error.NotFound("Kart bulunamadı."));

        var card = await _db.GiftCards.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(g => !g.IsDeleted && g.TenantId == tenant.Id && g.Code == normalizedCode, cancellationToken);
        if (card is null) return Result<PublicGiftCardDto>.Failure(Error.NotFound("Kart bulunamadı."));

        var now = DateTime.UtcNow;
        var valid = card.IsValid(now);
        // Sebep TEK TEK yazılır: "geçersiz" demek müşteriye hiçbir şey anlatmıyor.
        var reason = valid ? null
            : !card.IsActive ? "Bu kart pasife alınmış."
            : card.ValidFromUtc.HasValue && card.ValidFromUtc.Value > now ? "Bu kartın geçerlilik süresi henüz başlamadı."
            : card.ValidUntilUtc.HasValue && card.ValidUntilUtc.Value < now ? "Bu kartın geçerlilik süresi doldu."
            : card.MaxUses > 0 && card.UsedCount >= card.MaxUses ? "Bu kartın kullanım hakkı doldu."
            : card.Kind == GiftCardKind.StoredValue && card.Balance <= 0m ? "Bu hediye çekinin bakiyesi kalmadı."
            : "Bu kart şu anda kullanılamıyor.";

        return Result<PublicGiftCardDto>.Success(new PublicGiftCardDto(
            card.Code,
            tenant.Name,
            card.Kind,
            card.Kind == GiftCardKind.StoredValue ? card.Balance : card.Value,
            card.ValidFromUtc,
            card.ValidUntilUtc,
            card.ScopeLabel,
            valid,
            reason));
    }

    private static GiftCardDto ToDto(GiftCard g, DateTime nowUtc) => new(
        g.Id, g.TenantId, g.BranchId, g.Code, g.Kind, g.Value, g.Balance,
        g.ValidFromUtc, g.ValidUntilUtc, g.MaxUses, g.UsedCount, g.IsActive, g.Note, g.CustomerId,
        g.ScopeLabel, g.ServiceDefinitionId, g.ServicePackageId, g.RecipientName, g.IsValid(nowUtc));
}

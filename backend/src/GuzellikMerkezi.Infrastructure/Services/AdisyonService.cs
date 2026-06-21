using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Loyalty;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AdisyonService : IAdisyonService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    private readonly ICustomerAccountService _accounts;
    private readonly IFeatureService _features;

    public AdisyonService(GuzellikDbContext db, IAuditLogger audit, ICurrentUser currentUser, ICustomerAccountService accounts, IFeatureService features)
    {
        _db = db;
        _audit = audit;
        _currentUser = currentUser;
        _accounts = accounts;
        _features = features;
    }

    public async Task<Result<PagedResult<AdisyonDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.Adisyonlar
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Include(x => x.Customer)
            .Include(x => x.Items)
            .OrderByDescending(x => x.OpenedAtUtc)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(x => x.Customer != null && x.Customer.FullName.Contains(search));
        }

        var total = await query.CountAsync(cancellationToken);
        var rows = await query.Skip(request.Skip).Take(request.SafePageSize).ToArrayAsync(cancellationToken);
        var staffMap = await BuildStaffMapAsync(tenantId, rows.SelectMany(a => a.Items), cancellationToken);
        var items = rows.Select(a => ToDto(a, staffMap)).ToArray();
        return Result<PagedResult<AdisyonDto>>.Success(new PagedResult<AdisyonDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<AdisyonDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        var staffMap = await BuildStaffMapAsync(tenantId, adisyon.Items, cancellationToken);
        return Result<AdisyonDto>.Success(ToDto(adisyon, staffMap));
    }

    public async Task<Result<AdisyonDto?>> GetOpenForCustomerAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var adisyon = await _db.Adisyonlar
            .Include(x => x.Customer)
            .Include(x => x.Items)
            .Where(x => x.TenantId == tenantId && x.CustomerId == customerId && x.Status == AdisyonStatus.Open)
            .OrderByDescending(x => x.OpenedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        if (adisyon is null) return Result<AdisyonDto?>.Success(null);
        var staffMap = await BuildStaffMapAsync(tenantId, adisyon.Items, cancellationToken);
        return Result<AdisyonDto?>.Success(ToDto(adisyon, staffMap));
    }

    public async Task<Result<AdisyonDto>> CreateAsync(Guid tenantId, CreateAdisyonRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId, cancellationToken);
        if (customer is null) return Result<AdisyonDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        // Bir müşterinin aynı anda tek açık adisyonu olur (restoran adisyonu modeli) —
        // açık fiş varsa yenisini açma, mevcut fişi döndür ki kalemler tek fişte toplansın.
        var existingOpen = await _db.Adisyonlar
            .Where(x => x.TenantId == tenantId && x.CustomerId == request.CustomerId && x.Status == AdisyonStatus.Open)
            .OrderByDescending(x => x.OpenedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        if (existingOpen is not null)
        {
            // Açık fiş varsa yenisini açma; taksit planı geldiyse mevcut fişe uygula (satış akışı).
            if (request.InstallmentCount.HasValue)
            {
                existingOpen.SetInstallmentPlan(request.InstallmentCount, request.FirstDueDate);
                await _db.SaveChangesAsync(cancellationToken);
            }
            return await GetAsync(tenantId, existingOpen.Id, cancellationToken);
        }

        var adisyon = new Adisyon(tenantId, request.BranchId ?? customer.BranchId, customer.Id, request.CustomerAccountId, request.Notes);
        if (request.InstallmentCount.HasValue) adisyon.SetInstallmentPlan(request.InstallmentCount, request.FirstDueDate);
        _db.Adisyonlar.Add(adisyon);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, adisyon.BranchId, "Create", "Adisyon", adisyon.Id, $"Adisyon açıldı: {customer.FullName}", new { adisyon.CustomerId }, cancellationToken);

        return await GetAsync(tenantId, adisyon.Id, cancellationToken);
    }

    public async Task<Result<AdisyonDto>> UpdateAsync(Guid tenantId, Guid id, UpdateAdisyonRequest request, CancellationToken cancellationToken = default)
    {
        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        adisyon.SetCustomerAccount(request.CustomerAccountId);
        adisyon.SetNotes(request.Notes);
        // Taksit planı yalnızca satış modalı gönderdiğinde uygulanır (peşin = 0). Alakasız
        // güncellemeler (ör. not) InstallmentCount göndermez → mevcut plan korunur.
        if (request.InstallmentCount.HasValue) adisyon.SetInstallmentPlan(request.InstallmentCount, request.FirstDueDate);
        await _db.SaveChangesAsync(cancellationToken);
        return await GetAsync(tenantId, id, cancellationToken);
    }

    public async Task<Result<AdisyonDto>> AddItemAsync(Guid tenantId, Guid id, AddAdisyonItemRequest request, CancellationToken cancellationToken = default)
    {
        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        AdisyonItem item;
        try
        {
            item = adisyon.AddItem(request.Type, request.RefId, request.Description, request.Quantity, request.UnitPrice, request.StaffMemberId, request.CoveredByPackage);
        }
        catch (DomainException ex)
        {
            return Result<AdisyonDto>.Failure(Error.Validation(ex.Message));
        }
        // Kalem, parent'ın navigation collection'ı üzerinden eklendi. AdisyonItem PK'si
        // (Guid.CreateVersion7) constructor'da set edildiğinden EF DetectChanges bunu yanlışlıkla
        // mevcut bir kayıt sanıp UPDATE üretir (0 satır → DbUpdateConcurrencyException). DbSet'e
        // açıkça ekleyerek state'i Added'a (INSERT) zorluyoruz.
        _db.AdisyonItems.Add(item);
        await _db.SaveChangesAsync(cancellationToken);
        return await GetAsync(tenantId, id, cancellationToken);
    }

    public async Task<Result<AdisyonDto>> RemoveItemAsync(Guid tenantId, Guid id, Guid itemId, CancellationToken cancellationToken = default)
    {
        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        try
        {
            adisyon.RemoveItem(itemId);
        }
        catch (DomainException ex)
        {
            return Result<AdisyonDto>.Failure(Error.Validation(ex.Message));
        }
        await _db.SaveChangesAsync(cancellationToken);
        return await GetAsync(tenantId, id, cancellationToken);
    }

    public async Task<Result<AdisyonDto>> ApplyGiftCardAsync(Guid tenantId, Guid id, ApplyAdisyonGiftCardRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.MarketingGiftCards, cancellationToken))
            return Result<AdisyonDto>.Failure(Error.Conflict("Hediye çeki & kupon özelliği paketinizde yok."));

        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        if (adisyon.Status != AdisyonStatus.Open) return Result<AdisyonDto>.Failure(Error.Validation("Yalnızca açık adisyona kod uygulanabilir."));

        var code = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length == 0) return Result<AdisyonDto>.Failure(Error.Validation("Kod boş olamaz."));

        var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Code == code, cancellationToken);
        if (card is null) return Result<AdisyonDto>.Failure(Error.NotFound("Kod bulunamadı."));
        if (!card.IsValid(DateTime.UtcNow)) return Result<AdisyonDto>.Failure(Error.Validation("Kod geçerli değil (pasif, süresi dolmuş, hakkı bitmiş veya bakiyesi yok)."));

        // Aynı kod iki kez uygulanamaz.
        if (adisyon.Items.Any(i => i.Type == AdisyonItemType.Discount && i.RefId == card.Id))
            return Result<AdisyonDto>.Failure(Error.Validation("Bu kod adisyona zaten uygulanmış."));

        // İndirim, mevcut net tutar üzerinden hesaplanır (toplam eksiye düşmez).
        var net = adisyon.ChargeTotal;
        if (net <= 0) return Result<AdisyonDto>.Failure(Error.Validation("İndirim uygulanacak tutar yok."));
        var discount = Math.Round(card.DiscountFor(net), 2, MidpointRounding.AwayFromZero);
        if (discount <= 0) return Result<AdisyonDto>.Failure(Error.Validation("Bu kodun uygulanacak indirimi yok."));

        var label = card.Kind == GiftCardKind.StoredValue ? "Hediye çeki" : "Kupon";
        var item = adisyon.AddItem(AdisyonItemType.Discount, card.Id, $"{label}: {card.Code}", 1, discount, null, false);
        _db.AdisyonItems.Add(item);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, adisyon.BranchId, "ApplyGiftCard", "Adisyon", adisyon.Id, $"{label} uygulandı: {card.Code} (−{discount:N2})", null, cancellationToken);
        return await GetAsync(tenantId, id, cancellationToken);
    }

    public async Task<Result<AdisyonDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        if (adisyon.Status != AdisyonStatus.Open) return Result<AdisyonDto>.Failure(Error.Validation("Yalnızca açık adisyon onaylanabilir."));

        var charge = adisyon.ChargeTotal;
        var payment = adisyon.PaymentTotal;
        var nowUtc = DateTime.UtcNow;

        // Ürün satışını onaylamadan önce tüm kalemleri birlikte doğrula. Aynı ürün fişte birden
        // fazla satırda bulunabilir; stok kontrolü toplam miktar üzerinden yapılır.
        var productSaleGroups = adisyon.Items
            .Where(i => i.Type == AdisyonItemType.Product && i.RefId.HasValue)
            .GroupBy(i => i.RefId!.Value)
            .Select(g => new
            {
                ProductId = g.Key,
                Quantity = g.Sum(i => Math.Max(1m, Math.Round(i.Quantity, 3, MidpointRounding.AwayFromZero)))
            })
            .ToList();
        var productIds = productSaleGroups.Select(g => g.ProductId).ToList();
        var productMap = productSaleGroups.Count == 0
            ? new Dictionary<Guid, Product>()
            : await _db.Products
                .Where(p => p.TenantId == tenantId && productIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, cancellationToken);

        foreach (var sale in productSaleGroups)
        {
            if (!productMap.TryGetValue(sale.ProductId, out var product))
                return Result<AdisyonDto>.Failure(Error.NotFound("Satıştaki ürün bulunamadı."));
            if (!product.IsActive)
                return Result<AdisyonDto>.Failure(Error.Validation($"{product.Name} satışa kapalı."));
            if (adisyon.BranchId.HasValue && product.BranchId.HasValue && adisyon.BranchId != product.BranchId)
                return Result<AdisyonDto>.Failure(Error.Validation($"{product.Name} bu müşterinin şubesine ait değil."));
            if (sale.Quantity > product.CurrentStock)
                return Result<AdisyonDto>.Failure(Error.Validation(
                    $"{product.Name} için stok yetersiz. İstenen: {sale.Quantity:N3}, mevcut: {product.CurrentStock:N3} {product.Unit}."));
        }

        // 1) Paket-kullanımı kalemleri: müşterinin paketteki ilgili hizmet seansından düş.
        foreach (var item in adisyon.Items.Where(i => i.Type == AdisyonItemType.PackageUse && i.RefId.HasValue))
        {
            var qty = (int)Math.Max(1, Math.Round(item.Quantity, MidpointRounding.AwayFromZero));
            for (var k = 0; k < qty; k++)
            {
                var session = await _db.CustomerPackageSessions
                    .Where(s => s.TenantId == tenantId && s.CustomerId == adisyon.CustomerId
                             && s.ServiceDefinitionId == item.RefId!.Value && (s.TotalSessions - s.UsedSessions) > 0)
                    .OrderBy(s => s.CreatedAtUtc)
                    .FirstOrDefaultAsync(cancellationToken);
                if (session is null || !session.TryConsume()) break;
            }
        }

        // 1b) Ürün kalemleri: satış olarak stoktan düş + stok hareketi kaydet (3A).
        foreach (var item in adisyon.Items.Where(i => i.Type == AdisyonItemType.Product && i.RefId.HasValue))
        {
            var product = productMap[item.RefId!.Value];
            var qty = Math.Max(1, Math.Round(item.Quantity, 3, MidpointRounding.AwayFromZero));
            product.AdjustStock(StockMovementType.Sale, qty);
            _db.StockMovements.Add(new StockMovement(
                tenantId, product.Id, StockMovementType.Sale, qty, nowUtc,
                unitCost: product.Cost, reference: $"ADS-{adisyon.Id:N}".Substring(0, 16),
                notes: "Adisyon satışı", staffMemberId: item.StaffMemberId));
        }

        // 2) Cari hesabı çöz (charge, tahsilat veya paket satışı varsa gerekli —
        //    paket seans bakiyesi cari hesaba bağlanmak zorunda).
        var packageSaleItems = adisyon.Items
            .Where(i => i.Type == AdisyonItemType.PackageSale && i.RefId.HasValue)
            .ToList();
        // Satılan tekil hizmetler (paketten kullanım değil): her biri için seans bakiyesi açılır.
        var serviceSaleItems = adisyon.Items
            .Where(i => i.Type == AdisyonItemType.Service && i.RefId.HasValue && !i.CoveredByPackage)
            .ToList();
        var productSaleItems = adisyon.Items
            .Where(i => i.Type == AdisyonItemType.Product && i.RefId.HasValue && !i.CoveredByPackage)
            .ToList();
        var namedSaleItems = packageSaleItems
            .Concat(serviceSaleItems)
            .Concat(productSaleItems)
            .ToList();
        // Satış taksitlendirildiyse bu satışa AİT yeni cari aç (mevcut cariyi kullanma) ki taksit
        // planı temiz kurulsun ve her satışın kendi planı olsun. Peşin satışta eski davranış: mevcut
        // aktif cari varsa ona yaz, yoksa tek bir "Adisyon · tarih" carisi aç.
        var hasInstallmentPlan = adisyon.PlannedInstallmentCount > 0 && adisyon.PlannedFirstDueDate.HasValue;
        var newlyCreated = false;
        Guid? accountId = adisyon.CustomerAccountId;
        if ((charge > 0 || payment > 0 || packageSaleItems.Count > 0 || serviceSaleItems.Count > 0) && accountId is null)
        {
            if (hasInstallmentPlan && charge > 0)
            {
                // İsim: tek paket/hizmet/ürün satışıysa onun adı, değilse genel. (ServicePackageId NULL bırakılır —
                // adisyon satışı paketi kalemde tutar; cariye de bağlanırsa rapor paketi çift sayar.)
                var name = namedSaleItems.Count == 1 ? namedSaleItems[0].Description
                    : $"Taksitli satış · {nowUtc:dd.MM.yyyy}";
                var account = new CustomerAccount(tenantId, adisyon.BranchId, adisyon.CustomerId, null,
                    name, Math.Max(0, charge), 0m);
                account.RebuildInstallments(adisyon.PlannedInstallmentCount, adisyon.PlannedFirstDueDate!.Value);
                _db.CustomerAccounts.Add(account);
                accountId = account.Id;
                newlyCreated = true;
            }
            else
            {
                var existing = await _db.CustomerAccounts
                    .Where(a => a.TenantId == tenantId && a.CustomerId == adisyon.CustomerId && a.IsActive)
                    .OrderByDescending(a => a.CreatedAtUtc)
                    .Select(a => new { a.Id })
                    .FirstOrDefaultAsync(cancellationToken);
                if (existing is not null)
                {
                    accountId = existing.Id;
                }
                else
                {
                    var account = new CustomerAccount(tenantId, adisyon.BranchId, adisyon.CustomerId, null,
                        $"Adisyon · {nowUtc:dd.MM.yyyy}", Math.Max(0, charge), 0m);
                    _db.CustomerAccounts.Add(account);
                    accountId = account.Id;
                    newlyCreated = true;
                }
            }
            adisyon.SetCustomerAccount(accountId);
        }

        // 2a) Paket satışı kalemleri: müşteriye hizmet-bazlı seans bakiyesi aç (cari hesaba bağlı).
        //     Salon yazılımı standardı: paket fişte satılır, onay/checkout anında seanslar aktive olur.
        if (packageSaleItems.Count > 0 && accountId is not null)
        {
            foreach (var item in packageSaleItems)
            {
                var package = await _db.ServicePackages
                    .Include(p => p.Items)
                    .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == item.RefId!.Value, cancellationToken);
                if (package is null) continue;
                var qty = (int)Math.Max(1, Math.Round(item.Quantity, MidpointRounding.AwayFromZero));
                foreach (var pkgItem in package.Items)
                {
                    _db.CustomerPackageSessions.Add(new CustomerPackageSession(
                        tenantId, adisyon.CustomerId, accountId.Value, package.Id,
                        pkgItem.ServiceDefinitionId, pkgItem.SessionCount * qty));
                }
            }
        }

        // 2a-2) Tekil hizmet satışı kalemleri: satılan her hizmet için seans bakiyesi açılır (paketsiz).
        //       Böylece müşteri kartındaki "satılan paket/seanslar" listesinde görünür ve randevuda
        //       tüketilebilir. Pakete bağlı olmadığından ServicePackageId = Guid.Empty (FK yok).
        if (serviceSaleItems.Count > 0 && accountId is not null)
        {
            foreach (var item in serviceSaleItems)
            {
                var qty = (int)Math.Max(1, Math.Round(item.Quantity, MidpointRounding.AwayFromZero));
                _db.CustomerPackageSessions.Add(new CustomerPackageSession(
                    tenantId, adisyon.CustomerId, accountId.Value, Guid.Empty,
                    item.RefId!.Value, qty));
            }
        }

        // 2b) Personel primi: personele atanmış charge kalemleri için prim tahakkuk ettir (2B).
        var commissionItems = adisyon.Items
            .Where(i => i.StaffMemberId.HasValue && !i.CoveredByPackage
                     && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.Product || i.Type == AdisyonItemType.Extra || i.Type == AdisyonItemType.PackageSale))
            .ToList();
        if (commissionItems.Count > 0)
        {
            var staffIds = commissionItems.Select(i => i.StaffMemberId!.Value).Distinct().ToList();
            var rates = (await _db.StaffMembers.AsNoTracking()
                    .Where(s => s.TenantId == tenantId)
                    .Select(s => new { s.Id, s.CommissionRate })
                    .ToListAsync(cancellationToken))
                .Where(s => staffIds.Contains(s.Id))
                .ToDictionary(s => s.Id, s => s.CommissionRate ?? 0m);

            foreach (var item in commissionItems)
            {
                var rate = rates.TryGetValue(item.StaffMemberId!.Value, out var r) ? r : 0m;
                if (rate <= 0 || item.LineTotal <= 0) continue;
                _db.StaffCommissions.Add(new StaffCommission(
                    tenantId, adisyon.BranchId, item.StaffMemberId!.Value, adisyon.Id, item.Id,
                    item.Type.ToString(), item.Description, item.LineTotal, rate, nowUtc));
            }
        }

        // 2c) Hediye çeki / kupon: indirim kalemlerine bağlı kodları onayda redeem et (kupon kullanımı +1,
        //      hediye çekinden bakiye düşer). Kod artık geçersizse onay durdurulur (henüz SaveChanges yok).
        foreach (var discountItem in adisyon.Items.Where(i => i.Type == AdisyonItemType.Discount && i.RefId.HasValue))
        {
            var card = await _db.GiftCards.FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == discountItem.RefId!.Value, cancellationToken);
            if (card is null) continue; // elle indirim ya da silinmiş kod → atla
            try
            {
                card.Redeem(discountItem.LineTotal, nowUtc);
            }
            catch (DomainException ex)
            {
                return Result<AdisyonDto>.Failure(Error.Validation($"Kod '{card.Code}' kullanılamadı: {ex.Message} Kaldırıp tekrar deneyin."));
            }
        }

        // 3) Adisyonu onaylı işaretle + seans düşümleri + (yeni) cari kaydı + prim tek SaveChanges.
        adisyon.Approve(_currentUser.UserId);
        await _db.SaveChangesAsync(cancellationToken);

        // 4) Mevcut cariye charge ekle (yeni cari zaten charge ile açıldı).
        if (accountId is not null && charge > 0 && !newlyCreated)
        {
            await _db.CustomerAccounts
                .Where(a => a.Id == accountId.Value)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(a => a.TotalAmount, a => a.TotalAmount + charge)
                    .SetProperty(a => a.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);
        }

        // 5) Tahsilatı cariye + kasaya işle (taksitleri yeniden böler — 1F).
        if (accountId is not null && payment > 0)
        {
            var payResult = await _accounts.RegisterPaymentAsync(tenantId, accountId.Value,
                new RegisterAccountPaymentRequest(payment, "Adisyon", $"ADS-{adisyon.Id:N}".Substring(0, 16), nowUtc), cancellationToken);
            if (payResult.IsFailure) return Result<AdisyonDto>.Failure(payResult.Error);
        }

        // 5b) Sadakat puanı: onaylanan tahsilata göre kazanım (4B).
        if (payment > 0)
        {
            var earned = LoyaltyRules.EarnedFor(payment);
            if (earned > 0)
            {
                _db.LoyaltyTransactions.Add(new LoyaltyTransaction(tenantId, adisyon.CustomerId, earned, "Adisyon", adisyon.Id, "Adisyon tahsilatı", nowUtc));
                await _db.SaveChangesAsync(cancellationToken);
            }
        }

        await _audit.LogAsync(tenantId, adisyon.BranchId, "Approve", "Adisyon", adisyon.Id,
            $"Adisyon onaylandı · borç {charge:N2} · tahsilat {payment:N2}",
            new { charge, payment, accountId }, cancellationToken);

        return await GetAsync(tenantId, id, cancellationToken);
    }

    public async Task<Result<AdisyonDto>> CancelAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var adisyon = await LoadAsync(tenantId, id, cancellationToken);
        if (adisyon is null) return Result<AdisyonDto>.Failure(Error.NotFound("Adisyon bulunamadı."));
        try
        {
            adisyon.Cancel(_currentUser.UserId);
        }
        catch (DomainException ex)
        {
            return Result<AdisyonDto>.Failure(Error.Validation(ex.Message));
        }
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, adisyon.BranchId, "Cancel", "Adisyon", adisyon.Id, "Adisyon iptal edildi", null, cancellationToken);
        return await GetAsync(tenantId, id, cancellationToken);
    }

    private Task<Adisyon?> LoadAsync(Guid tenantId, Guid id, CancellationToken cancellationToken) =>
        _db.Adisyonlar
            .Include(x => x.Customer)
            .Include(x => x.Items)
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);

    private async Task<Dictionary<Guid, string>> BuildStaffMapAsync(Guid tenantId, IEnumerable<AdisyonItem> items, CancellationToken cancellationToken)
    {
        var staffIds = items.Where(i => i.StaffMemberId.HasValue).Select(i => i.StaffMemberId!.Value).Distinct().ToList();
        if (staffIds.Count == 0) return new Dictionary<Guid, string>();
        var rows = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName })
            .ToListAsync(cancellationToken);
        return rows.Where(s => staffIds.Contains(s.Id)).ToDictionary(s => s.Id, s => s.FullName);
    }

    private static AdisyonDto ToDto(Adisyon a, IReadOnlyDictionary<Guid, string> staffMap) => new(
        a.Id,
        a.TenantId,
        a.BranchId,
        a.CustomerId,
        a.Customer?.FullName,
        a.CustomerAccountId,
        a.Status,
        a.OpenedAtUtc,
        a.ApprovedAtUtc,
        a.Notes,
        a.ChargeTotal,
        a.PaymentTotal,
        a.PlannedInstallmentCount,
        a.PlannedFirstDueDate,
        a.Items
            .OrderBy(i => i.CreatedAtUtc)
            .Select(i => new AdisyonItemDto(
                i.Id, i.Type, i.RefId, i.Description, i.Quantity, i.UnitPrice, i.LineTotal,
                i.StaffMemberId,
                i.StaffMemberId.HasValue && staffMap.TryGetValue(i.StaffMemberId.Value, out var sn) ? sn : null,
                i.CoveredByPackage,
                i.CreatedAtUtc))
            .ToArray());
}

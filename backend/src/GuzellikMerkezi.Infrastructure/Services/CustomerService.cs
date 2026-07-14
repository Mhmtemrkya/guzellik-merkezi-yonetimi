using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CustomerService : ICustomerService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IFeatureService _features;

    public CustomerService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit, ICurrentUser currentUser, IFeatureService features)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
        _currentUser = currentUser;
        _features = features;
    }

    // Personel rolü müşteri telefonunu yalnızca son 4 hane görür (müşteri çalmayı önleme).
    // Ham numara API'den hiç çıkmaz; kurum yöneticisi/şube yöneticisi tam görür.
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    private CustomerDto Mask(CustomerDto dto) =>
        IsStaffViewer ? dto with { Phone = MaskPhone(dto.Phone) } : dto;

    private static string MaskPhone(string? phone) => PhoneMask.Mask(phone);

    public async Task<Result<PagedResult<CustomerDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        // Performans: base64 fotoğraf (LONGTEXT) liste sorgusuna DAHİL EDİLMEZ — payload'ı 10-100x küçültür.
        // Fotoğraf yalnızca tekil müşteri (GetAsync) çağrısında döner; liste grid'i baş harf avatarı gösterir.
        var entityQuery = _db.Customers.AsNoTracking().Where(x => x.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // ŞİFRELİ alanlarda (ad/telefon/e-posta) SQL `.Contains()` ÇALIŞMAZ — ciphertext'te arar (kritikbulgular #3).
            // Tenant'ın müşterileri yüklenip BELLEKTE (çözülmüş değerlerde) filtrelenir + alfabetik sıralanır.
            // Müşteri sayısı plan limitiyle sınırlıdır.
            var search = request.Search.Trim();
            var digits = new string(search.Where(char.IsDigit).ToArray());
            var all = await entityQuery
                .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
                .ToArrayAsync(cancellationToken);
            var filtered = all
                .Where(c => c.FullName.Contains(search, StringComparison.OrdinalIgnoreCase)
                            || (digits.Length > 0 && (c.Phone ?? string.Empty).Contains(digits))
                            || (!string.IsNullOrEmpty(c.Email) && c.Email.Contains(search, StringComparison.OrdinalIgnoreCase)))
                .OrderBy(c => c.FullName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var pageItems = filtered.Skip(request.Skip).Take(request.SafePageSize).ToArray();
            if (IsStaffViewer) pageItems = pageItems.Select(Mask).ToArray();
            return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(pageItems, filtered.Length, request.SafePage, request.SafePageSize));
        }

        // Aramasız liste: sıralama ENTITY üzerinde (Select'ten ÖNCE) yapılır. Projekte edilmiş DTO üzerinde
        // OrderBy, EF Core tarafından çevrilemez ve 500 üretir; bu yüzden ORDER BY entity kolonuna uygulanır.
        // FullName şifreli olduğundan sıralama ciphertext'e göredir (alfabetik değil) ama deterministik → sayfalama tutarlı.
        var total = await entityQuery.CountAsync(cancellationToken);
        var items = await entityQuery
            .OrderBy(x => x.FullName)
            .Skip(request.Skip).Take(request.SafePageSize)
            .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer) items = items.Select(Mask).ToArray();
        return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<CustomerDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return customer is null ? Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı.")) : Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<CustomerDialDto>> GetDialPhoneAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDialDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        var digits = PhoneMask.DigitsOnly(customer.Phone);
        if (digits.Length == 0) return Result<CustomerDialDto>.Failure(Error.Validation("Müşterinin kayıtlı telefon numarası yok."));

        // Ham numara personele maskesiz döndüğü için her erişim iz bırakır.
        await _audit.LogAsync(tenantId, customer.BranchId, "PhoneDial", "Customer", customer.Id,
            $"Müşteri arama başlatıldı: {customer.FullName}",
            new { customer.FullName, MaskedPhone = MaskPhone(customer.Phone) }, cancellationToken);

        return Result<CustomerDialDto>.Success(new CustomerDialDto(customer.Id, customer.FullName, digits));
    }

    public async Task<Result<CustomerDto>> CreateAsync(Guid tenantId, UpsertCustomerRequest request, CancellationToken cancellationToken = default)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "customers", cancellationToken);
        if (limit.IsFailure) return Result<CustomerDto>.Failure(limit.Error);

        if (!await _db.Branches.AnyAsync(x => x.TenantId == tenantId && x.Id == request.BranchId, cancellationToken))
        {
            return Result<CustomerDto>.Failure(Error.NotFound("Şube bulunamadı."));
        }

        var customer = new Customer(tenantId, request.BranchId, request.FullName, request.Phone, request.Email);
        customer.UpdateProfile(request.BirthDate, request.Gender, request.KvkkConsent, request.Notes);
        customer.SetPhoto(request.PhotoUrl);

        _db.Customers.Add(customer);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Create", "Customer", customer.Id,
            $"Müşteri oluşturuldu: {customer.FullName}",
            new { customer.FullName, customer.Phone, customer.Email }, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<CustomerDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomerRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        customer.AssignBranch(request.BranchId);
        // Personelin gördüğü maskeli numara (•••…son4) güncelleme isteğinde geri gelirse mevcut
        // gerçek numara korunur — maskeli değer asla kalıcılaştırılmaz. Personel tam yeni bir numara
        // yazarsa (maske yok) normal güncellenir.
        var phone = PhoneMask.IsMasked(request.Phone) ? customer.Phone : request.Phone;
        customer.UpdateContact(request.FullName, phone, request.Email);
        customer.UpdateProfile(request.BirthDate, request.Gender, request.KvkkConsent, request.Notes);
        if (request.PhotoUrl is not null) customer.SetPhoto(request.PhotoUrl);

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Update", "Customer", customer.Id,
            $"Müşteri güncellendi: {customer.FullName}",
            new { customer.FullName, customer.Phone, customer.Email }, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result.Failure(Error.NotFound("Müşteri bulunamadı."));
        var snapshot = new { customer.FullName, customer.Phone };
        customer.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Delete", "Customer", customer.Id,
            $"Müşteri silindi: {customer.FullName}", snapshot, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyCollection<Guid>>> GetCustomerIdsWithApprovedSalesAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        // Paket satışı onaylandığında müşteriye seans bakiyesi tanımlanır.
        var packageCustomers = _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => s.CustomerId);

        // Hizmet/ürün satışı: onaylanmış adisyonda satış kalemi (Service/Product/Extra) olan müşteriler.
        var saleCustomers =
            from a in _db.Adisyonlar.AsNoTracking()
            join i in _db.AdisyonItems.AsNoTracking() on a.Id equals i.AdisyonId
            where a.TenantId == tenantId
                && a.Status == AdisyonStatus.Approved
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.Product || i.Type == AdisyonItemType.Extra)
            select a.CustomerId;

        var ids = await packageCustomers.Union(saleCustomers).Distinct().ToArrayAsync(cancellationToken);
        var blacklisted = await GetBlacklistedIdsAsync(tenantId, cancellationToken);
        return Result<IReadOnlyCollection<Guid>>.Success(ids.Where(id => !blacklisted.Contains(id)).ToArray());
    }

    public async Task<Result<IReadOnlyCollection<Guid>>> GetCustomerIdsWithBookableSessionsAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        // Yalnızca kalan seansı (TotalSessions - UsedSessions > 0) olan müşteriler — yeni randevu modalı için.
        var ids = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && (s.TotalSessions - s.UsedSessions) > 0)
            .Select(s => s.CustomerId)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        // Kara listedeki müşteriler randevu modalında görünmez.
        var blacklisted = await GetBlacklistedIdsAsync(tenantId, cancellationToken);
        return Result<IReadOnlyCollection<Guid>>.Success(ids.Where(id => !blacklisted.Contains(id)).ToArray());
    }

    private async Task<HashSet<Guid>> GetBlacklistedIdsAsync(Guid tenantId, CancellationToken ct)
    {
        var ids = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.IsBlacklisted)
            .Select(c => c.Id)
            .ToListAsync(ct);
        return ids.ToHashSet();
    }

    public async Task<Result<CustomerDto>> SetBlacklistAsync(Guid tenantId, Guid id, SetBlacklistRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.CustomersBlacklist, cancellationToken))
            return Result<CustomerDto>.Failure(Error.Conflict("Kara liste özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        if (request.Blacklisted) customer.Blacklist(request.Reason);
        else customer.RemoveFromBlacklist();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, request.Blacklisted ? "Blacklist" : "Unblacklist", "Customer", customer.Id,
            request.Blacklisted ? $"Kara listeye alındı: {customer.FullName}" : $"Kara listeden çıkarıldı: {customer.FullName}",
            new { request.Reason }, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<CustomerDto>> SetVipAsync(Guid tenantId, Guid id, SetVipRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        customer.SetVip(request.Vip);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, request.Vip ? "SetVip" : "RemoveVip", "Customer", customer.Id,
            request.Vip ? $"VIP etiketi eklendi: {customer.FullName}" : $"VIP etiketi kaldırıldı: {customer.FullName}",
            null, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<PagedResult<CustomerDto>>> GetVipAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        // FullName şifreli olduğundan sıralama deterministik ciphertext sırası — sayfalama tutarlı (bkz. ListAsync notu).
        var query = _db.Customers.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsVip)
            .OrderBy(x => x.FullName);
        var total = await query.CountAsync(cancellationToken);
        var items = await query.Skip(request.Skip).Take(request.SafePageSize)
            .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer) items = items.Select(Mask).ToArray();
        return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<PagedResult<CustomerDto>>> GetBlacklistedAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.Customers.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsBlacklisted)
            .OrderByDescending(x => x.BlacklistedAtUtc);
        var total = await query.CountAsync(cancellationToken);
        var items = await query.Skip(request.Skip).Take(request.SafePageSize)
            .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer) items = items.Select(Mask).ToArray();
        return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<PassiveCustomerListDto>> GetPassiveCustomersAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.CustomersPassive, cancellationToken))
            return Result<PassiveCustomerListDto>.Failure(Error.Conflict("Pasif müşteri listesi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var thresholdDays = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => t.PassiveCustomerThresholdDays).FirstOrDefaultAsync(cancellationToken);
        if (thresholdDays < 1) thresholdDays = 60;
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-thresholdDays);

        // Son aktivite = max(müşteri oluşturulma, son randevu, son paket seansı). Cutoff'tan önceyse pasif.
        // Şube filtresi global query filter ile otomatik uygulanır (kuruma + şubeye özel).
        var query =
            from c in _db.Customers.AsNoTracking()
            where c.TenantId == tenantId && !c.IsBlacklisted
            let lastAppt = _db.Appointments.Where(a => a.TenantId == tenantId && a.CustomerId == c.Id).Max(a => (DateTime?)a.CreatedAtUtc)
            let lastPkg = _db.CustomerPackageSessions.Where(s => s.TenantId == tenantId && s.CustomerId == c.Id).Max(s => (DateTime?)s.CreatedAtUtc)
            select new { c.Id, c.BranchId, c.FullName, c.Phone, c.Email, Created = c.CreatedAtUtc, lastAppt, lastPkg };

        var rows = await query.ToListAsync(cancellationToken);
        var items = rows
            .Select(r =>
            {
                var last = new[] { (DateTime?)r.Created, r.lastAppt, r.lastPkg }.Where(d => d.HasValue).Select(d => d!.Value).Max();
                return new { r.Id, r.BranchId, r.FullName, r.Phone, r.Email, last };
            })
            .Where(r => r.last <= cutoff)
            .OrderBy(r => r.last)
            .Select(r => new PassiveCustomerDto(r.Id, r.BranchId, r.FullName,
                IsStaffViewer ? MaskPhone(r.Phone) : r.Phone, r.Email,
                r.last, (int)Math.Floor((now - r.last).TotalDays)))
            .ToArray();
        return Result<PassiveCustomerListDto>.Success(new PassiveCustomerListDto(thresholdDays, items));
    }

    public async Task<Result<PassiveThresholdDto>> GetPassiveThresholdAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var days = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => t.PassiveCustomerThresholdDays).FirstOrDefaultAsync(cancellationToken);
        return Result<PassiveThresholdDto>.Success(new PassiveThresholdDto(days < 1 ? 60 : days));
    }

    public async Task<Result<PassiveThresholdDto>> SetPassiveThresholdAsync(Guid tenantId, SetPassiveThresholdRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.CustomersPassive, cancellationToken))
            return Result<PassiveThresholdDto>.Failure(Error.Conflict("Pasif müşteri listesi paketinizde yok."));

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<PassiveThresholdDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        tenant.SetPassiveCustomerThreshold(request.Days);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<PassiveThresholdDto>.Success(new PassiveThresholdDto(tenant.PassiveCustomerThresholdDays));
    }
}

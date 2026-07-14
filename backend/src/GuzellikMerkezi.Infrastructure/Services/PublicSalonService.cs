using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Herkese açık salon vitrini. Yalnızca kurum yöneticisinin yayına aldığı (IsPublished),
/// aktif/deneme statüsünde ve planında online randevu bulunan kurumlar listelenir.
/// Anonim erişildiği için tenant filtresi devre dışıdır (IgnoreQueryFilters + slug ile erişim).
/// </summary>
public sealed class PublicSalonService : IPublicSalonService
{
    private const string ListCachePrefix = "public-salons:";
    private static readonly TimeSpan ListCacheTtl = TimeSpan.FromSeconds(60);

    private readonly GuzellikDbContext _db;
    private readonly IMemoryCache _cache;

    public PublicSalonService(GuzellikDbContext db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    /// <summary>Yayında + rezervasyona açık kurumlar (bireysel sistem kurumu hariç).</summary>
    private IQueryable<Tenant> PublishedTenants() =>
        _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => !t.IsDeleted
                        && t.Slug != SystemTenant.IndividualSlug
                        && (t.Status == TenantStatus.Active || t.Status == TenantStatus.Trial)
                        && t.SubscriptionPlan != null
                        && t.SubscriptionPlan.Features != null
                        && t.SubscriptionPlan.Features.Contains(FeatureCatalog.AppointmentsOnlineBooking)
                        && _db.TenantPublicProfiles.Any(p => p.TenantId == t.Id && p.IsPublished && !p.IsDeleted));

    public async Task<Result<PublicSalonListDto>> ListAsync(string? q, string? city, string? category, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize <= 0 ? 12 : pageSize, 1, 24);
        var qNorm = (q ?? string.Empty).Trim();
        var cityNorm = (city ?? string.Empty).Trim();
        var catNorm = (category ?? string.Empty).Trim();

        var cacheKey = $"{ListCachePrefix}{qNorm.ToLowerInvariant()}|{cityNorm.ToLowerInvariant()}|{catNorm.ToLowerInvariant()}|{page}|{pageSize}";
        if (_cache.TryGetValue(cacheKey, out PublicSalonListDto? cached) && cached is not null)
            return Result<PublicSalonListDto>.Success(cached);

        // ÖNEMLİ: Category ve benzeri alanlar ŞİFRELİ saklanır → SQL'de LIKE/Contains ciphertext
        // üzerinde çalışıp asla eşleşmez; ayrıca MySql sürücüsü liste-Contains'i çeviremez.
        // Bu yüzden aday kurumlar + yardımcı veriler az sayıda toplu sorguyla çekilir,
        // filtre/sıralama/sayfalama BELLEKTE yapılır (yayındaki kurum sayısı küçük + 60 sn cache).
        var tenants = await PublishedTenants()
            .Select(t => new { t.Id, t.Slug, t.Name })
            .ToListAsync(cancellationToken);

        var tr = System.Globalization.CultureInfo.GetCultureInfo("tr-TR");
        if (qNorm.Length > 0)
            tenants = tenants.Where(t => t.Name.ToLower(tr).Contains(qNorm.ToLower(tr))).ToList();

        // Profiller (şehir, featured, logo) — tek sorgu.
        var profiles = await _db.TenantPublicProfiles.AsNoTracking()
            .Where(p => p.IsPublished)
            .Select(p => new { p.TenantId, p.City, p.IsFeatured, p.LogoData })
            .ToListAsync(cancellationToken);
        var profileByTenant = profiles
            .GroupBy(p => p.TenantId)
            .ToDictionary(g => g.Key, g => g.First());

        if (cityNorm.Length > 0)
        {
            tenants = tenants.Where(t =>
                profileByTenant.TryGetValue(t.Id, out var pr)
                && !string.IsNullOrWhiteSpace(pr.City)
                && pr.City!.ToLower(tr).Contains(cityNorm.ToLower(tr))).ToList();
        }

        // Hizmet kategorileri — tek sorgu, deşifre bellekte olur (converter materialize'da çalışır).
        var serviceRows = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking()
            .Where(sd => !sd.IsDeleted && sd.IsActive && sd.Category != null && sd.Category != "")
            .Select(sd => new { sd.TenantId, sd.Category })
            .ToListAsync(cancellationToken);
        var categoriesByTenant = serviceRows
            .GroupBy(r => r.TenantId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => x.Category!.Trim())
                      .Where(c => c.Length > 0)
                      .Distinct(StringComparer.Create(tr, ignoreCase: true))
                      .OrderBy(c => c, StringComparer.Create(tr, ignoreCase: true))
                      .ToArray());

        if (catNorm.Length > 0)
        {
            var needle = catNorm.ToLower(tr);
            tenants = tenants.Where(t =>
                categoriesByTenant.TryGetValue(t.Id, out var cats)
                && cats.Any(c => c.ToLower(tr).Contains(needle))).ToList();
        }

        // Yıldız agregaları — tek sorgu (Submitted satırları, bellekte toplanır).
        var ratingRows = await _db.AppointmentRatings.IgnoreQueryFilters().AsNoTracking()
            .Where(r => !r.IsDeleted && r.Status == RatingStatus.Submitted)
            .Select(r => new { r.TenantId, r.Stars, r.SalonStars })
            .ToListAsync(cancellationToken);
        var ratingsByTenant = ratingRows
            .GroupBy(r => r.TenantId)
            .ToDictionary(g => g.Key, g =>
            {
                var salonVals = g.Where(x => x.SalonStars != null).Select(x => (double)x.SalonStars!.Value).ToArray();
                return new
                {
                    Count = g.Count(),
                    StaffAvg = (double?)g.Average(x => (double)x.Stars),
                    SalonAvg = salonVals.Length > 0 ? (double?)salonVals.Average() : null,
                };
            });

        // Sıralama: Premium üstte → yorum sayısı → ad.
        var ordered = tenants
            .OrderByDescending(t => profileByTenant.TryGetValue(t.Id, out var pr) && pr.IsFeatured)
            .ThenByDescending(t => ratingsByTenant.TryGetValue(t.Id, out var ra) ? ra.Count : 0)
            .ThenBy(t => t.Name, StringComparer.Create(tr, ignoreCase: true))
            .ToList();

        var total = ordered.Count;
        var pageTenants = ordered.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        // Yalnızca sayfadaki kurumlar için ağır alan (kapak fotoğrafı) çekilir.
        var items = new List<PublicSalonListItemDto>(pageTenants.Count);
        foreach (var t in pageTenants)
        {
            var cover = await _db.TenantGalleryPhotos.AsNoTracking()
                .Where(g => g.TenantId == t.Id && g.Kind == GalleryPhotoKind.Slider)
                .OrderBy(g => g.SortOrder).ThenBy(g => g.CreatedAtUtc)
                .Select(g => g.ImageData)
                .FirstOrDefaultAsync(cancellationToken);
            profileByTenant.TryGetValue(t.Id, out var profile);
            ratingsByTenant.TryGetValue(t.Id, out var rating);
            categoriesByTenant.TryGetValue(t.Id, out var cats);
            items.Add(new PublicSalonListItemDto(
                t.Slug,
                t.Name,
                profile?.City,
                cover,
                profile?.LogoData,
                rating?.SalonAvg,
                rating?.StaffAvg,
                rating?.Count ?? 0,
                cats?.Take(3).ToArray() ?? Array.Empty<string>(),
                profile?.IsFeatured ?? false));
        }

        var dto = new PublicSalonListDto(items, total, page, pageSize);
        _cache.Set(cacheKey, dto, ListCacheTtl);
        return Result<PublicSalonListDto>.Success(dto);
    }

    public async Task<Result<PublicSalonDetailDto>> GetBySlugAsync(string slug, CancellationToken cancellationToken = default)
    {
        var tenant = await PublishedTenants().FirstOrDefaultAsync(t => t.Slug == slug, cancellationToken);
        if (tenant is null) return Result<PublicSalonDetailDto>.Failure(Error.NotFound("Salon bulunamadı."));

        var profile = await _db.TenantPublicProfiles.AsNoTracking()
            .FirstOrDefaultAsync(p => p.TenantId == tenant.Id, cancellationToken);

        var photos = await _db.TenantGalleryPhotos.AsNoTracking()
            .Where(g => g.TenantId == tenant.Id)
            .OrderBy(g => g.SortOrder).ThenBy(g => g.CreatedAtUtc)
            .Select(g => new { g.Kind, g.ImageData })
            .ToListAsync(cancellationToken);

        // Hizmetler: aktif olanlar kategoriye göre gruplanır (fiyat/süre public görünür).
        var services = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking()
            .Where(s => s.TenantId == tenant.Id && !s.IsDeleted && s.IsActive && s.Status == CatalogStatus.Active)
            .OrderBy(s => s.Category).ThenBy(s => s.Name)
            .Select(s => new { s.Id, s.Name, s.Category, s.DurationMinutes, s.Price, s.BranchId })
            .ToListAsync(cancellationToken);
        var serviceGroups = services
            .GroupBy(s => string.IsNullOrWhiteSpace(s.Category) ? "Diğer Hizmetler" : s.Category!)
            .Select(g => new PublicSalonServiceGroupDto(g.Key, g.Select(s => new PublicSalonServiceDto(s.Id, s.Name, s.DurationMinutes, s.Price, s.BranchId)).ToArray()))
            .ToArray();

        // Çalışanlar + kişi bazlı yıldız ortalaması.
        var staff = await _db.StaffMembers.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == tenant.Id && !m.IsDeleted && m.IsActive)
            .OrderBy(m => m.FullName)
            .Select(m => new PublicSalonStaffDto(
                m.Id, m.FullName, m.Title, m.PhotoUrl,
                _db.AppointmentRatings
                    .Where(r => r.StaffMemberId == m.Id && !r.IsDeleted && r.Status == RatingStatus.Submitted)
                    .Average(r => (double?)r.Stars),
                _db.AppointmentRatings
                    .Count(r => r.StaffMemberId == m.Id && !r.IsDeleted && r.Status == RatingStatus.Submitted),
                m.BranchId))
            .ToArrayAsync(cancellationToken);

        var aggregates = await AggregatesAsync(tenant.Id, null, cancellationToken);

        var branches = await _db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.TenantId == tenant.Id && !b.IsDeleted)
            .OrderByDescending(b => b.IsDefault).ThenBy(b => b.Name)
            .Select(b => new PublicSalonBranchDto(b.Id, b.Name, b.City))
            .ToArrayAsync(cancellationToken);

        return Result<PublicSalonDetailDto>.Success(new PublicSalonDetailDto(
            tenant.Slug,
            tenant.Name,
            profile?.LogoData,
            profile?.IsFeatured ?? false,
            profile?.Description,
            profile?.Address,
            profile?.City,
            profile?.Instagram,
            profile?.PublicEmail,
            profile?.PublicPhone ?? tenant.Phone,
            profile?.WorkingHoursText,
            profile?.MapUrl,
            photos.Where(p => p.Kind == GalleryPhotoKind.Slider).Select(p => p.ImageData).ToArray(),
            photos.Where(p => p.Kind == GalleryPhotoKind.Service).Select(p => p.ImageData).ToArray(),
            serviceGroups,
            staff,
            aggregates,
            branches));
    }

    public async Task<Result<PublicSalonFacetsDto>> GetFacetsAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = ListCachePrefix + "facets";
        if (_cache.TryGetValue(cacheKey, out PublicSalonFacetsDto? cached) && cached is not null)
            return Result<PublicSalonFacetsDto>.Success(cached);

        // Yayındaki kurumlar (liste küçük) — MySql sürücüsü liste-Contains çeviremediği için tenant başına sorgu.
        var tenantIds = await PublishedTenants().Select(t => t.Id).ToListAsync(cancellationToken);
        var categories = new SortedSet<string>(StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("tr-TR"), ignoreCase: true));
        var cities = new SortedSet<string>(StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("tr-TR"), ignoreCase: true));
        foreach (var tid in tenantIds)
        {
            var cats = await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking()
                .Where(sd => sd.TenantId == tid && !sd.IsDeleted && sd.IsActive && sd.Category != null && sd.Category != "")
                .Select(sd => sd.Category!)
                .Distinct()
                .ToArrayAsync(cancellationToken);
            foreach (var c in cats) categories.Add(c.Trim());

            var city = await _db.TenantPublicProfiles.AsNoTracking()
                .Where(p => p.TenantId == tid && p.City != null && p.City != "")
                .Select(p => p.City!)
                .FirstOrDefaultAsync(cancellationToken);
            if (!string.IsNullOrWhiteSpace(city)) cities.Add(city.Trim());
        }

        var dto = new PublicSalonFacetsDto(categories.ToArray(), cities.ToArray());
        _cache.Set(cacheKey, dto, ListCacheTtl);
        return Result<PublicSalonFacetsDto>.Success(dto);
    }

    public async Task<Result<PublicSalonReviewListDto>> GetReviewsAsync(string slug, Guid? branchId, int page, int pageSize, CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize <= 0 ? 10 : pageSize, 1, 50);

        var tenantId = await PublishedTenants().Where(t => t.Slug == slug).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(cancellationToken);
        if (tenantId is null) return Result<PublicSalonReviewListDto>.Failure(Error.NotFound("Salon bulunamadı."));

        var baseQuery = _db.AppointmentRatings.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.TenantId == tenantId && !r.IsDeleted && r.Status == RatingStatus.Submitted);
        // Şube bazlı yorumlar: yalnızca seçilen şubede alınan hizmetlerin değerlendirmeleri.
        if (branchId is { } bid) baseQuery = baseQuery.Where(r => r.BranchId == bid);

        var total = await baseQuery.CountAsync(cancellationToken);
        var rows = await baseQuery
            .OrderByDescending(r => r.SubmittedAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => new
            {
                r.SubmittedAtUtc,
                r.Comment,
                r.Stars,
                r.SalonStars,
                r.StaffName,
                r.ServiceName,
                r.BranchId,
                CustomerName = _db.Customers
                    .Where(c => c.Id == r.CustomerId)
                    .Select(c => c.FullName).FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);

        // Şube adları (yorum kartındaki şube rozeti için).
        var branchNames = (await _db.Branches.IgnoreQueryFilters().AsNoTracking()
            .Where(b => b.TenantId == tenantId && !b.IsDeleted)
            .Select(b => new { b.Id, b.Name })
            .ToListAsync(cancellationToken))
            .ToDictionary(b => b.Id, b => b.Name);

        var items = rows.Select(r => new PublicSalonReviewDto(
            NameMask.Mask(r.CustomerName),
            DateTime.SpecifyKind(r.SubmittedAtUtc ?? DateTime.UtcNow, DateTimeKind.Utc),
            r.Comment,
            r.Stars,
            r.SalonStars,
            r.StaffName,
            r.ServiceName,
            branchNames.TryGetValue(r.BranchId, out var bn) ? bn : null)).ToArray();

        // Seçili şubeye (yoksa tüm kuruma) göre ortalama + yıldız dağılımı.
        var aggregates = await AggregatesAsync(tenantId.Value, branchId, cancellationToken);

        return Result<PublicSalonReviewListDto>.Success(new PublicSalonReviewListDto(items, total, page, pageSize, aggregates));
    }

    public async Task<Result<PublicSalonReviewDto>> SubmitReviewAsync(Guid customerId, string slug, SubmitSalonReviewRequest request, CancellationToken cancellationToken = default)
    {
        if (request.StaffStars is < 1 or > 5 || request.SalonStars is < 1 or > 5)
            return Result<PublicSalonReviewDto>.Failure(Error.Validation("Yıldızlar 1-5 aralığında olmalı."));

        var tenant = await PublishedTenants().FirstOrDefaultAsync(t => t.Slug == slug, cancellationToken);
        if (tenant is null) return Result<PublicSalonReviewDto>.Failure(Error.NotFound("Salon bulunamadı."));

        var identity = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == customerId && !c.IsDeleted, cancellationToken);
        if (identity is null) return Result<PublicSalonReviewDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        // Bu kurumdaki müşteri kayıtları: doğrudan kayıt veya pazaryeri gölge kaydı (telefon+doğum+ad eşleşmesi).
        var tenantCustomerIds = await ResolveTenantCustomerIdsAsync(identity, tenant.Id, cancellationToken);
        if (tenantCustomerIds.Count == 0)
            return Result<PublicSalonReviewDto>.Failure(Error.Unauthorized("Yorum yapabilmek için bu salonda tamamlanmış bir randevunuz olmalı."));

        // Tamamlanmış ve henüz puanlanmamış en son randevu bulunur.
        // MySQL Guid-listesi Contains sunucuda çevrilemediği için müşteri-id başına ayrı sorgu (liste küçük).
        Appointment? target = null;
        foreach (var cid in tenantCustomerIds)
        {
            var candidate = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Include(a => a.Customer)
                .Include(a => a.StaffMember)
                .Include(a => a.ServiceDefinition)
                .Where(a => a.TenantId == tenant.Id && !a.IsDeleted && a.CustomerId == cid
                            && a.Status == AppointmentStatus.Completed
                            && !_db.AppointmentRatings.Any(r =>
                                r.AppointmentId == a.Id && !r.IsDeleted && r.Status == RatingStatus.Submitted))
                .OrderByDescending(a => a.StartUtc)
                .FirstOrDefaultAsync(cancellationToken);
            if (candidate is not null && (target is null || candidate.StartUtc > target.StartUtc)) target = candidate;
        }

        if (target is null)
        {
            var hadCompleted = false;
            foreach (var cid in tenantCustomerIds)
            {
                hadCompleted = await _db.Appointments.IgnoreQueryFilters()
                    .AnyAsync(a => a.TenantId == tenant.Id && !a.IsDeleted && a.CustomerId == cid && a.Status == AppointmentStatus.Completed, cancellationToken);
                if (hadCompleted) break;
            }
            return hadCompleted
                ? Result<PublicSalonReviewDto>.Failure(Error.Conflict("Tamamlanan randevularınız için değerlendirmeniz zaten alınmış. Teşekkürler!"))
                : Result<PublicSalonReviewDto>.Failure(Error.Unauthorized("Yorum yapabilmek için bu salonda tamamlanmış bir randevunuz olmalı."));
        }

        // Varsa bekleyen (Pending) link kaydı yeniden kullanılır; yoksa yeni kayıt açılır — token akışı atlanıp doğrudan Submitted yazılır.
        var now = DateTime.UtcNow;
        var rating = await _db.AppointmentRatings.IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.AppointmentId == target.Id && !r.IsDeleted && r.Status == RatingStatus.Pending, cancellationToken);
        if (rating is not null && rating.IsExpiredAt(now))
        {
            rating.MarkExpired();
            rating = null;
        }
        if (rating is null)
        {
            rating = new AppointmentRating(
                tenant.Id, target.BranchId, target.Id, target.StaffMemberId, target.CustomerId,
                target.Customer?.Phone ?? identity.Phone,
                target.StaffMember?.FullName ?? "Personel",
                target.ServiceDefinition?.Name,
                tenant.Name,
                now,
                lifetimeMinutes: 5);
            _db.AppointmentRatings.Add(rating);
        }

        rating.Submit(request.StaffStars, request.SalonStars, request.Comment, now);
        await _db.SaveChangesAsync(cancellationToken);

        return Result<PublicSalonReviewDto>.Success(new PublicSalonReviewDto(
            NameMask.Mask(identity.FullName),
            now,
            rating.Comment,
            rating.Stars,
            rating.SalonStars,
            rating.StaffName,
            rating.ServiceName));
    }

    private async Task<PublicSalonAggregatesDto> AggregatesAsync(Guid tenantId, Guid? branchId, CancellationToken ct)
    {
        var baseQuery = _db.AppointmentRatings.IgnoreQueryFilters().AsNoTracking()
            .Where(r => r.TenantId == tenantId && !r.IsDeleted && r.Status == RatingStatus.Submitted);
        if (branchId is { } bid) baseQuery = baseQuery.Where(r => r.BranchId == bid);
        var salonAvg = await baseQuery.Where(r => r.SalonStars != null).AverageAsync(r => (double?)r.SalonStars, ct);
        var staffAvg = await baseQuery.AverageAsync(r => (double?)r.Stars, ct);
        var count = await baseQuery.CountAsync(ct);
        // Yıldız dağılımı (1..5): salon yıldızı esas, eski kayıtlar personel yıldızına düşer.
        var starRows = await baseQuery.Select(r => new { r.SalonStars, r.Stars }).ToListAsync(ct);
        var starCounts = new int[5];
        foreach (var row in starRows)
        {
            var v = row.SalonStars ?? row.Stars;
            if (v is >= 1 and <= 5) starCounts[v - 1]++;
        }
        return new PublicSalonAggregatesDto(salonAvg, staffAvg, count, starCounts);
    }

    private async Task<List<Guid>> ResolveTenantCustomerIdsAsync(Customer identity, Guid tenantId, CancellationToken ct)
    {
        if (identity.TenantId == tenantId) return [identity.Id];

        // Pazaryeri kimliği: aynı doğum tarihli adaylar çekilip telefon+ad bellek içinde eşleştirilir
        // (telefon/ad şifreli — sunucuda sorgulanamaz; CustomerPortalService ile aynı desen).
        var key = PhoneMask.LoginKey(identity.Phone);
        var name = NormalizeName(identity.FullName);
        var candidates = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.TenantId == tenantId && !c.IsDeleted && c.BirthDate == identity.BirthDate)
            .Select(c => new { c.Id, c.Phone, c.FullName })
            .ToListAsync(ct);
        return candidates
            .Where(c => PhoneMask.LoginKey(c.Phone) == key && NormalizeName(c.FullName) == name)
            .Select(c => c.Id)
            .ToList();
    }

    private static string NormalizeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return string.Empty;
        return string.Join(' ', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
    }
}

/// <summary>
/// Müşteri adını public yorumlar için maskeler: her kelimenin ilk harfi açık, kalanı yıldız
/// ("Ayşe Yılmaz" → "A*** Y*****"). <see cref="PhoneMask"/> ile aynı yaklaşımın isim karşılığı.
/// </summary>
public static class NameMask
{
    public static string Mask(string? fullName)
    {
        if (string.IsNullOrWhiteSpace(fullName)) return "Misafir";
        var parts = fullName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', parts.Select(p =>
            p.Length <= 1 ? $"{p}*" : $"{p[0]}{new string('*', Math.Min(p.Length - 1, 8))}"));
    }
}

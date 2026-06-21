using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class TenantService : ITenantService
{
    private const string DefaultTenantDomainSuffix = "armonessa.app";
    private static readonly Regex MultiDashRegex = new("-+", RegexOptions.Compiled);
    private static readonly Regex MultiDotRegex = new("\\.+", RegexOptions.Compiled);

    private readonly GuzellikDbContext _db;
    private readonly IPasswordHasher _passwordHasher;

    public TenantService(GuzellikDbContext db, IPasswordHasher passwordHasher)
    {
        _db = db;
        _passwordHasher = passwordHasher;
    }

    public async Task<Result<PagedResult<TenantDto>>> ListAsync(PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.Tenants.AsNoTracking().Include(x => x.Branches).Include(x => x.SubscriptionPlan).Where(x => x.Status != TenantStatus.Cancelled).OrderBy(x => x.Name).AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(x => x.Name.Contains(search) || x.Slug.Contains(search));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query.Skip(request.Skip).Take(request.SafePageSize).Select(x => x.ToDto()).ToArrayAsync(cancellationToken);
        return Result<PagedResult<TenantDto>>.Success(new PagedResult<TenantDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<TenantAvailabilityDto>> CheckAvailabilityAsync(string? name, string? slug, string? domain, string? ownerName, string? ownerEmail, CancellationToken cancellationToken = default)
    {
        var normalizedName = NormalizeText(name);
        var suggestedName = await SuggestNameAsync(normalizedName, cancellationToken);
        var requestedSlug = NormalizeSlugCandidate(string.IsNullOrWhiteSpace(slug) ? normalizedName : slug);
        var suggestedSlug = await SuggestSlugAsync(requestedSlug, cancellationToken);
        var requestedDomain = NormalizeDomain(string.IsNullOrWhiteSpace(domain) ? BuildDomain(suggestedSlug) : domain);
        var suggestedDomain = await SuggestDomainAsync(requestedDomain, suggestedSlug, cancellationToken);
        var requestedOwnerEmail = NormalizeEmailCandidate(string.IsNullOrWhiteSpace(ownerEmail) ? BuildOwnerEmail(ownerName, suggestedDomain) : ownerEmail);
        var suggestedOwnerEmail = await SuggestOwnerEmailAsync(requestedOwnerEmail, suggestedDomain, cancellationToken);

        var nameAvailable = string.IsNullOrWhiteSpace(normalizedName) || string.Equals(normalizedName, suggestedName, StringComparison.OrdinalIgnoreCase);

        var slugAvailable = string.Equals(requestedSlug, suggestedSlug, StringComparison.OrdinalIgnoreCase);
        var domainAvailable = string.IsNullOrWhiteSpace(requestedDomain) || string.Equals(requestedDomain, suggestedDomain, StringComparison.OrdinalIgnoreCase);
        var ownerEmailAvailable = string.IsNullOrWhiteSpace(requestedOwnerEmail) || string.Equals(requestedOwnerEmail, suggestedOwnerEmail, StringComparison.OrdinalIgnoreCase);

        var conflicts = new List<TenantAvailabilityConflictDto>();
        if (!nameAvailable)
        {
            conflicts.Add(new TenantAvailabilityConflictDto("name", normalizedName, "Bu kurum adı daha önce kullanılmış; önerilen kurum adı hazırlandı.", suggestedName));
        }

        if (!slugAvailable)
        {
            conflicts.Add(new TenantAvailabilityConflictDto("slug", requestedSlug, "Bu slug daha önce kullanılmış; uygun slug önerisi forma yazıldı.", suggestedSlug));
        }

        if (!domainAvailable)
        {
            conflicts.Add(new TenantAvailabilityConflictDto("domain", requestedDomain, "Bu domain daha önce kullanılmış; uygun domain önerisi forma yazıldı.", suggestedDomain));
        }

        if (!ownerEmailAvailable)
        {
            conflicts.Add(new TenantAvailabilityConflictDto("ownerEmail", requestedOwnerEmail, "Bu yetkili e-postası daha önce kullanılmış; uygun e-posta önerisi forma yazıldı.", suggestedOwnerEmail));
        }

        return Result<TenantAvailabilityDto>.Success(new TenantAvailabilityDto(
            normalizedName,
            suggestedName,
            nameAvailable,
            suggestedSlug,
            slugAvailable,
            suggestedDomain,
            domainAvailable,
            suggestedOwnerEmail,
            ownerEmailAvailable,
            conflicts));
    }

    public async Task<Result<TenantDto>> GetAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Branches).Include(x => x.SubscriptionPlan).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        return tenant is null ? Result<TenantDto>.Failure(Error.NotFound("Kurum bulunamadı.")) : Result<TenantDto>.Success(tenant.ToDto());
    }

    public async Task<Result<TenantWithCredentialsDto>> CreateAsync(CreateTenantRequest request, CancellationToken cancellationToken = default)
    {
        request = request with
        {
            Name = NormalizeText(request.Name),
            Slug = NormalizeSlugCandidate(request.Slug),
            Domain = NormalizeDomain(request.Domain),
            OwnerEmail = NormalizeEmailCandidate(request.OwnerEmail),
            OwnerName = NormalizeText(request.OwnerName),
        };

        var nameLower = request.Name.ToLowerInvariant();
        if (await _db.Tenants.AnyAsync(x => x.Status != TenantStatus.Cancelled && x.Name.ToLower() == nameLower, cancellationToken))
        {
            return Result<TenantWithCredentialsDto>.Failure(Error.Conflict("Bu kurum adı daha önce kullanılmış. Lütfen önerilen kurum/slug değerini kullanın."));
        }

        if (await _db.Tenants.AnyAsync(x => x.Slug == request.Slug, cancellationToken))
        {
            return Result<TenantWithCredentialsDto>.Failure(Error.Conflict("Bu slug ile kurum zaten var."));
        }

        if (!string.IsNullOrWhiteSpace(request.Domain))
        {
            var domain = request.Domain;
            if (await _db.Tenants.AnyAsync(x => x.Status != TenantStatus.Cancelled && x.Domain != null && x.Domain == domain, cancellationToken))
            {
                return Result<TenantWithCredentialsDto>.Failure(Error.Conflict("Bu domain daha önce kullanılmış. Lütfen önerilen domain değerini kullanın."));
            }
        }

        if (!string.IsNullOrWhiteSpace(request.OwnerEmail))
        {
            var ownerEmail = request.OwnerEmail;
            if (await _db.TenantUsers.AnyAsync(x => x.IsActive && x.Email == ownerEmail, cancellationToken))
            {
                return Result<TenantWithCredentialsDto>.Failure(Error.Conflict("Bu yetkili e-postası daha önce kullanılmış. Lütfen önerilen e-posta değerini kullanın."));
            }
        }

        var tenant = new Tenant(request.Name, request.Slug, request.Plan, TenantStatus.Trial);
        tenant.SetProfile(request.Domain, request.OwnerName);
        tenant.SetContact(request.Phone, null);
        tenant.SetProfileExtras(null, null, NormalizeEmailCandidate(request.Email));

        if (!string.IsNullOrWhiteSpace(request.DefaultBranchName) && !string.IsNullOrWhiteSpace(request.DefaultBranchCity))
        {
            tenant.AddBranch(request.DefaultBranchName, request.DefaultBranchCity, true);
        }

        // Dönem "Monthly"/"Yearly" ise ücretli abonelik hemen başlatılır: seçilen paket adına karşılık
        // gelen aktif paket atanır, kurum Aktif olur ve bitiş tarihi (oluşturma + 1 ay/yıl) hesaplanır.
        // "Trial" (veya boş) ise 14 günlük deneme akışı işler (sayaç owner ilk girişinde başlar).
        var period = ParseBillingPeriod(request.BillingPeriod);
        if (period.HasValue)
        {
            var planName = request.Plan.Trim();
            var plan = await _db.SubscriptionPlans
                .FirstOrDefaultAsync(p => p.IsActive && p.Name == planName, cancellationToken);
            if (plan is null)
            {
                return Result<TenantWithCredentialsDto>.Failure(
                    Error.Validation($"'{request.Plan}' adlı aktif paket bulunamadı. Ücretli dönem için geçerli bir paket seçin."));
            }

            tenant.StartSubscription(plan, period.Value, DateTime.UtcNow);
        }

        // Yetkili girişi: şifre girilmediyse geçici şifre üretilir + ilk giriş zorunlu değişim.
        // Şifre girildiyse o şifre kalıcı set edilir ve credentials döndürülmez.
        TenantCredentialsDto? credentials = null;
        if (!string.IsNullOrWhiteSpace(request.OwnerEmail))
        {
            var owner = tenant.GrantAccess(request.OwnerEmail, UserRole.InstitutionOwner, null, request.OwnerName);
            var passwordProvided = !string.IsNullOrWhiteSpace(request.InitialPassword);

            if (passwordProvided)
            {
                owner.SetPasswordHash(_passwordHasher.Hash(request.InitialPassword!));
            }
            else
            {
                var tempPassword = GenerateTempPassword();
                owner.SetTemporaryPassword(_passwordHasher.Hash(tempPassword)); // MustChangePassword=true
                credentials = new TenantCredentialsDto(
                    tenant.Id,
                    string.IsNullOrWhiteSpace(request.OwnerName) ? request.OwnerEmail! : request.OwnerName!,
                    request.OwnerEmail!,
                    tempPassword,
                    request.Name,
                    string.IsNullOrWhiteSpace(request.DefaultBranchName) ? null : request.DefaultBranchName,
                    true,
                    DateTime.UtcNow);
            }
        }

        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<TenantWithCredentialsDto>.Success(new TenantWithCredentialsDto(tenant.ToDto(), credentials));
    }

    public async Task<Result<TenantDto>> UpdateAsync(Guid id, UpdateTenantRequest request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Branches).Include(x => x.SubscriptionPlan).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null) return Result<TenantDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        tenant.Rename(request.Name);
        tenant.SetProfile(request.Domain, request.OwnerName);
        tenant.SetContact(request.Phone, request.TaxNumber);
        tenant.SetProfileExtras(request.LegalName ?? tenant.LegalName, request.TaxOffice ?? tenant.TaxOffice, request.Email ?? tenant.Email);
        // Finans ayarları — opsiyonel: gönderilmezse mevcut değer korunur.
        tenant.SetFinanceSettings(
            request.Currency ?? tenant.Currency,
            request.MaxInstallments ?? tenant.MaxInstallments,
            request.OverdueGraceDays ?? tenant.OverdueGraceDays);

        // Plan + dönem + durum — kurum oluşturma modalındaki dönem mantığıyla uyumlu.
        var now = DateTime.UtcNow;
        var period = ParseBillingPeriod(request.BillingPeriod);
        if (period.HasValue)
        {
            // Ücretli dönem seçili: paket adına karşılık gelen aktif paketi bul.
            var plan = await _db.SubscriptionPlans
                .FirstOrDefaultAsync(p => p.IsActive && p.Name == request.Plan.Trim(), cancellationToken);
            if (plan is null)
            {
                return Result<TenantDto>.Failure(
                    Error.Validation($"'{request.Plan}' adlı aktif paket bulunamadı. Ücretli dönem için geçerli bir paket seçin."));
            }

            // Yalnızca paket veya dönem GERÇEKTEN değiştiyse aboneliği yeniden başlat (bitiş sıfırlanır).
            // Aksi halde sadece profil/durum güncellenir; abonelik bitişi korunur.
            var subscriptionChanged = tenant.SubscriptionPeriod != period.Value || tenant.SubscriptionPlanId != plan.Id;
            if (subscriptionChanged)
            {
                tenant.StartSubscription(plan, period.Value, now); // Aktif + taze bitiş
                // Yalnızca askı/iptal baskın gelir; Aktif/Deneme dönemin belirlediği durumu bozmaz.
                if (request.Status == TenantStatus.Suspended) tenant.Suspend();
                else if (request.Status == TenantStatus.Cancelled) tenant.Cancel();
            }
            else
            {
                tenant.ChangePlan(plan.Name);
                ApplyStatusChange(tenant, request.Status);
            }
        }
        else
        {
            // Deneme/dönemsiz: plan adı korunur, durum uygulanır. Açıkça "Deneme" seçildiyse trial'a alınır.
            tenant.ChangePlan(request.Plan);
            if (request.Status == TenantStatus.Suspended) tenant.Suspend();
            else if (request.Status == TenantStatus.Cancelled) tenant.Cancel();
            else if (tenant.Status != TenantStatus.Trial) tenant.ResetTrialForNextOwnerLogin();
            // Zaten trial ise dokunma — sayaç korunur.
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result<TenantDto>.Success(tenant.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null) return Result.Failure(Error.NotFound("Kurum bulunamadı."));
        if (tenant.Status == TenantStatus.Cancelled) return Result.Success();

        tenant.Cancel();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result> GrantAccessAsync(Guid tenantId, GrantTenantAccessRequest request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Users).FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        if (tenant is null) return Result.Failure(Error.NotFound("Kurum bulunamadı."));

        var user = tenant.GrantAccess(request.Email, request.Role, request.BranchId, request.FullName);
        if (!string.IsNullOrWhiteSpace(request.InitialPassword)) user.SetPasswordHash(_passwordHasher.Hash(request.InitialPassword));
        _db.TenantUsers.Add(user);
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<TenantCredentialsDto>> ResetOwnerPasswordAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<TenantCredentialsDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var owner = await _db.TenantUsers
            .Where(u => u.TenantId == tenantId && u.IsActive && u.Role == UserRole.InstitutionOwner)
            .OrderBy(u => u.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        if (owner is null) return Result<TenantCredentialsDto>.Failure(Error.NotFound("Kurumun aktif yetkili hesabı bulunamadı."));

        var tempPassword = GenerateTempPassword();
        owner.SetTemporaryPassword(_passwordHasher.Hash(tempPassword)); // MustChangePassword=true

        // Aktif oturumları düşür: tüm geçerli refresh token'lar iptal edilir.
        var now = DateTime.UtcNow;
        var tokens = await _db.RefreshTokens
            .Where(t => t.TenantUserId == owner.Id && t.RevokedAtUtc == null && t.ExpiresAtUtc > now)
            .ToListAsync(cancellationToken);
        foreach (var token in tokens) token.Revoke(now);

        await _db.SaveChangesAsync(cancellationToken);

        return Result<TenantCredentialsDto>.Success(new TenantCredentialsDto(
            tenant.Id,
            string.IsNullOrWhiteSpace(owner.FullName) ? owner.Email : owner.FullName!,
            owner.Email,
            tempPassword,
            tenant.Name,
            null,
            true,
            now));
    }

    private async Task<string> SuggestSlugAsync(string baseSlug, CancellationToken cancellationToken)
    {
        var slug = string.IsNullOrWhiteSpace(baseSlug) ? "kurum" : baseSlug;
        for (var i = 0; i < 100; i++)
        {
            var candidate = i == 0 ? slug : $"{slug}-{i + 1}";
            var exists = await _db.Tenants.AsNoTracking()
                .AnyAsync(x => x.Status != TenantStatus.Cancelled && x.Slug == candidate, cancellationToken);
            if (!exists) return candidate;
        }

        return $"{slug}-{DateTime.UtcNow:yyyyMMddHHmmss}";
    }

    private async Task<string> SuggestNameAsync(string baseName, CancellationToken cancellationToken)
    {
        var name = string.IsNullOrWhiteSpace(baseName) ? "Yeni Kurum" : baseName.Trim();
        for (var i = 0; i < 100; i++)
        {
            var candidate = i == 0 ? name : $"{name} {i + 1}";
            var candidateLower = candidate.ToLowerInvariant();
            var exists = await _db.Tenants.AsNoTracking()
                .AnyAsync(x => x.Status != TenantStatus.Cancelled && x.Name.ToLower() == candidateLower, cancellationToken);
            if (!exists) return candidate;
        }

        return $"{name} {DateTime.UtcNow:yyyyMMddHHmmss}";
    }

    private async Task<string> SuggestDomainAsync(string baseDomain, string slug, CancellationToken cancellationToken)
    {
        var domain = string.IsNullOrWhiteSpace(baseDomain) ? BuildDomain(slug) : baseDomain;
        for (var i = 0; i < 100; i++)
        {
            var candidate = i == 0 ? domain : BuildDomain($"{slug}-{i + 1}");
            var exists = await _db.Tenants.AsNoTracking()
                .AnyAsync(x => x.Status != TenantStatus.Cancelled && x.Domain != null && x.Domain == candidate, cancellationToken);
            if (!exists) return candidate;
        }

        return BuildDomain($"{slug}-{DateTime.UtcNow:yyyyMMddHHmmss}");
    }

    private async Task<string> SuggestOwnerEmailAsync(string baseEmail, string domain, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(baseEmail)) return string.Empty;

        var at = baseEmail.IndexOf('@');
        var local = at > 0 ? baseEmail[..at] : "yetkili";
        var emailDomain = at > 0 && at < baseEmail.Length - 1 ? baseEmail[(at + 1)..] : domain;
        for (var i = 0; i < 100; i++)
        {
            var candidate = i == 0 ? $"{local}@{emailDomain}" : $"{local}{i + 1}@{emailDomain}";
            var exists = await _db.TenantUsers.AsNoTracking()
                .AnyAsync(x => x.IsActive && x.Email == candidate, cancellationToken);
            if (!exists) return candidate;
        }

        return $"{local}{DateTime.UtcNow:yyyyMMddHHmmss}@{emailDomain}";
    }

    /// <summary>Düzenleme formundaki "Durum" alanını ilgili tenant yaşam-döngüsü metoduna uygular.</summary>
    private static void ApplyStatusChange(Tenant tenant, TenantStatus status)
    {
        switch (status)
        {
            case TenantStatus.Active: tenant.Activate(); break;       // geçerli abonelik bitişini korur
            case TenantStatus.Trial: tenant.ResetTrialForNextOwnerLogin(); break;
            case TenantStatus.Suspended: tenant.Suspend(); break;
            case TenantStatus.Cancelled: tenant.Cancel(); break;
        }
    }

    /// <summary>
    /// İstemciden gelen dönem ifadesini ücretli abonelik dönemine çevirir.
    /// "Yearly"/"Yillik"/"Yıllık" → Yearly; "Monthly"/"Aylik"/"Aylık" → Monthly;
    /// "Trial"/"Deneme"/boş → null (deneme akışı).
    /// </summary>
    private static BillingPeriod? ParseBillingPeriod(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        switch (value.Trim().ToLowerInvariant())
        {
            case "yearly":
            case "yillik":
            case "yıllık":
            case "annual":
                return BillingPeriod.Yearly;
            case "monthly":
            case "aylik":
            case "aylık":
                return BillingPeriod.Monthly;
            default:
                return null; // trial / deneme / bilinmeyen → deneme akışı
        }
    }

    private static string NormalizeText(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();

    private static string NormalizeSlugCandidate(string? value)
    {
        var source = string.IsNullOrWhiteSpace(value) ? "kurum" : value.Trim();
        source = TransliterateTurkish(source).ToLowerInvariant();
        var sb = new StringBuilder(source.Length);
        foreach (var c in source)
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb.Append(c);
            else if (char.IsWhiteSpace(c) || c is '-' or '_' or '.' or '/') sb.Append('-');
        }

        var slug = MultiDashRegex.Replace(sb.ToString(), "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "kurum" : slug;
    }

    private static string NormalizeEmailLocalPart(string? value)
    {
        var source = string.IsNullOrWhiteSpace(value) ? "yetkili" : value.Trim();
        source = TransliterateTurkish(source).ToLowerInvariant();
        var sb = new StringBuilder(source.Length);
        foreach (var c in source)
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb.Append(c);
            else if (char.IsWhiteSpace(c) || c is '-' or '_' or '.') sb.Append('.');
        }

        var local = MultiDotRegex.Replace(sb.ToString(), ".").Trim('.');
        return string.IsNullOrWhiteSpace(local) ? "yetkili" : local;
    }

    private static string NormalizeDomain(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var domain = value.Trim().ToLowerInvariant();
        domain = domain.Replace("https://", string.Empty).Replace("http://", string.Empty);
        var slashIndex = domain.IndexOf('/');
        if (slashIndex >= 0) domain = domain[..slashIndex];
        return domain.Trim('.');
    }

    private static string NormalizeEmailCandidate(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();

    private static string BuildDomain(string slug) => $"{NormalizeSlugCandidate(slug)}.{DefaultTenantDomainSuffix}";

    private static string BuildOwnerEmail(string? ownerName, string domain)
    {
        if (string.IsNullOrWhiteSpace(ownerName)) return string.Empty;
        var safeDomain = string.IsNullOrWhiteSpace(domain) ? DefaultTenantDomainSuffix : domain;
        return $"{NormalizeEmailLocalPart(ownerName)}@{safeDomain}";
    }

    private static string TransliterateTurkish(string value)
    {
        var replaced = value
            .Replace('ı', 'i').Replace('İ', 'i')
            .Replace('ş', 's').Replace('Ş', 's')
            .Replace('ç', 'c').Replace('Ç', 'c')
            .Replace('ğ', 'g').Replace('Ğ', 'g')
            .Replace('ü', 'u').Replace('Ü', 'u')
            .Replace('ö', 'o').Replace('Ö', 'o');

        var normalized = replaced.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        }

        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    /// <summary>
    /// 10 karakterlik güvenli geçici şifre üretir (en az 1 büyük, 1 küçük, 1 rakam, 1 özel).
    /// Karışıklık yaratan karakterler (O, I, Q, l, 0, 1) çıkarılmıştır.
    /// </summary>
    private static string GenerateTempPassword()
    {
        const string upper = "ABCDEFGHJKLMNPRSTUVYZ";
        const string lower = "abcdefghijkmnpqrstuvwxyz";
        const string digits = "23456789";
        const string special = "@#$!*";

        var chars = new char[10];
        chars[0] = upper[RandomNumberGenerator.GetInt32(upper.Length)];
        chars[1] = lower[RandomNumberGenerator.GetInt32(lower.Length)];
        chars[2] = digits[RandomNumberGenerator.GetInt32(digits.Length)];
        chars[3] = special[RandomNumberGenerator.GetInt32(special.Length)];
        var all = upper + lower + digits;
        for (var i = 4; i < chars.Length; i++)
        {
            chars[i] = all[RandomNumberGenerator.GetInt32(all.Length)];
        }
        for (var i = chars.Length - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars);
    }
}

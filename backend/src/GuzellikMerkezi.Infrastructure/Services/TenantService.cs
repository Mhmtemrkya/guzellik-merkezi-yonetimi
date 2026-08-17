using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class TenantService : ITenantService
{
    private const string DefaultTenantDomainSuffix = "beautyasist.app";
    private static readonly Regex MultiDashRegex = new("-+", RegexOptions.Compiled);
    private static readonly Regex MultiDotRegex = new("\\.+", RegexOptions.Compiled);

    private readonly GuzellikDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IFeatureService _features;
    private readonly IAuditLogger _audit;
    private readonly ISearchIndexService _search;

    public TenantService(GuzellikDbContext db, IPasswordHasher passwordHasher, IFeatureService features, IAuditLogger audit, ISearchIndexService search)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _features = features;
        _audit = audit;
        _search = search;
    }

    /// <summary>
    /// Kurum listesi (platform paneli) — kod / slug / ad ile arama.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>ARAMA NEDEN İKİ AŞAMALI?</b> <c>Tenant.Name</c> at-rest AES-GCM (rastgele nonce) ile
    /// şifreli: aynı düz metin her satırda farklı ciphertext ürettiği için <c>Name.Contains(...)</c>
    /// SQL'de HİÇBİR ZAMAN eşleşmez — eski kod tam olarak bunu yapıyordu ve ada göre arama sessizce
    /// boş dönüyordu. <c>Code</c> ve <c>Slug</c> düz metindir, onlar SQL'de aranır; ada göre arama
    /// ise çözülmüş değerler üzerinde bellekte yapılır.
    /// </para>
    /// <para>
    /// ÖLÇEK: bellek yolu yalnız ARAMA yapıldığında ve yalnız kurum tablosunda çalışır (kurum sayısı
    /// binler mertebesinde). Onbinleri geçerse ada da blind index eklenmeli.
    /// </para>
    /// </remarks>
    public async Task<Result<PagedResult<TenantDto>>> ListAsync(PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.Tenants.AsNoTracking().Include(x => x.Branches).Include(x => x.SubscriptionPlan).Where(x => x.Status != TenantStatus.Cancelled).OrderBy(x => x.Name).AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            // Kod aramasında biçim toleransı: "ba1", "BA-1", "1" hepsi BA-01'i bulmalı.
            var codeNumber = TenantCodeAllocator.ParseNumber(search);
            var normalizedCode = codeNumber > 0 ? TenantCodeAllocator.Format(codeNumber) : null;

            var all = await query.ToArrayAsync(cancellationToken);
            var filtered = all
                .Where(x =>
                    (x.Code is not null && (
                        x.Code.Contains(search, StringComparison.OrdinalIgnoreCase)
                        || (normalizedCode is not null && x.Code.Equals(normalizedCode, StringComparison.OrdinalIgnoreCase))))
                    || x.Slug.Contains(search, StringComparison.OrdinalIgnoreCase)
                    || SearchText.FoldedContains(x.Name, search))
                .ToArray();

            var pageItems = filtered
                .Skip(request.Skip).Take(request.SafePageSize)
                .Select(x => x.ToDto()).ToArray();
            return Result<PagedResult<TenantDto>>.Success(
                new PagedResult<TenantDto>(pageItems, filtered.Length, request.SafePage, request.SafePageSize));
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
        // Kurum kodu (BA-01) HER İKİ yoldan da atanır — platform paneli ve self-servis kayıt.
        // Tek kaynak TenantCodeAllocator; iki yerde ayrı hesaplanırsa numaralar çakışır.
        tenant.AssignCode(await TenantCodeAllocator.NextAsync(_db, 0, cancellationToken));
        tenant.SetProfile(request.Domain, request.OwnerName);
        tenant.SetContact(request.Phone, null);
        tenant.SetProfileExtras(null, null, NormalizeEmailCandidate(request.Email));
        // Telefon şifreli olduğu için mükerrer kontrolü ancak blind index ile yapılabilir.
        tenant.SetPhoneIndex(_search.BuildPhoneKey(request.Phone));

        if (!string.IsNullOrWhiteSpace(request.DefaultBranchName) && !string.IsNullOrWhiteSpace(request.DefaultBranchCity))
        {
            tenant.AddBranch(request.DefaultBranchName, request.DefaultBranchCity, true);
        }

        // Dönem "Monthly"/"Yearly" ise ücretli abonelik hemen başlatılır: seçilen paket adına karşılık
        // gelen aktif paket atanır, kurum Aktif olur ve bitiş tarihi (oluşturma + 1 ay/yıl) hesaplanır.
        // "Trial" (veya boş) ise 14 günlük deneme akışı işler (sayaç owner ilk girişinde başlar).
        var period = ParseBillingPeriod(request.BillingPeriod);
        var planName = request.Plan.Trim();
        var plan = await _db.SubscriptionPlans
            .FirstOrDefaultAsync(p => p.IsActive && p.Name == planName, cancellationToken);
        if (plan is null)
        {
            return Result<TenantWithCredentialsDto>.Failure(
                Error.Validation($"'{request.Plan}' adlı aktif paket bulunamadı. Geçerli bir paket seçin."));
        }

        if (period.HasValue)
        {
            tenant.StartSubscription(plan, period.Value, DateTime.UtcNow);
        }
        else
        {
            // Deneme: abonelik başlatılmaz ama seçilen paket yine de bağlanır; aksi halde
            // kurum plansız kalır (feature gating kapalı, listede "paket atanmamış",
            // plan değiştir diyaloğu ilk paketi — Başlangıç — gösterir).
            tenant.AssignSubscriptionPlan(plan);
        }

        // Yetkili girişi: şifre girilmediyse geçici şifre üretilir + ilk giriş zorunlu değişim.
        // Şifre girildiyse o şifre kalıcı set edilir ve credentials döndürülmez.
        var branchNameForCredentials = string.IsNullOrWhiteSpace(request.DefaultBranchName) ? null : request.DefaultBranchName;
        var allCredentials = new List<TenantCredentialsDto>();
        var usedEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        TenantCredentialsDto? credentials = null;
        if (!string.IsNullOrWhiteSpace(request.OwnerEmail))
        {
            usedEmails.Add(request.OwnerEmail!);
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
                    branchNameForCredentials,
                    true,
                    DateTime.UtcNow);
                allCredentials.Add(credentials);
            }
        }

        // Ek kurum yöneticileri: her biri InstitutionOwner rolüyle açılır, her birine ayrı
        // geçici şifre üretilir. E-posta boşsa ad + kurum domaininden türetilir; hem form
        // içinde hem mevcut kullanıcılara karşı benzersizlik denetlenir (çakışma → 409).
        foreach (var extra in request.AdditionalOwners ?? Array.Empty<TenantAdditionalOwnerInput>())
        {
            var extraName = NormalizeText(extra.Name);
            var extraEmail = NormalizeEmailCandidate(extra.Email);
            if (string.IsNullOrWhiteSpace(extraEmail))
            {
                if (string.IsNullOrWhiteSpace(extraName)) continue; // tamamen boş satır → yok say
                extraEmail = BuildOwnerEmail(extraName, request.Domain ?? string.Empty);
            }

            if (!usedEmails.Add(extraEmail))
            {
                return Result<TenantWithCredentialsDto>.Failure(Error.Conflict($"'{extraEmail}' e-postası formda birden fazla yöneticiye yazılmış. Her yöneticinin e-postası farklı olmalı."));
            }

            if (await _db.TenantUsers.AnyAsync(x => x.IsActive && x.Email == extraEmail, cancellationToken))
            {
                return Result<TenantWithCredentialsDto>.Failure(Error.Conflict($"'{extraEmail}' e-postası daha önce kullanılmış. Ek yönetici için farklı bir e-posta girin."));
            }

            var extraOwner = tenant.GrantAccess(extraEmail, UserRole.InstitutionOwner, null, string.IsNullOrWhiteSpace(extraName) ? null : extraName);
            var extraPassword = GenerateTempPassword();
            extraOwner.SetTemporaryPassword(_passwordHasher.Hash(extraPassword)); // MustChangePassword=true
            allCredentials.Add(new TenantCredentialsDto(
                tenant.Id,
                string.IsNullOrWhiteSpace(extraName) ? extraEmail : extraName,
                extraEmail,
                extraPassword,
                request.Name,
                branchNameForCredentials,
                true,
                DateTime.UtcNow));
        }

        _db.Tenants.Add(tenant);

        /*
         * LOGO (opsiyonel) — vitrin profiline yazılır, kurumun kendi yüklediğiyle AYNI alana.
         *
         * Doğrulama SetLogoAsync ile birebir aynıdır; ayrı bir yol açıp gevşek kabul etmek,
         * platform ucunu aynı alana kural tanımadan yazan bir arka kapıya çevirirdi.
         */
        var logo = request.LogoData?.Trim();
        if (!string.IsNullOrWhiteSpace(logo))
        {
            if (!logo.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
                return Result<TenantWithCredentialsDto>.Failure(Error.Validation("Logo base64 data-URL biçiminde olmalı."));
            if (logo.Length > TenantProfileService.MaxImageDataLength)
                return Result<TenantWithCredentialsDto>.Failure(Error.Validation("Logo çok büyük. Lütfen daha küçük bir görsel yükleyin."));

            var profile = new TenantPublicProfile(tenant.Id);
            profile.SetLogo(logo);
            _db.TenantPublicProfiles.Add(profile);
        }

        await _db.SaveChangesAsync(cancellationToken);
        return Result<TenantWithCredentialsDto>.Success(new TenantWithCredentialsDto(
            tenant.ToDto(),
            credentials ?? (allCredentials.Count > 0 ? allCredentials[0] : null),
            allCredentials.Count > 0 ? allCredentials : null));
    }

    /// <summary>
    /// KURUMUN KENDİ PROFİL/FİNANS GÜNCELLEMESİ — abonelik alanlarına dokunmaz.
    ///
    /// <para>
    /// Kurum yöneticisinin ucu eskiden platform DTO'sunu (<c>UpdateTenantRequest</c>) alıyordu ve
    /// aynı servis metodu paket/dönem/durumu da uyguluyordu: ödeme, callback ve platform onayı
    /// olmadan ücretli plan aktive edilebiliyordu (bkz. <see cref="UpdateTenantProfileRequest"/>).
    /// Bu metot yalnız profil ve finans ayarlarını yazar; abonelik değişimi PlatformAdmin'in
    /// <see cref="UpdateAsync"/> ucundan ya da doğrulanmış billing sonucundan gelir.
    /// </para>
    /// </summary>
    public async Task<Result<TenantDto>> UpdateProfileAsync(Guid id, UpdateTenantProfileRequest request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Branches).Include(x => x.SubscriptionPlan).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null) return Result<TenantDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        ApplyProfileAndFinance(tenant, request.Name, request.Domain, request.OwnerName, request.Phone,
            request.TaxNumber, request.LegalName, request.TaxOffice, request.Email,
            request.Currency, request.MaxInstallments, request.OverdueGraceDays);

        await _db.SaveChangesAsync(cancellationToken);
        return Result<TenantDto>.Success(tenant.ToDto());
    }

    /// <summary>Profil + finans alanlarını uygular (iki güncelleme yolunun ortak gövdesi).</summary>
    private static void ApplyProfileAndFinance(
        Tenant tenant, string name, string? domain, string? ownerName, string? phone, string? taxNumber,
        string? legalName, string? taxOffice, string? email, string? currency, int? maxInstallments, int? overdueGraceDays)
    {
        tenant.Rename(name);
        tenant.SetProfile(domain, ownerName);
        tenant.SetContact(phone, taxNumber);
        tenant.SetProfileExtras(legalName ?? tenant.LegalName, taxOffice ?? tenant.TaxOffice, email ?? tenant.Email);
        // Finans ayarları — opsiyonel: gönderilmezse mevcut değer korunur.
        tenant.SetFinanceSettings(
            currency ?? tenant.Currency,
            maxInstallments ?? tenant.MaxInstallments,
            overdueGraceDays ?? tenant.OverdueGraceDays);
    }

    public async Task<Result<TenantDto>> UpdateAsync(Guid id, UpdateTenantRequest request, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.Include(x => x.Branches).Include(x => x.SubscriptionPlan).FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null) return Result<TenantDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        ApplyProfileAndFinance(tenant, request.Name, request.Domain, request.OwnerName, request.Phone,
            request.TaxNumber, request.LegalName, request.TaxOffice, request.Email,
            request.Currency, request.MaxInstallments, request.OverdueGraceDays);

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
            // Deneme/dönemsiz: seçilen paket isimden bulunup bağlanır (yoksa yalnızca ad değişir),
            // durum uygulanır. Açıkça "Deneme" seçildiyse trial'a alınır.
            var trialPlan = await _db.SubscriptionPlans
                .FirstOrDefaultAsync(p => p.IsActive && p.Name == request.Plan.Trim(), cancellationToken);
            if (trialPlan is not null) tenant.AssignSubscriptionPlan(trialPlan);
            else tenant.ChangePlan(request.Plan);
            if (request.Status == TenantStatus.Suspended) tenant.Suspend();
            else if (request.Status == TenantStatus.Cancelled) tenant.Cancel();
            else if (tenant.Status != TenantStatus.Trial) tenant.ResetTrialForNextOwnerLogin();
            // Zaten trial ise dokunma — sayaç korunur.
        }

        await _db.SaveChangesAsync(cancellationToken);
        _features.InvalidateTenant(tenant.Id); // plan/durum değişti → feature-set önbelleği tazelensin
        return Result<TenantDto>.Success(tenant.ToDto());
    }

    /// <summary>
    /// KURUMU VERİTABANINDAN GERÇEKTEN SİLER — geri alınamaz.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Eskiden bu metot yalnız <c>tenant.Cancel()</c> çağırıyordu: kurum listeden kayboluyor ama
    /// tüm satırları (müşteriler, randevular, tahsilatlar, şifreli kişisel veriler) veritabanında
    /// kalıyordu. Platform panelindeki "Sil" düğmesi böylece gerçekte silmiyordu; KVKK silme
    /// talebini de karşılamıyordu.
    /// </para>
    /// <para>
    /// Silme TEK TRANSACTION içinde yapılır: yarıda hata olursa hiçbir şey silinmez. Yarım
    /// silinmiş kurum (şubesi gitmiş, müşterisi kalmış) hiç silinmemişten kötüdür.
    /// </para>
    /// <para>
    /// Silinen kurumun <b>kodu yeniden dağıtılmaz</b> (bkz. <see cref="TenantCodeAllocator"/>):
    /// eski destek kayıtları yanlış kurumu göstermesin.
    /// </para>
    /// </remarks>
    public async Task<Result> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        // IgnoreQueryFilters: daha önce iptal edilmiş (soft-delete) kurumlar da silinebilmeli —
        // aksi hâlde eski davranışla iptal edilenler kalıcı olarak temizlenemezdi.
        var tenant = await _db.Tenants.IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null) return Result.Failure(Error.NotFound("Kurum bulunamadı."));

        var name = tenant.Name;
        var code = tenant.Code;

        // Denetim kaydı silmeden ÖNCE yazılır: kayıt kurumun kendi satırlarıyla birlikte silinecek
        // olsa bile, platform genelindeki log tablosunda iz kalması gerekiyor.
        await _audit.LogAsync(id, null, "DeleteTenant", "Tenant", id,
            $"Kurum veritabanından KALICI olarak silindi: {name} ({code ?? "kodsuz"}).", null, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        // Takip edilen varlıklar ham SQL silmesiyle çakışmasın (silinmiş satırı güncellemeye
        // çalışan bir SaveChanges concurrency hatası verirdi).
        _db.ChangeTracker.Clear();

        var relational = _db.Database.IsRelational();
        await using var tx = relational
            ? await _db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var deleted = await TenantPurge.PurgeAsync(_db, id, null, cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);

        _features.InvalidateTenant(id);

        var rows = deleted.Values.Sum();
        return rows > 0 || deleted.Count > 0
            ? Result.Success()
            : Result.Failure(Error.NotFound("Kurum bulunamadı."));
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

    public async Task<Result<GuideResetDto>> ResetGuideAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<GuideResetDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        tenant.ResetGuide();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "ResetGuide", "Tenant", tenant.Id,
            $"Kullanım kılavuzu sıfırlandı: {tenant.Name}", null, cancellationToken);
        return Result<GuideResetDto>.Success(new GuideResetDto(tenant.GuideResetAtUtc));
    }

    public async Task<Result<GuideResetDto>> GetGuideResetAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var resetAt = await _db.Tenants.AsNoTracking()
            .Where(x => x.Id == tenantId)
            .Select(x => x.GuideResetAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        return Result<GuideResetDto>.Success(new GuideResetDto(resetAt));
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

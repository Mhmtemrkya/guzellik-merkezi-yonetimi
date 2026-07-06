using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Authorization;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AuthService : IAuthService
{
    private const string TrialExpiredMessage = "Deneme süresi bitti, lütfen paketlerden birisini alın.";
    private const string SubscriptionExpiredMessage = "Abonelik süreniz doldu, lütfen paketlerden birini satın alın.";
    private const string TrialPendingOwnerLoginMessage = "Deneme süresi kurum yöneticisinin ilk girişinde başlayacak.";

    private readonly GuzellikDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenService _tokenService;
    private readonly IDateTimeProvider _clock;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    private readonly Application.Features.Features.IFeatureService _features;
    private readonly Application.Features.AppNotifications.IAppNotificationService _notifications;

    public AuthService(
        GuzellikDbContext db,
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        IDateTimeProvider clock,
        IAuditLogger audit,
        ICurrentUser currentUser,
        Application.Features.Features.IFeatureService features,
        Application.Features.AppNotifications.IAppNotificationService notifications)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _clock = clock;
        _audit = audit;
        _currentUser = currentUser;
        _features = features;
        _notifications = notifications;
    }

    public async Task<Result<LoginScopeResponse>> GetLoginScopeAsync(LoginScopeRequest request, CancellationToken cancellationToken = default)
    {
        var email = TenantUser.NormalizeEmail(request.Email);
        var users = await _db.TenantUsers.AsNoTracking()
            .Include(x => x.Tenant)!.ThenInclude(x => x!.Branches)
            .Where(x => x.Email == email && x.IsActive && (request.Role == null || x.Role == request.Role))
            .ToArrayAsync(cancellationToken);

        // Rol gönderilmediyse en yetkili rol seçilir (enum değeri küçük olan üstündür).
        var resolvedRole = request.Role ?? (users.Length > 0 ? users.Min(x => x.Role) : (UserRole?)null);
        users = users.Where(x => x.Role == resolvedRole).ToArray();

        var tenants = users
            .Where(x => x.Tenant is not null)
            .Select(x => new LoginScopeTenantDto(
                x.TenantId,
                x.Tenant!.Name,
                x.Tenant.Status.ToString(),
                x.Tenant.Branches
                    .Where(branch => x.BranchId is null || branch.Id == x.BranchId)
                    .Select(branch => new LoginScopeBranchDto(branch.Id, branch.Name, branch.City, branch.IsDefault))
                    .ToArray()))
            .ToArray();

        return Result<LoginScopeResponse>.Success(new LoginScopeResponse(email, resolvedRole, tenants));
    }

    public async Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var email = TenantUser.NormalizeEmail(request.Email);
        var user = await _db.TenantUsers.Include(x => x.Tenant)
            .FirstOrDefaultAsync(x => x.Email == email && x.Role == request.Role && x.IsActive, cancellationToken);

        if (user is null || !_passwordHasher.Verify(request.Password, user.PasswordHash))
        {
            return Result<LoginResponse>.Failure(Error.Unauthorized("E-posta, rol veya parola hatalı."));
        }

        if (request.Role != UserRole.PlatformAdmin)
        {
            if (request.TenantId != user.TenantId) return Result<LoginResponse>.Failure(Error.Unauthorized("Kurum seçimi geçersiz."));
            if (user.BranchId.HasValue && request.BranchId != user.BranchId) return Result<LoginResponse>.Failure(Error.Unauthorized("Şube seçimi geçersiz."));

            var tenantAccessResult = await EnsureTenantCanLoginAsync(user, request.Role, cancellationToken);
            if (tenantAccessResult is not null) return tenantAccessResult;

            // Cihaz güvenliği: özellik pakette varsa ve kurum açtıysa personel yalnızca
            // tanımlı cihazlarından girebilir. Tanımsız cihaz + dolu limit = engel + güvenlik logu.
            if (request.Role == UserRole.Staff && user.Tenant?.DeviceControlEnabled == true
                && await _features.IsFeatureAllowedAsync(user.TenantId, FeatureCatalog.SecurityDeviceControl, cancellationToken))
            {
                var deviceResult = await EnforceDeviceControlAsync(user, request, cancellationToken);
                if (deviceResult is not null) return deviceResult;
            }
        }

        var profile = BuildProfile(user, request.BranchId ?? user.BranchId);
        var expiresAt = _clock.UtcNow.AddMinutes(60);
        var accessToken = _tokenService.CreateAccessToken(profile, expiresAt);
        var refreshToken = _tokenService.CreateRefreshToken();
        var refreshEntity = new RefreshToken(user.Id, _tokenService.HashRefreshToken(refreshToken), _clock.UtcNow.AddDays(14));
        _db.RefreshTokens.Add(refreshEntity);

        if (!IsInMemoryProvider())
        {
            user.RecordLogin(_clock.UtcNow);
        }

        await _db.SaveChangesAsync(cancellationToken);
        await LogAuthActivityAsync(user, request.BranchId ?? user.BranchId, "Login", "Sisteme giriş yaptı.", cancellationToken);

        return Result<LoginResponse>.Success(new LoginResponse(accessToken, refreshToken, expiresAt, profile));
    }

    public async Task<Result<LoginResponse>> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        var hash = _tokenService.HashRefreshToken(request.RefreshToken);
        // Salt-okunur yükle: aşağıda eski token raw UPDATE ile iptal edilir, yeni token ayrı INSERT ile eklenir.
        // (MySql.EntityFrameworkCore aynı SaveChanges'te UPDATE+INSERT karışımında hatalı SQL üretip
        //  DbUpdateConcurrencyException "0 satır etkilendi" fırlatıyor — refresh'in hiç çalışmamasının sebebi buydu.)
        var token = await _db.RefreshTokens
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Include(x => x.TenantUser).ThenInclude(x => x!.Tenant)
            .Include(x => x.Customer).ThenInclude(x => x!.Branch)
            .FirstOrDefaultAsync(x => x.TokenHash == hash, cancellationToken);
        if (token is null || !token.IsActive(_clock.UtcNow)) return Result<LoginResponse>.Failure(Error.Unauthorized("Refresh token geçersiz."));

        // Müşteri (online portal) token'ı ayrı akışla yenilenir.
        if (token.CustomerId.HasValue)
        {
            return await RotateCustomerRefreshAsync(token, cancellationToken);
        }

        if (token.TenantUser is null) return Result<LoginResponse>.Failure(Error.Unauthorized("Refresh token geçersiz."));

        if (token.TenantUser.Role != UserRole.PlatformAdmin)
        {
            var tenantAccessResult = await EnsureTenantCanLoginAsync(token.TenantUser, token.TenantUser.Role, cancellationToken);
            if (tenantAccessResult is not null) return tenantAccessResult;
        }

        var newRefreshToken = _tokenService.CreateRefreshToken();
        var newHash = _tokenService.HashRefreshToken(newRefreshToken);
        var nowUtc = _clock.UtcNow;

        // 1) Eski token'ı ATOMİK iptal et — yalnızca henüz iptal edilmemişse (RevokedAtUtc == null).
        //    Aynı token'la eşzamanlı iki refresh (örn. telefon+tablet ya da proaktif+reaktif yenileme aynı anda)
        //    yarışırsa yalnızca biri 1 satır etkiler; diğeri 0 alır → ikinci geçerli token zinciri oluşmaz.
        var affected = await _db.RefreshTokens
            .Where(x => x.Id == token.Id && x.RevokedAtUtc == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.RevokedAtUtc, (DateTime?)nowUtc)
                .SetProperty(x => x.ReplacedByTokenHash, newHash)
                .SetProperty(x => x.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);

        // Yarış kaybedildiyse (0 satır) bu isteği reddet — paralel istek geçerli token'ı zaten almıştır.
        if (affected == 0)
            return Result<LoginResponse>.Failure(Error.Unauthorized("Refresh token geçersiz."));

        // 2) Yeni token'ı ekle — sadece INSERT.
        _db.RefreshTokens.Add(new RefreshToken(token.TenantUserId!.Value, newHash, nowUtc.AddDays(14)));
        await _db.SaveChangesAsync(cancellationToken);

        var profile = BuildProfile(token.TenantUser, token.TenantUser.BranchId);
        var expiresAt = nowUtc.AddMinutes(60);
        var accessToken = _tokenService.CreateAccessToken(profile, expiresAt);
        return Result<LoginResponse>.Success(new LoginResponse(accessToken, newRefreshToken, expiresAt, profile));
    }

    /// <summary>Müşteri refresh token'ını döndürür (TenantUser akışının müşteri eşleniği).</summary>
    private async Task<Result<LoginResponse>> RotateCustomerRefreshAsync(RefreshToken token, CancellationToken cancellationToken)
    {
        var customer = token.Customer;
        if (customer is null) return Result<LoginResponse>.Failure(Error.Unauthorized("Refresh token geçersiz."));

        var tenantAccess = await EnsureCustomerTenantCanLoginAsync(customer.TenantId, cancellationToken);
        if (tenantAccess is not null) return tenantAccess;

        var newRefreshToken = _tokenService.CreateRefreshToken();
        var newHash = _tokenService.HashRefreshToken(newRefreshToken);
        var nowUtc = _clock.UtcNow;

        var affected = await _db.RefreshTokens
            .IgnoreQueryFilters()
            .Where(x => x.Id == token.Id && x.RevokedAtUtc == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.RevokedAtUtc, (DateTime?)nowUtc)
                .SetProperty(x => x.ReplacedByTokenHash, newHash)
                .SetProperty(x => x.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);
        if (affected == 0) return Result<LoginResponse>.Failure(Error.Unauthorized("Refresh token geçersiz."));

        _db.RefreshTokens.Add(RefreshToken.ForCustomer(customer.Id, newHash, nowUtc.AddDays(30)));
        await _db.SaveChangesAsync(cancellationToken);

        var profile = BuildCustomerProfile(customer);
        var expiresAt = nowUtc.AddMinutes(60);
        var accessToken = _tokenService.CreateAccessToken(profile, expiresAt);
        return Result<LoginResponse>.Success(new LoginResponse(accessToken, newRefreshToken, expiresAt, profile));
    }

    public async Task<Result> LogoutAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        var hash = _tokenService.HashRefreshToken(request.RefreshToken);
        var token = await _db.RefreshTokens
            .Include(x => x.TenantUser)
            .FirstOrDefaultAsync(x => x.TokenHash == hash, cancellationToken);
        if (token is not null && token.IsActive(_clock.UtcNow))
        {
            var user = token.TenantUser;
            token.Revoke(_clock.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);

            if (user is not null)
            {
                await LogAuthActivityAsync(user, user.BranchId, "Logout", "Sistemden çıkış yaptı.", cancellationToken);
            }
        }
        return Result.Success();
    }

    public async Task<Result<UserProfileDto>> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken cancellationToken = default)
    {
        var user = await _db.TenantUsers.FirstOrDefaultAsync(x => x.Id == userId && x.IsActive, cancellationToken);
        if (user is null) return Result<UserProfileDto>.Failure(Error.NotFound("Kullanıcı bulunamadı."));

        if (!_passwordHasher.Verify(request.CurrentPassword, user.PasswordHash))
            return Result<UserProfileDto>.Failure(Error.Unauthorized("Mevcut parola hatalı."));

        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
            return Result<UserProfileDto>.Failure(Error.Validation("Yeni parola en az 8 karakter olmalı."));

        if (request.CurrentPassword == request.NewPassword)
            return Result<UserProfileDto>.Failure(Error.Validation("Yeni parola öncekiyle aynı olamaz."));

        user.ConfirmOwnPassword(_passwordHasher.Hash(request.NewPassword));
        await _db.SaveChangesAsync(cancellationToken);
        await LogAuthActivityAsync(user, user.BranchId, "ChangePassword", "Parolasını değiştirdi.", cancellationToken);
        return Result<UserProfileDto>.Success(BuildProfile(user, user.BranchId));
    }

    public async Task<Result<LoginResponse>> CustomerLoginAsync(CustomerLoginRequest request, CancellationToken cancellationToken = default)
    {
        var key = PhoneMask.LoginKey(request.Phone);
        var name = NormalizeName(request.FullName);
        if (key.Length < 10 || string.IsNullOrWhiteSpace(name) || request.BirthDate == default)
            return Result<LoginResponse>.Failure(Error.Unauthorized("Bilgiler eşleşmedi. Ad soyad, telefon ve doğum tarihini kontrol edin."));

        // Ad/telefon şifreli saklandığı için eşleştirme materyalize edilmiş (çözülmüş) değerler üzerinde
        // bellekte yapılır. Doğum tarihiyle birlikte üç bilginin tamamı eşleşmeli.
        var candidates = await _db.Customers
            .IgnoreQueryFilters()
            .Where(c => !c.IsDeleted && c.BirthDate == request.BirthDate)
            .ToListAsync(cancellationToken);

        var matches = candidates
            .Where(c => PhoneMask.LoginKey(c.Phone) == key && NormalizeName(c.FullName) == name)
            .ToList();

        if (matches.Count == 0)
            return Result<LoginResponse>.Failure(Error.Unauthorized("Bilgiler eşleşmedi. Ad soyad, telefon ve doğum tarihini kontrol edin."));

        // Aynı kişi hem bireysel (pazaryeri) hem bir kurumda kayıtlı olabilir. Giriş kimliği olarak
        // bireysel kaydı tercih et (pazaryeri deneyimi); yoksa tek kurum kaydı; birden fazla kurum + bireysel yoksa belirsiz.
        var individualTenantId = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Slug == SystemTenant.IndividualSlug).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(cancellationToken);
        var customer = matches.FirstOrDefault(c => c.TenantId == individualTenantId) ?? (matches.Count == 1 ? matches[0] : null);
        if (customer is null)
            return Result<LoginResponse>.Failure(Error.Conflict("Birden fazla kurumda kaydınız var. Lütfen kurumunuzla iletişime geçin."));

        var tenantAccess = await EnsureCustomerTenantCanLoginAsync(customer.TenantId, cancellationToken);
        if (tenantAccess is not null) return tenantAccess;

        if (customer.IsBlacklisted) return Result<LoginResponse>.Failure(Error.Unauthorized("Hesabınız erişime kapalı. Lütfen kurumunuzla iletişime geçin."));

        if (!IsInMemoryProvider()) customer.RecordLogin(_clock.UtcNow);

        var refreshToken = _tokenService.CreateRefreshToken();
        _db.RefreshTokens.Add(RefreshToken.ForCustomer(customer.Id, _tokenService.HashRefreshToken(refreshToken), _clock.UtcNow.AddDays(30)));
        await _db.SaveChangesAsync(cancellationToken);

        var profile = BuildCustomerProfile(customer);
        var expiresAt = _clock.UtcNow.AddMinutes(60);
        var accessToken = _tokenService.CreateAccessToken(profile, expiresAt);
        return Result<LoginResponse>.Success(new LoginResponse(accessToken, refreshToken, expiresAt, profile));
    }

    /// <summary>Ad soyad eşleştirme anahtarı: kırp, küçült (TR), çoklu boşlukları teke indir.</summary>
    private static string NormalizeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return string.Empty;
        var collapsed = string.Join(' ', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return collapsed.ToLowerInvariant();
    }

    public async Task<Result<LoginResponse>> CustomerRegisterAsync(CustomerRegisterRequest request, CancellationToken cancellationToken = default)
    {
        var name = request.FullName?.Trim() ?? string.Empty;
        var key = PhoneMask.LoginKey(request.Phone);
        if (name.Length < 3 || key.Length < 10 || request.BirthDate == default)
            return Result<LoginResponse>.Failure(Error.Validation("Ad soyad, geçerli telefon ve doğum tarihi zorunludur."));

        var (tenantId, branchId) = await GetOrCreateIndividualTenantAsync(cancellationToken);

        // Aynı kişi (bireysel kayıtta telefon+doğum tarihi) zaten varsa yeni kayıt açma — onunla giriş yap.
        var existingIndividuals = await _db.Customers.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && !c.IsDeleted && c.BirthDate == request.BirthDate)
            .ToListAsync(cancellationToken);
        var customer = existingIndividuals.FirstOrDefault(c => PhoneMask.LoginKey(c.Phone) == key);

        if (customer is null)
        {
            customer = new Customer(tenantId, branchId, name, request.Phone.Trim(), request.Email);
            customer.UpdateProfile(request.BirthDate, request.Gender, kvkkConsent: true, notes: null);
            _db.Customers.Add(customer);
        }

        if (!IsInMemoryProvider()) customer.RecordLogin(_clock.UtcNow);

        var refreshToken = _tokenService.CreateRefreshToken();
        _db.RefreshTokens.Add(RefreshToken.ForCustomer(customer.Id, _tokenService.HashRefreshToken(refreshToken), _clock.UtcNow.AddDays(30)));
        await _db.SaveChangesAsync(cancellationToken);

        var profile = BuildCustomerProfile(customer);
        var expiresAt = _clock.UtcNow.AddMinutes(60);
        var accessToken = _tokenService.CreateAccessToken(profile, expiresAt);
        return Result<LoginResponse>.Success(new LoginResponse(accessToken, refreshToken, expiresAt, profile));
    }

    /// <summary>Bireysel (kuruma bağlı olmayan) müşterilerin tutulduğu sistem kurumunu getirir; yoksa oluşturur.</summary>
    private async Task<(Guid tenantId, Guid branchId)> GetOrCreateIndividualTenantAsync(CancellationToken cancellationToken)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters()
            .Include(t => t.Branches)
            .FirstOrDefaultAsync(t => t.Slug == SystemTenant.IndividualSlug, cancellationToken);
        if (tenant is not null)
        {
            var existingBranch = tenant.Branches.FirstOrDefault();
            if (existingBranch is not null) return (tenant.Id, existingBranch.Id);
            var b = tenant.AddBranch(SystemTenant.IndividualBranchName, "—", isDefault: true);
            await _db.SaveChangesAsync(cancellationToken);
            return (tenant.Id, b.Id);
        }

        tenant = new Tenant(SystemTenant.IndividualName, SystemTenant.IndividualSlug, "Sistem", TenantStatus.Active);
        var branch = tenant.AddBranch(SystemTenant.IndividualBranchName, "—", isDefault: true);
        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync(cancellationToken);
        return (tenant.Id, branch.Id);
    }

    /// <summary>Müşterinin kurumu giriş yapabilir durumda mı? (İptal/askıda ise reddet.)</summary>
    private async Task<Result<LoginResponse>?> EnsureCustomerTenantCanLoginAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<LoginResponse>.Failure(Error.Unauthorized("Kurum kaydı bulunamadı."));
        if (tenant.Status is TenantStatus.Cancelled or TenantStatus.Suspended)
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kurumunuz şu anda hizmet veremiyor. Lütfen kurumunuzla iletişime geçin."));
        return null;
    }

    private static UserProfileDto BuildCustomerProfile(Customer customer) =>
        new(customer.Id, customer.Email ?? customer.Phone, customer.FullName, UserRole.Customer,
            customer.TenantId, customer.BranchId, Array.Empty<string>(), false, customer.Id);

    private async Task<Result<LoginResponse>?> EnsureTenantCanLoginAsync(TenantUser user, UserRole requestedRole, CancellationToken cancellationToken)
    {
        var tenant = user.Tenant;
        if (tenant is null)
        {
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kurum kaydı bulunamadı."));
        }

        var now = _clock.UtcNow;
        if (tenant.Status == TenantStatus.Cancelled)
        {
            return Result<LoginResponse>.Failure(Error.Unauthorized("Kurum iptal edilmiş. Platform yöneticisiyle görüşün."));
        }

        if (tenant.Status == TenantStatus.Trial)
        {
            if (tenant.IsTrialExpired(now))
            {
                tenant.Suspend();
                await _db.SaveChangesAsync(cancellationToken);
                return Result<LoginResponse>.Failure(Error.Unauthorized(TrialExpiredMessage));
            }

            if (!tenant.TrialEndsAtUtc.HasValue)
            {
                if (requestedRole != UserRole.InstitutionOwner)
                {
                    return Result<LoginResponse>.Failure(Error.Unauthorized(TrialPendingOwnerLoginMessage));
                }

                tenant.StartTrial(now);
            }
        }

        // Ücretli abonelik süresi dolmuşsa (Aktif iken) trial gibi askıya alınır.
        if (tenant.Status == TenantStatus.Active && tenant.IsSubscriptionExpired(now))
        {
            tenant.Suspend();
            await _db.SaveChangesAsync(cancellationToken);
            return Result<LoginResponse>.Failure(Error.Unauthorized(SubscriptionExpiredMessage));
        }

        if (tenant.Status == TenantStatus.Suspended)
        {
            var isExpiredTrial = tenant.TrialEndsAtUtc.HasValue && tenant.TrialEndsAtUtc.Value <= now;
            var isExpiredSubscription = tenant.SubscriptionEndsAtUtc.HasValue && tenant.SubscriptionEndsAtUtc.Value <= now;
            var message = isExpiredTrial
                ? TrialExpiredMessage
                : isExpiredSubscription
                    ? SubscriptionExpiredMessage
                    : "Kurum askıya alınmış. Lütfen platform yöneticisiyle görüşün.";
            return Result<LoginResponse>.Failure(Error.Unauthorized(message));
        }

        return null;
    }

    /// <summary>
    /// Cihaz güvenliği kontrolü (yalnızca Staff): tanımlı cihaz → geçir; boş slot varsa cihazı
    /// otomatik tanımla; limit doluysa girişi engelle ve "Security.UnauthorizedDevice" logu düş.
    /// Null dönerse giriş devam eder.
    /// </summary>
    private async Task<Result<LoginResponse>?> EnforceDeviceControlAsync(TenantUser user, LoginRequest request, CancellationToken cancellationToken)
    {
        var deviceId = request.DeviceId?.Trim() ?? _currentUser.DeviceId;
        var now = _clock.UtcNow;
        var ip = _currentUser.IpAddress;
        var device = request.Device;

        if (string.IsNullOrWhiteSpace(deviceId))
        {
            await LogUnauthorizedDeviceAsync(user, null, device, ip, "Cihaz kimliği gönderilmedi.", cancellationToken);
            return Result<LoginResponse>.Failure(Error.Unauthorized("Cihaz güvenliği etkin: cihaz kimliği doğrulanamadı. Lütfen güncel uygulama/tarayıcı ile giriş yapın."));
        }

        var devices = await _db.StaffDevices
            .IgnoreQueryFilters()
            .Where(d => d.TenantUserId == user.Id && !d.IsDeleted)
            .ToListAsync(cancellationToken);

        var known = devices.FirstOrDefault(d => string.Equals(d.DeviceId, deviceId, StringComparison.Ordinal));
        if (known is not null)
        {
            known.RecordSeen(now, device?.UserAgent, device?.NetworkInfoJson, ip);
            await _db.SaveChangesAsync(cancellationToken);
            return null;
        }

        // Boş slot varsa cihaz otomatik tanımlanır; personel panelden adlandırabilir.
        if (user.MaxDeviceCount is null || devices.Count < user.MaxDeviceCount.Value)
        {
            var name = !string.IsNullOrWhiteSpace(device?.Name)
                ? device!.Name!
                : DeriveDeviceName(device?.DeviceType, device?.Platform, devices.Count + 1);
            _db.StaffDevices.Add(new StaffDevice(user.TenantId, user.Id, deviceId, name, device?.DeviceType, device?.UserAgent, device?.NetworkInfoJson, ip, now));
            await _db.SaveChangesAsync(cancellationToken);
            await _audit.LogActorAsync(
                user.TenantId, user.BranchId, user.Id, user.FullName ?? user.Email, user.Role.ToString(),
                "Security.DeviceRegistered", "Security", user.Id,
                $"{user.FullName ?? user.Email} adlı personel için yeni cihaz tanımlandı: {name}.",
                new { deviceId, device }, ip, cancellationToken);
            return null;
        }

        await LogUnauthorizedDeviceAsync(user, deviceId, device, ip,
            $"Cihaz limiti ({user.MaxDeviceCount}) dolu — tanımsız cihazdan giriş engellendi.", cancellationToken);
        return Result<LoginResponse>.Failure(Error.Unauthorized(
            "Bu cihaz sizin için tanımlı değil. Cihaz güvenliği etkin olduğundan yalnızca tanımlı cihazlarınızdan giriş yapabilirsiniz. Kurum yöneticinizle iletişime geçin."));
    }

    private async Task LogUnauthorizedDeviceAsync(TenantUser user, string? deviceId, LoginDeviceDto? device, string? ip, string reason, CancellationToken cancellationToken)
    {
        await _audit.LogActorAsync(
            user.TenantId, user.BranchId, user.Id, user.FullName ?? user.Email, user.Role.ToString(),
            "Security.UnauthorizedDevice", "Security", user.Id,
            $"UYARI: {user.FullName ?? user.Email} adlı personel FARKLI (tanımsız) bir cihazdan giriş yapmaya çalıştı!",
            new { reason, deviceId, device, ip }, ip, cancellationToken);

        // Kurum/şube yöneticisine güvenlik bildirimi (gün başına tek → dedupe). Kritik önem.
        await _notifications.NotifyRolesAsync(
            user.TenantId, user.BranchId,
            new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
            AppNotificationType.UnauthorizedDevice, AppNotificationSeverity.Critical,
            "Yetkisiz cihaz girişi",
            $"{user.FullName ?? user.Email} tanımsız bir cihazdan giriş denedi.",
            data: new { route = "/logs" },
            dedupeKey: $"unauthdevice:{user.Id}:{_clock.UtcNow:yyyyMMdd}",
            ct: cancellationToken);
    }

    private static string DeriveDeviceName(string? deviceType, string? platform, int index)
    {
        var baseName = deviceType?.ToLowerInvariant() switch
        {
            "mobile" => "Cep Telefonu",
            "tablet" => "Tablet",
            "pc" or "desktop" => "Bilgisayar",
            _ => null,
        } ?? (string.IsNullOrWhiteSpace(platform) ? "Cihaz" : platform.Trim());
        return $"{baseName} {index}";
    }

    private async Task LogAuthActivityAsync(TenantUser user, Guid? branchId, string action, string summary, CancellationToken cancellationToken)
    {
        if (!ShouldAuditInstitutionActor(user.Role)) return;

        await _audit.LogActorAsync(
            user.TenantId,
            branchId,
            user.Id,
            user.Email,
            user.Role.ToString(),
            action,
            "Auth",
            user.Id,
            summary,
            new
            {
                userId = user.Id,
                user.Email,
                role = user.Role.ToString(),
                tenantId = user.TenantId,
                branchId
            },
            _currentUser.IpAddress,
            cancellationToken);
    }

    private static bool ShouldAuditInstitutionActor(UserRole role) =>
        role is UserRole.InstitutionOwner or UserRole.BranchManager or UserRole.Staff;

    private static UserProfileDto BuildProfile(TenantUser user, Guid? branchId)
    {
        // Staff için DB'de saklanan kişisel izinler; PlatformAdmin/Owner için role-based default izinler
        var permissions = user.Role == UserRole.Staff
            ? ParseCsv(user.Permissions)
            : RolePermissions.NamesFor(user.Role);
        return new UserProfileDto(user.Id, user.Email, user.FullName, user.Role, user.TenantId, branchId, permissions, user.MustChangePassword);
    }

    private static IReadOnlyCollection<string> ParseCsv(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return Array.Empty<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private bool IsInMemoryProvider() =>
        _db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true;
}

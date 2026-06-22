using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
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

    public AuthService(
        GuzellikDbContext db,
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        IDateTimeProvider clock,
        IAuditLogger audit,
        ICurrentUser currentUser)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _clock = clock;
        _audit = audit;
        _currentUser = currentUser;
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
            .Include(x => x.TenantUser).ThenInclude(x => x!.Tenant)
            .FirstOrDefaultAsync(x => x.TokenHash == hash, cancellationToken);
        if (token?.TenantUser is null || !token.IsActive(_clock.UtcNow)) return Result<LoginResponse>.Failure(Error.Unauthorized("Refresh token geçersiz."));

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
        _db.RefreshTokens.Add(new RefreshToken(token.TenantUserId, newHash, nowUtc.AddDays(14)));
        await _db.SaveChangesAsync(cancellationToken);

        var profile = BuildProfile(token.TenantUser, token.TenantUser.BranchId);
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

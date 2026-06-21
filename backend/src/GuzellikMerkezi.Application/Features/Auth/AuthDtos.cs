using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Auth;

// Role boş gönderilirse backend e-postadan en yetkili aktif rolü tespit edip yanıtın Role alanında döner.
public sealed record LoginScopeRequest(string Email, UserRole? Role = null);
public sealed record LoginScopeTenantDto(Guid TenantId, string TenantName, string Status, IReadOnlyCollection<LoginScopeBranchDto> Branches);
public sealed record LoginScopeBranchDto(Guid BranchId, string BranchName, string City, bool IsDefault);
public sealed record LoginScopeResponse(string Email, UserRole? Role, IReadOnlyCollection<LoginScopeTenantDto> Tenants);

public sealed record LoginRequest(string Email, string Password, UserRole Role, Guid? TenantId, Guid? BranchId);
public sealed record RefreshTokenRequest(string RefreshToken);
public sealed record LoginResponse(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc, UserProfileDto User);
public sealed record UserProfileDto(Guid UserId, string Email, string? FullName, UserRole Role, Guid? TenantId, Guid? BranchId, IReadOnlyCollection<string> Permissions, bool MustChangePassword);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

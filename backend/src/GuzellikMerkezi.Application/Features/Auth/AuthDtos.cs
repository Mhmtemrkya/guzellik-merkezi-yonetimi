using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Auth;

// Role boş gönderilirse backend e-postadan en yetkili aktif rolü tespit edip yanıtın Role alanında döner.
public sealed record LoginScopeRequest(string Email, UserRole? Role = null);
public sealed record LoginScopeTenantDto(Guid TenantId, string TenantName, string Status, IReadOnlyCollection<LoginScopeBranchDto> Branches);
public sealed record LoginScopeBranchDto(Guid BranchId, string BranchName, string City, bool IsDefault);
public sealed record LoginScopeResponse(string Email, UserRole? Role, IReadOnlyCollection<LoginScopeTenantDto> Tenants);

public sealed record LoginRequest(string Email, string Password, UserRole Role, Guid? TenantId, Guid? BranchId, string? DeviceId = null, LoginDeviceDto? Device = null);

/// <summary>İstemcinin login sırasında beyan ettiği cihaz bilgisi (cihaz güvenliği + log zenginleştirme).</summary>
public sealed record LoginDeviceDto(string? Name = null, string? DeviceType = null, string? Platform = null, string? UserAgent = null, string? NetworkInfoJson = null);

// Online portal müşteri girişi: ad soyad + telefon (baştaki 0 ile) + doğum tarihi eşleşmesi (şifresiz).
// (Faz 2'de bu eşleşmenin üzerine SMS OTP doğrulaması eklenecek.)
public sealed record CustomerLoginRequest(string FullName, string Phone, DateOnly BirthDate);

// Kendi kayıt olan (kuruma bağlı olmayan) müşteri. TC yok; e-posta opsiyonel.
public sealed record CustomerRegisterRequest(string FullName, string Phone, DateOnly BirthDate, GuzellikMerkezi.Domain.Enums.Gender Gender, string? Email);

public sealed record RefreshTokenRequest(string RefreshToken);
public sealed record LoginResponse(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc, UserProfileDto User);
public sealed record UserProfileDto(Guid UserId, string Email, string? FullName, UserRole Role, Guid? TenantId, Guid? BranchId, IReadOnlyCollection<string> Permissions, bool MustChangePassword, Guid? CustomerId = null);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

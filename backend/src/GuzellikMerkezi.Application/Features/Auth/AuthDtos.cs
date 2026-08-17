using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Auth;

// Role boş gönderilirse backend e-postadan en yetkili aktif rolü tespit edip yanıtın Role alanında döner.
/// <summary>
/// Kurum/şube seçimi için kapsam sorgusu.
/// <para>
/// <paramref name="Password"/> ZORUNLUDUR: uç eskiden yalnız e-postayla kurum adı/durumu, şube
/// adı/şehri ve rolü döndürüyordu; geçerli kullanıcılar, kurumlar ve şubeler anonim olarak
/// keşfedilebiliyordu (hedefli phishing/credential stuffing için bağlam). Parola doğrulanmazsa
/// yanıt BOŞ döner — hesabın var olup olmadığı ayırt edilemez.
/// </para>
/// </summary>
public sealed record LoginScopeRequest(string Email, UserRole? Role = null, string? Password = null);
public sealed record LoginScopeTenantDto(Guid TenantId, string TenantName, string Status, IReadOnlyCollection<LoginScopeBranchDto> Branches);
public sealed record LoginScopeBranchDto(Guid BranchId, string BranchName, string City, bool IsDefault);
public sealed record LoginScopeResponse(string Email, UserRole? Role, IReadOnlyCollection<LoginScopeTenantDto> Tenants);

public sealed record LoginRequest(string Email, string Password, UserRole Role, Guid? TenantId, Guid? BranchId, string? DeviceId = null, LoginDeviceDto? Device = null);

/// <summary>İstemcinin login sırasında beyan ettiği cihaz bilgisi (cihaz güvenliği + log zenginleştirme).</summary>
public sealed record LoginDeviceDto(string? Name = null, string? DeviceType = null, string? Platform = null, string? UserAgent = null, string? NetworkInfoJson = null);

/// <summary>
/// Online portal müşteri girişinin KİMLİĞİ: ad soyad + telefon. Şifre yoktur; kimlik yalnızca
/// doğrulama kodu (OTP) ile birlikte anlam taşır.
/// </summary>
/// <remarks>
/// DOĞUM TARİHİ BİLEREK YOKTUR. Girişte doğum tarihi sormak, App Store 5.1.1(v) kuralına
/// ("uygulama, çekirdek işlevi için gerekli olmayan kişisel bilgiyi ZORUNLU tutamaz") takılıyordu:
/// randevu almak için doğum tarihi gerekmez. Kimlik doğrulamasının gerçek kanıtı zaten kodun
/// gittiği kanaldır (telefon ya da kayıtlı e-posta) — doğum tarihi yalnızca zayıf bir "bilgi"
/// faktörüydü. Eski istemciler alanı göndermeye devam edebilir; uç kabul edip YOK SAYAR
/// (bkz. CustomerOtpRequestBody).
/// </remarks>
public sealed record CustomerLoginRequest(string FullName, string Phone);

/// <summary>
/// Kendi kayıt olan (kuruma bağlı olmayan) müşteri. TC yok; e-posta ve doğum tarihi OPSİYONEL —
/// doğum tarihi yalnızca müşteri kendi isterse profiline yazılır (doğum günü kampanyaları için).
/// </summary>
public sealed record CustomerRegisterRequest(string FullName, string Phone, DateOnly? BirthDate, GuzellikMerkezi.Domain.Enums.Gender Gender, string? Email);

public sealed record RefreshTokenRequest(string RefreshToken);
public sealed record LoginResponse(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc, UserProfileDto User);
public sealed record UserProfileDto(Guid UserId, string Email, string? FullName, UserRole Role, Guid? TenantId, Guid? BranchId, IReadOnlyCollection<string> Permissions, bool MustChangePassword, Guid? CustomerId = null);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

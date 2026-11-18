using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.TenantSignup;

namespace GuzellikMerkezi.Application.Features.Connector;

// KAYIT MAYDANOZ'DA (kullanıcı kararı 18 Kas 2026): kurum maydanozasist.com/kayit/beauty'de belgeleriyle
// başvurur, Maydanoz yöneticisi onaylayınca hesap BURADA açılır (14 gün deneme). Doğrulama kodlarını ve
// e-postaları BeautyAsist gönderir (Maydanoz'da e-posta altyapısı yok); başvuru, belgeler ve inceleme
// Maydanoz'dadır. Uçlar yalnız imzalı bağlayıcıdan çağrılır (bkz. ConnectorEndpoints).

/// <summary>Doğrulama adımının sonucu: sıradaki adım <c>phone</c> ya da <c>done</c>.</summary>
public sealed record ConnectorApplicationStepDto(string NextStep, string? MaskedPhone = null, string? Channel = null, string? DevCode = null)
{
    public const string StepPhone = "phone";
    public const string StepDone = "done";
}

/// <summary>1. adım: başvuru bilgileri (mevcut kayıt formunun alanları); e-postaya kod gider.</summary>
public sealed record ConnectorApplicationStartRequest(
    string? TenantName, string? OwnerName, string? Email, string? Phone, string? BranchName, string? City, string? PhoneChannel = null);

public sealed record ConnectorApplicationStartDto(string VerificationId, string MaskedEmail, string? DevCode = null);

public sealed record ConnectorApplicationCodeRequest(string? VerificationId, string? Code);

public sealed record ConnectorApplicationResendRequest(string? VerificationId);

/// <summary>Maydanoz onayı: hesap bu bilgilerle açılır. <c>ApplicationId</c> tekrar korumasıdır.</summary>
public sealed record ConnectorApplicationApproveRequest(
    string? ApplicationId, string? TenantName, string? OwnerName, string? Email, string? Phone, string? BranchName, string? City,
    string? LegalName = null, string? TaxOffice = null, string? TaxNumber = null, string? LoginUrl = null);

public sealed record ConnectorApplicationApprovedDto(Guid TenantId, string Code, string LoginUrl, bool Created, bool EmailSent);

/// <summary>Başvuru e-postası: <c>received</c> (alındı) ya da <c>rejected</c> (onaylanmadı; gerekçe zorunlu).</summary>
public sealed record ConnectorApplicationNotifyRequest(
    string? Kind, string? ApplicationId, string? Email, string? OwnerName, string? TenantName, string? Reason = null, string? Link = null);

public sealed record ConnectorApplicationNotifyDto(bool Sent);

public interface IConnectorApplications
{
    Task<Result<TenantSignupReadinessDto>> ReadinessAsync(CancellationToken ct = default);

    Task<Result<ConnectorApplicationStartDto>> StartVerificationAsync(ConnectorApplicationStartRequest request, CancellationToken ct = default);

    Task<Result<ConnectorApplicationStepDto>> VerifyApplicationEmailAsync(ConnectorApplicationCodeRequest request, CancellationToken ct = default);

    Task<Result<ConnectorApplicationStepDto>> VerifyApplicationPhoneAsync(ConnectorApplicationCodeRequest request, CancellationToken ct = default);

    Task<Result<object>> ResendApplicationCodeAsync(ConnectorApplicationResendRequest request, CancellationToken ct = default);

    Task<Result<ConnectorApplicationApprovedDto>> ApproveAsync(ConnectorApplicationApproveRequest request, CancellationToken ct = default);

    Task<Result<ConnectorApplicationNotifyDto>> NotifyAsync(ConnectorApplicationNotifyRequest request, CancellationToken ct = default);
}

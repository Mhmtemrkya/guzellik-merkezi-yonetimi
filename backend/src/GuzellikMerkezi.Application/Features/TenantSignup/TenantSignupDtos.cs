using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Tenants;

namespace GuzellikMerkezi.Application.Features.TenantSignup;

/// <summary>
/// SELF-SERVİS KURUM KAYDI — 14 günlük ücretsiz deneme.
///
/// <para>
/// Akış ÜÇ adımdır ve her adım bir sonrakinin ön koşuludur:
/// <list type="number">
///   <item><b>start</b> — bilgiler alınır, e-postaya kod gider.</item>
///   <item><b>verify-email</b> — e-posta kodu doğrulanır, telefona kod gider.</item>
///   <item><b>verify-phone</b> — telefon kodu doğrulanır, KURUM OLUŞUR + oturum açılır.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Kurum son adımda oluşur.</b> Erken oluşturup "doğrulanmadı" işaretlemek, yarım kalan her
/// denemeyi veritabanına yazar (kurum kodu tüketilir, isim/slug kilitlenir, platform listesi
/// çöplenir). Doğrulanmamış kayıt bellekte tutulur ve süresi dolunca kendiliğinden kaybolur.
/// </para>
/// </summary>
public sealed record TenantSignupStartRequest(
    string TenantName,
    string OwnerName,
    string Email,
    string Phone,
    string BranchName,
    string City);

/// <summary>Adım 1 yanıtı — hangi adrese kod gittiği MASKELİ döner (yazım hatası fark edilsin).</summary>
public sealed record TenantSignupStartResponse(
    string SignupId,
    string MaskedEmail,
    /// <summary>Geliştirme ortamında kodu da döndürür; canlıda her zaman null.</summary>
    string? DevCode = null);

public sealed record TenantSignupVerifyEmailRequest(string SignupId, string Code);

/// <summary>
/// Adım 2 yanıtı — telefon kodunun gittiği kanal ve maskeli numara.
/// </summary>
/// <remarks>
/// <paramref name="Channel"/> "whatsapp" ya da "sms" olur. İkinci faktör "WhatsApp" değil
/// <b>telefon sahipliğidir</b>: WhatsApp kuruluysa oradan, değilse SMS'ten gider. WhatsApp'a
/// mahkûm etmek App Store 3.2.2(v) reddinin ta kendisiydi.
/// </remarks>
public sealed record TenantSignupVerifyEmailResponse(
    string MaskedPhone,
    string Channel,
    string? DevCode = null);

public sealed record TenantSignupVerifyPhoneRequest(string SignupId, string Code);

/// <summary>
/// Adım 3 yanıtı — kurum oluştu.
/// </summary>
/// <remarks>
/// <paramref name="Credentials"/> geçici parolayı DÜZ METİN taşır; PDF'i üretebilmek için tek
/// fırsat budur (parola bundan sonra yalnız hash olarak saklanır). <paramref name="Session"/>
/// verildiği için kullanıcı ayrıca giriş yapmak zorunda kalmaz.
/// </remarks>
public sealed record TenantSignupCompletedResponse(
    string TenantCode,
    TenantDto Tenant,
    TenantCredentialsDto Credentials,
    Auth.LoginResponse Session);

/// <summary>Kayıt akışının hangi kanalların kullanılabilir olduğunu bilmesi gerekir.</summary>
public sealed record TenantSignupReadinessDto(bool Email, bool Phone, bool CanSignup);

public interface ITenantSignupService
{
    /// <summary>Kayıt açılabilir mi? (E-posta kanalı zorunlu, telefon kanalı zorunlu.)</summary>
    Task<Result<TenantSignupReadinessDto>> GetReadinessAsync(CancellationToken ct = default);

    Task<Result<TenantSignupStartResponse>> StartAsync(TenantSignupStartRequest request, CancellationToken ct = default);
    Task<Result<TenantSignupVerifyEmailResponse>> VerifyEmailAsync(TenantSignupVerifyEmailRequest request, CancellationToken ct = default);
    Task<Result<TenantSignupCompletedResponse>> VerifyPhoneAsync(TenantSignupVerifyPhoneRequest request, CancellationToken ct = default);

    /// <summary>Kodu yeniden gönderir (hangi adımdaysa o kanala).</summary>
    Task<Result<object>> ResendAsync(string signupId, CancellationToken ct = default);
}

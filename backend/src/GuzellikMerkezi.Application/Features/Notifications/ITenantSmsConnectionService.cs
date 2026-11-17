using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformMessaging;

namespace GuzellikMerkezi.Application.Features.Notifications;

/// <summary>
/// KURUMUN KENDİ SMS HESABI (Verimor/Netgsm numarası/başlığı) — bağlantıyı PLATFORM (BeautyAsist)
/// kurar ve yönetir; kurum yalnız durumu görür (WhatsApp bağlantısıyla aynı model).
///
/// <para>
/// Bağlantı açık ve bir test SMS'iyle doğrulanmışsa kurumun müşteri SMS'leri o hesaptan gider;
/// BeautyAsist kotası ve mesaj kredisi düşmez (ücreti kurumun sağlayıcısı keser). Doğrulanmamış
/// ya da kapalı bağlantıda gönderim platform altyapısından (kota → kredi) devam eder.
/// </para>
/// </summary>
public interface ITenantSmsConnectionService
{
    /// <param name="canManage">İsteyen kullanıcı bağlantıyı değiştirebilir mi (yalnız platform yöneticisi)?</param>
    Task<Result<SmsConnectionDto>> GetAsync(Guid tenantId, bool canManage, CancellationToken cancellationToken = default);

    /// <summary>Platform: tüm kurumlar + SMS bağlantı durumları (iki sorgu; kurum başına sorgu yok).</summary>
    Task<Result<IReadOnlyList<PlatformSmsConnectionDto>>> ListAsync(CancellationToken cancellationToken = default);

    Task<Result<SmsConnectionDto>> SaveAsync(Guid tenantId, SaveSmsConnectionRequest request, CancellationToken cancellationToken = default);

    /// <summary>Kayıtlı hesapla test SMS'i gönderir; başarılıysa bağlantı doğrulanır (etkinleşir).</summary>
    Task<Result<SmsConnectionTestResultDto>> TestAsync(Guid tenantId, TestSmsConnectionRequest request, CancellationToken cancellationToken = default);

    /// <summary>Bağlantıyı kaldırır (satır ve şifreli kimlik bilgisi gerçekten silinir).</summary>
    Task<Result<SmsConnectionDto>> DisconnectAsync(Guid tenantId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gönderim anında: ETKİN bağlantının çözülmüş kimlik bilgisi, yoksa null. Kurum kapsamı
    /// olmayan çağrıda (arka plan işleri) da çalışır — sorgu filtreleri aşılıp TenantId açıkça süzülür.
    /// </summary>
    Task<SmsAccountCredentials?> ResolveActiveAsync(Guid tenantId, CancellationToken cancellationToken = default);
}

/// <summary>Kurumun SMS hesabı bağlantısı — parola ASLA dönmez, kullanıcı adı yalnız ipucuyla.</summary>
public sealed record SmsConnectionDto(
    /// <summary>NotConnected | PendingTest | Failed | Connected | Disabled</summary>
    string Status,
    /// <summary>Gönderim şu an bu hesaptan mı yapılıyor (açık + doğrulanmış)?</summary>
    bool Active,
    string? Provider,
    string? UsernameHint,
    bool HasPassword,
    string? Sender,
    bool Enabled,
    DateTime? VerifiedAtUtc,
    DateTime? LastTestAtUtc,
    string? LastError,
    /// <summary>İsteyen kullanıcı değiştirebilir mi (yalnız kurum sahibi / platform yöneticisi)?</summary>
    bool CanManage,
    /// <summary>Sağlayıcı panelinde izin verilmesi gereken sunucu IP'si (yapılandırılmışsa).</summary>
    string? ServerIp,
    /// <summary>Test SMS'i için önerilen numara (kurumun iletişim telefonu).</summary>
    string? SuggestedTestPhone,
    IReadOnlyList<string> Providers,
    /// <summary>
    /// Paket SMS içeriyor mu? Kendi hesap da paket kapısına tabidir; false ise bağlama/test 409 döner.
    /// </summary>
    bool SmsFeatureAllowed = true);

/// <summary>
/// Kaydetme. <paramref name="Username"/> ve <paramref name="Password"/> boşsa MEVCUT değer korunur
/// (istemci kayıtlı parolayı bilmez). İlk bağlantıda üçü de zorunludur.
/// </summary>
public sealed record SaveSmsConnectionRequest(
    string? Provider,
    string? Username,
    string? Password,
    string? Sender,
    bool Enabled = true);

public sealed record TestSmsConnectionRequest(string? Phone);

/// <summary>Platform listesindeki satır: kurum + paketi + SMS bağlantısı.</summary>
public sealed record PlatformSmsConnectionDto(
    Guid TenantId,
    string TenantName,
    string? PlanName,
    SmsConnectionDto Connection);

public sealed record SmsConnectionTestResultDto(bool Sent, string? Error, SmsConnectionDto Connection);

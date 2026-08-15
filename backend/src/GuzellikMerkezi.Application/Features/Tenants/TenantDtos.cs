using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Tenants;

public sealed record TenantDto(
    Guid Id,
    string Name,
    string Slug,
    string Plan,
    TenantStatus Status,
    string? Domain,
    string? OwnerName,
    string? Phone,
    string? TaxNumber,
    string Currency,
    int MaxInstallments,
    int OverdueGraceDays,
    int BranchCount,
    Guid? SubscriptionPlanId,
    string? SubscriptionPlanKey,
    string? SubscriptionPlanName,
    decimal SubscriptionPlanMonthlyPriceTRY,
    DateTime? TrialEndsAtUtc,
    string? LegalName = null,
    string? TaxOffice = null,
    string? Email = null,
    string? SubscriptionPeriod = null,
    DateTime? SubscriptionEndsAtUtc = null,
    decimal SubscriptionPlanYearlyPriceTRY = 0);

/// <summary>
/// Kurum oluşturma isteği. <see cref="BillingPeriod"/> değeri "Trial" (varsayılan), "Monthly" veya "Yearly".
/// "Monthly"/"Yearly" seçilirse <see cref="Plan"/> adına karşılık gelen aktif paketle ücretli abonelik
/// hemen başlatılır (durum Aktif, süre = oluşturma + 1 ay/yıl); "Trial" ise 14 günlük deneme akışı işler.
/// </summary>
public sealed record CreateTenantRequest(string Name, string Slug, string Plan, string? Domain, string? OwnerName, string? OwnerEmail, string? InitialPassword, string? DefaultBranchName, string? DefaultBranchCity, string? Phone = null, string? Email = null, string? BillingPeriod = null, IReadOnlyList<TenantAdditionalOwnerInput>? AdditionalOwners = null,
    /// <summary>
    /// Kurum logosu (base64 data-URL) — vitrin profiline yazılır.
    ///
    /// <para>Logoyu normalde kurum yöneticisi Salon Profili'nden yükler; burada da verilebilmesinin
    /// sebebi, kurum oluşturulur oluşturulmaz üretilen GİRİŞ BİLGİLERİ BELGESİNİN logolu çıkması.
    /// Kurum isterse sonradan değiştirir — bu alan bir başlangıç değeridir, kilit değil.</para>
    /// </summary>
    string? LogoData = null);

/// <summary>
/// Kurum oluşturulurken eklenen ek kurum yöneticisi. E-posta boş bırakılırsa
/// ad + kurum domaininden otomatik üretilir; her yönetici için geçici şifre oluşturulur.
/// </summary>
public sealed record TenantAdditionalOwnerInput(string? Name, string? Email);

/// <summary>
/// Kurum oluşturulurken şifre girilmediyse otomatik üretilen yetkili giriş bilgileri.
/// Plaintext şifre yalnızca bu response'ta döner, sonra hash'lenir.
/// </summary>
public sealed record TenantCredentialsDto(
    Guid TenantId,
    string OwnerName,
    string Email,
    string InitialPassword,
    string TenantName,
    string? BranchName,
    bool MustChangePassword,
    DateTime CreatedAtUtc);

/// <summary>
/// <see cref="Credentials"/> geriye uyumluluk için ilk yöneticinin bilgilerini taşır;
/// <see cref="AllCredentials"/> otomatik şifre üretilen TÜM yöneticileri (birincil + ek) içerir.
/// </summary>
public sealed record TenantWithCredentialsDto(TenantDto Tenant, TenantCredentialsDto? Credentials, IReadOnlyList<TenantCredentialsDto>? AllCredentials = null);

/// <summary>Kullanım kılavuzu sıfırlama zamanı — null ise hiç sıfırlanmamış.</summary>
public sealed record GuideResetDto(DateTime? ResetAtUtc);

public sealed record TenantAvailabilityDto(
    string? Name,
    string SuggestedName,
    bool NameAvailable,
    string SuggestedSlug,
    bool SlugAvailable,
    string SuggestedDomain,
    bool DomainAvailable,
    string SuggestedOwnerEmail,
    bool OwnerEmailAvailable,
    IReadOnlyCollection<TenantAvailabilityConflictDto> Conflicts);

public sealed record TenantAvailabilityConflictDto(string Field, string? Value, string Message, string? SuggestedValue);

/// <summary>
/// KURUMUN KENDİ PROFİL GÜNCELLEMESİ — abonelik alanı TAŞIMAZ.
///
/// <para>
/// Kurum yöneticisi <c>PUT /api/admin/tenant</c> ile <see cref="UpdateTenantRequest"/> gönderiyordu;
/// o DTO <c>Plan</c>, <c>Status</c> ve <c>BillingPeriod</c> taşıdığı için servis
/// <c>StartSubscription</c> / <c>AssignSubscriptionPlan</c> / <c>ResetTrialForNextOwnerLogin</c>
/// yollarını çalıştırıyordu: ödeme sağlayıcısına, callback'e ve platform onayına HİÇ uğramadan
/// ücretli paket aktive edilebiliyor, dönem değiştirilebiliyor, askıya alınmış kurum yeniden
/// aktif/deneme yapılabiliyordu (<c>/upgrade</c> kapısı tamamen baypas). Abonelik yalnız
/// doğrulanmış billing sonucu ya da PlatformAdmin komutuyla değişir.
/// </para>
/// </summary>
public sealed record UpdateTenantProfileRequest(
    string Name,
    string? Domain,
    string? OwnerName,
    string? Phone,
    string? TaxNumber,
    string? Currency,
    int? MaxInstallments,
    int? OverdueGraceDays,
    string? LegalName = null,
    string? TaxOffice = null,
    string? Email = null);

/// <summary>PLATFORM YÖNETİCİSİNE ÖZEL tam güncelleme (abonelik alanları dâhil).</summary>
public sealed record UpdateTenantRequest(
    string Name,
    string Plan,
    TenantStatus Status,
    string? Domain,
    string? OwnerName,
    string? Phone,
    string? TaxNumber,
    string? Currency,
    int? MaxInstallments,
    int? OverdueGraceDays,
    string? LegalName = null,
    string? TaxOffice = null,
    string? Email = null,
    /// <summary>"Trial" | "Monthly" | "Yearly". Paket veya dönem değişirse ücretli abonelik yeniden başlatılır.</summary>
    string? BillingPeriod = null);

public sealed record GrantTenantAccessRequest(string Email, string? FullName, UserRole Role, Guid? BranchId, string? InitialPassword);

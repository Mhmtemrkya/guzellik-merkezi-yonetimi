using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class Tenant : Entity
{
    private Tenant() { }

    /// <summary>Yeni tenant'lar için varsayılan deneme süresi.</summary>
    public const int DefaultTrialDays = 14;

    public Tenant(string name, string slug, string plan, TenantStatus status = TenantStatus.Trial)
    {
        Rename(name);
        Slug = NormalizeSlug(slug);
        Plan = string.IsNullOrWhiteSpace(plan) ? "Başlangıç" : plan.Trim();
        Status = status;
        // Trial sayaç artık kurum oluşturulduğu anda değil, kurum yöneticisinin ilk girişinde başlar.
        TrialEndsAtUtc = null;
    }

    public string Name { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public string Plan { get; private set; } = "Başlangıç";
    public TenantStatus Status { get; private set; } = TenantStatus.Trial;
    public string? Domain { get; private set; }
    public string? OwnerName { get; private set; }
    public string? Phone { get; private set; }
    public string? TaxNumber { get; private set; }
    /// <summary>Yasal işletme adı (ticari unvan).</summary>
    public string? LegalName { get; private set; }
    /// <summary>Vergi dairesi.</summary>
    public string? TaxOffice { get; private set; }
    /// <summary>Kurumsal iletişim e-postası.</summary>
    public string? Email { get; private set; }
    public string Currency { get; private set; } = "TRY";
    public int MaxInstallments { get; private set; } = 12;
    public int OverdueGraceDays { get; private set; } = 3;
    /// <summary>Pasif müşteri eşiği (gün): bu kadar gündür randevu/paket işlemi olmayan müşteri "pasif" listesine düşer.</summary>
    public int PassiveCustomerThresholdDays { get; private set; } = 60;

    public void SetPassiveCustomerThreshold(int days)
    {
        PassiveCustomerThresholdDays = days < 1 ? 60 : days;
        Touch();
    }

    /// <summary>
    /// Çalışma saatleri (mesai penceresi) kısıtı kurum genelinde uygulanır mı?
    /// Kapalıysa personel şablonları saklanır ama randevu alırken denetlenmez.
    /// </summary>
    public bool EnforceWorkingHours { get; private set; } = true;

    public void SetEnforceWorkingHours(bool enabled)
    {
        EnforceWorkingHours = enabled;
        Touch();
    }

    /// <summary>
    /// Cihaz güvenliği (kısıtlama) kurum tarafından açık mı? Paket security.devicecontrol
    /// içeriyorsa yönetici bu anahtarla akışı devreye alır: personel yalnızca tanımlı
    /// cihazlarından giriş yapabilir, loglara cihaz kimliği/ağ bilgisi düşer.
    /// </summary>
    public bool DeviceControlEnabled { get; private set; }

    public void SetDeviceControl(bool enabled)
    {
        DeviceControlEnabled = enabled;
        Touch();
    }

    /// <summary>
    /// Personel mobil uygulamada ekran görüntüsü alabilir mi? Kapalıyken (varsayılan)
    /// personel cihazlarında FLAG_SECURE uygulanır; kurum yöneticisi izin verirse açılır.
    /// </summary>
    public bool AllowStaffScreenshots { get; private set; }

    public void SetAllowStaffScreenshots(bool allowed)
    {
        AllowStaffScreenshots = allowed;
        Touch();
    }

    /// <summary>
    /// Kullanım kılavuzu sıfırlama zamanı. Platform admin sıfırlayınca güncellenir;
    /// panel bu tarihten önce "görüldü" işaretlenmiş kılavuzları yeniden gösterir.
    /// </summary>
    public DateTime? GuideResetAtUtc { get; private set; }

    public void ResetGuide()
    {
        GuideResetAtUtc = DateTime.UtcNow;
        Touch();
    }

    /// <summary>Aktif abonelik paketinin Id'si. Null ise plan henüz atanmamış demektir.</summary>
    public Guid? SubscriptionPlanId { get; private set; }
    public SubscriptionPlan? SubscriptionPlan { get; private set; }

    /// <summary>Trial dönemi bitiş tarihi. Null ise süresiz; süre dolduğunda otomatik Suspended olur.</summary>
    public DateTime? TrialEndsAtUtc { get; private set; }

    /// <summary>Aktif ücretli aboneliğin dönemi (Aylık/Yıllık). Null ise henüz ücretli abonelik başlamamış (deneme veya süresiz).</summary>
    public BillingPeriod? SubscriptionPeriod { get; private set; }

    /// <summary>Ücretli abonelik bitiş tarihi. Null ise süresiz; süre dolduğunda trial gibi otomatik Suspended olur.</summary>
    public DateTime? SubscriptionEndsAtUtc { get; private set; }

    public ICollection<Branch> Branches { get; private set; } = new List<Branch>();
    public ICollection<TenantUser> Users { get; private set; } = new List<TenantUser>();

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Kurum adı boş olamaz.");
        Name = name.Trim();
        Touch();
    }

    public void ChangePlan(string plan)
    {
        if (string.IsNullOrWhiteSpace(plan)) throw new DomainException("Plan boş olamaz.");
        Plan = plan.Trim();
        Touch();
    }

    /// <summary>Plan kataloğundan yeni paketi atar. Plan string alanı senkron kalsın diye birlikte güncellenir.</summary>
    public void AssignSubscriptionPlan(SubscriptionPlan plan)
    {
        if (plan is null) throw new DomainException("Paket boş olamaz.");
        SubscriptionPlanId = plan.Id;
        SubscriptionPlan = plan;
        Plan = plan.Name;
        Touch();
    }

    public void ClearSubscriptionPlan()
    {
        SubscriptionPlanId = null;
        SubscriptionPlan = null;
        Touch();
    }

    public void SetProfile(string? domain, string? ownerName)
    {
        Domain = string.IsNullOrWhiteSpace(domain) ? null : domain.Trim().ToLowerInvariant();
        OwnerName = string.IsNullOrWhiteSpace(ownerName) ? null : ownerName.Trim();
        Touch();
    }

    public void SetContact(string? phone, string? taxNumber)
    {
        Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        TaxNumber = string.IsNullOrWhiteSpace(taxNumber) ? null : taxNumber.Trim();
        Touch();
    }

    public void SetProfileExtras(string? legalName, string? taxOffice, string? email)
    {
        LegalName = string.IsNullOrWhiteSpace(legalName) ? null : legalName.Trim();
        TaxOffice = string.IsNullOrWhiteSpace(taxOffice) ? null : taxOffice.Trim();
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
        Touch();
    }

    public void SetFinanceSettings(string? currency, int maxInstallments, int overdueGraceDays)
    {
        var cur = string.IsNullOrWhiteSpace(currency) ? "TRY" : currency.Trim().ToUpperInvariant();
        if (cur.Length < 3 || cur.Length > 6) throw new DomainException("Para birimi 3-6 karakter olmalıdır.");
        if (maxInstallments < 1 || maxInstallments > 36) throw new DomainException("Taksit sınırı 1-36 arasında olmalı.");
        if (overdueGraceDays < 0 || overdueGraceDays > 60) throw new DomainException("Gecikme tolerans günü 0-60 arasında olmalı.");
        Currency = cur;
        MaxInstallments = maxInstallments;
        OverdueGraceDays = overdueGraceDays;
        Touch();
    }

    public Branch AddBranch(string name, string city, bool isDefault = false)
    {
        if (isDefault || Branches.Count == 0)
        {
            foreach (var existingBranch in Branches)
            {
                existingBranch.MarkDefault(false);
            }
        }

        var newBranch = new Branch(Id, name, city, isDefault || Branches.Count == 0);
        Branches.Add(newBranch);
        Touch();
        return newBranch;
    }

    public TenantUser GrantAccess(string email, UserRole role, Guid? branchId = null, string? fullName = null)
    {
        var normalizedEmail = TenantUser.NormalizeEmail(email);
        if (Users.Any(user => user.Email == normalizedEmail && user.Role == role && user.BranchId == branchId && user.IsActive))
        {
            throw new BusinessRuleException("Bu e-posta için aynı erişim zaten tanımlı.");
        }

        var user = new TenantUser(Id, normalizedEmail, role, branchId, fullName);
        Users.Add(user);
        Touch();
        return user;
    }

    public void Activate()
    {
        Status = TenantStatus.Active;
        TrialEndsAtUtc = null; // Aktif aboneliğe geçişle trial süresi alakasız hale gelir.
        // Not: Geçerli (ileri tarihli) abonelik bitişi KORUNUR; böylece profil düzenlemesinde
        // "Durum: Aktif" kaydetmek aboneliği sıfırlamaz. Süresi geçmiş bitiş ise kurum
        // middleware/arka plan tarafından yeniden askıya alınır — yeniden etkinleştirme için yeni dönem gerekir.
        Touch();
    }

    /// <summary>
    /// Ücretli aboneliği başlatır/yeniler. Paketi atar, dönemi (Aylık/Yıllık) belirler ve
    /// bitiş tarihini hesaplar. Kurum anında Aktif olur; deneme süresi alakasız hale gelir.
    /// Süre dolduğunda trial gibi otomatik Suspended olur (TrialAccessMiddleware + arka plan tarayıcı).
    /// </summary>
    public void StartSubscription(SubscriptionPlan plan, BillingPeriod period, DateTime nowUtc)
    {
        if (plan is null) throw new DomainException("Paket boş olamaz.");
        var start = nowUtc.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc)
            : nowUtc.ToUniversalTime();

        SubscriptionPlanId = plan.Id;
        SubscriptionPlan = plan;
        Plan = plan.Name;
        SubscriptionPeriod = period;
        SubscriptionEndsAtUtc = period == BillingPeriod.Yearly ? start.AddYears(1) : start.AddMonths(1);
        Status = TenantStatus.Active;
        TrialEndsAtUtc = null;
        Touch(start);
    }

    /// <summary>Aktif aboneliğin süresinin dolup dolmadığını kontrol eder.</summary>
    public bool IsSubscriptionExpired(DateTime nowUtc)
        => Status == TenantStatus.Active && SubscriptionEndsAtUtc.HasValue && SubscriptionEndsAtUtc.Value <= nowUtc;

    /// <summary>
    /// Platform admin kurumu denemeye aldığında çağrılır. Sayaç kurum yöneticisi ilk giriş yapana kadar başlamaz.
    /// </summary>
    public void ResetTrialForNextOwnerLogin()
    {
        Status = TenantStatus.Trial;
        TrialEndsAtUtc = null;
        // Denemeye dönüşle ücretli abonelik kalkar — artık dönem/bitiş bilgisi taşınmaz.
        SubscriptionPeriod = null;
        SubscriptionEndsAtUtc = null;
        Touch();
    }

    /// <summary>Kurum yöneticisinin ilk girişinde 14 günlük canlı deneme sayacını başlatır.</summary>
    public void StartTrial(DateTime utcNow, int trialDays = DefaultTrialDays)
    {
        if (trialDays <= 0) throw new DomainException("Deneme gün sayısı pozitif olmalı.");
        var start = utcNow.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(utcNow, DateTimeKind.Utc)
            : utcNow.ToUniversalTime();

        Status = TenantStatus.Trial;
        TrialEndsAtUtc = start.AddDays(trialDays);
        Touch(start);
    }

    public void Suspend()
    {
        Status = TenantStatus.Suspended;
        Touch();
    }

    public void Cancel()
    {
        Status = TenantStatus.Cancelled;
        Touch();
    }

    public void ExtendTrial(int additionalDays)
    {
        if (additionalDays <= 0) throw new DomainException("Gün sayısı pozitif olmalı.");
        var current = TrialEndsAtUtc ?? DateTime.UtcNow;
        TrialEndsAtUtc = current.AddDays(additionalDays);
        if (Status == TenantStatus.Suspended) Status = TenantStatus.Trial;
        Touch();
    }

    /// <summary>Trial sürenin dolduğunu kontrol eder.</summary>
    public bool IsTrialExpired(DateTime nowUtc)
        => Status == TenantStatus.Trial && TrialEndsAtUtc.HasValue && TrialEndsAtUtc.Value <= nowUtc;

    private static string NormalizeSlug(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new DomainException("Slug boş olamaz.");
        return value.Trim().ToLowerInvariant().Replace(' ', '-');
    }
}

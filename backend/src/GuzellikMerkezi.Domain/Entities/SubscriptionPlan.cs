using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Abonelik paketi. PlanKey programmatik referans (Starter/Pro/Premium/AIKlinik/Enterprise);
/// Name müşteriye gösterilen ad. Limit alanları -1 ile sınırsız anlamına gelir.
/// </summary>
public sealed class SubscriptionPlan : Entity
{
    private SubscriptionPlan() { }

    public SubscriptionPlan(
        string planKey,
        string name,
        decimal monthlyPriceTRY,
        int maxBranches,
        int maxStaff,
        int maxCustomers,
        int maxMonthlyAppointments,
        int maxMonthlySmsCount,
        string? features = null,
        string? description = null,
        int displayOrder = 0,
        int maxMonthlyWhatsAppCount = 0,
        int maxMonthlyEmailCount = 0,
        decimal yearlyPriceTRY = 0)
    {
        PlanKey = NormalizeKey(planKey);
        Rename(name);
        SetPrice(monthlyPriceTRY);
        SetYearlyPrice(yearlyPriceTRY);
        SetLimits(maxBranches, maxStaff, maxCustomers, maxMonthlyAppointments, maxMonthlySmsCount);
        SetMessagingLimits(maxMonthlyWhatsAppCount, maxMonthlyEmailCount);
        Features = features?.Trim();
        Description = description?.Trim();
        DisplayOrder = displayOrder;
        IsActive = true;
    }

    /// <summary>Stable identifier — kodda referans için (Starter/Pro/...).</summary>
    public string PlanKey { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public decimal MonthlyPriceTRY { get; private set; }
    /// <summary>Yıllık abonelik fiyatı (₺). 0 ise "özel/teklif" olarak değerlendirilir.</summary>
    public decimal YearlyPriceTRY { get; private set; }

    // Limitler (-1 = sınırsız)
    public int MaxBranches { get; private set; }
    public int MaxStaff { get; private set; }
    public int MaxCustomers { get; private set; }
    public int MaxMonthlyAppointments { get; private set; }
    public int MaxMonthlySmsCount { get; private set; }
    public int MaxMonthlyWhatsAppCount { get; private set; }
    public int MaxMonthlyEmailCount { get; private set; }

    /// <summary>Bayrak feature'ları CSV: "Reports,Notifications,AdvancedAnalytics,APIAccess".</summary>
    public string? Features { get; private set; }

    public int DisplayOrder { get; private set; }
    public bool IsActive { get; private set; } = true;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Paket adı boş olamaz.");
        if (name.Length > 80) throw new DomainException("Paket adı 80 karakteri aşamaz.");
        Name = name.Trim();
        Touch();
    }

    public void SetPrice(decimal monthly)
    {
        if (monthly < 0) throw new DomainException("Fiyat negatif olamaz.");
        MonthlyPriceTRY = monthly;
        Touch();
    }

    public void SetYearlyPrice(decimal yearly)
    {
        if (yearly < 0) throw new DomainException("Yıllık fiyat negatif olamaz.");
        YearlyPriceTRY = yearly;
        Touch();
    }

    public void SetLimits(int branches, int staff, int customers, int monthlyAppointments, int monthlySms)
    {
        MaxBranches = NormalizeLimit(branches);
        MaxStaff = NormalizeLimit(staff);
        MaxCustomers = NormalizeLimit(customers);
        MaxMonthlyAppointments = NormalizeLimit(monthlyAppointments);
        MaxMonthlySmsCount = NormalizeLimit(monthlySms);
        Touch();
    }

    public void SetMessagingLimits(int monthlyWhatsApp, int monthlyEmail)
    {
        MaxMonthlyWhatsAppCount = NormalizeLimit(monthlyWhatsApp);
        MaxMonthlyEmailCount = NormalizeLimit(monthlyEmail);
        Touch();
    }

    public void SetDescription(string? description)
    {
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        Touch();
    }

    public void SetFeatures(string? features)
    {
        Features = string.IsNullOrWhiteSpace(features) ? null : features.Trim();
        Touch();
    }

    public void SetDisplayOrder(int order) { DisplayOrder = order; Touch(); }
    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }

    private static int NormalizeLimit(int value) => value < 0 ? -1 : value;

    private static string NormalizeKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) throw new DomainException("PlanKey boş olamaz.");
        var k = key.Trim();
        if (k.Length > 40) throw new DomainException("PlanKey 40 karakteri aşamaz.");
        return k;
    }

    /// <summary>Feature CSV'sine bir bayrağın olup olmadığını kontrol eder (case-insensitive).</summary>
    public bool Has(string feature)
    {
        if (string.IsNullOrWhiteSpace(Features) || string.IsNullOrWhiteSpace(feature)) return false;
        return Features.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(f => string.Equals(f, feature, StringComparison.OrdinalIgnoreCase));
    }
}

namespace GuzellikMerkezi.Application.Features.SubscriptionPlans;

public sealed record SubscriptionPlanDto(
    Guid Id,
    string PlanKey,
    string Name,
    string? Description,
    decimal MonthlyPriceTRY,
    decimal YearlyPriceTRY,
    int MaxBranches,
    int MaxStaff,
    int MaxCustomers,
    int MaxMonthlyAppointments,
    int MaxMonthlySmsCount,
    int MaxMonthlyWhatsAppCount,
    int MaxMonthlyEmailCount,
    string? Features,
    int DisplayOrder,
    bool IsActive,
    int TenantCount,
    int MaxMonthlyWhatsAppMarketing = 0,
    decimal DefaultSpendCapCredits = 0,
    /// <summary>Fiyat şube başına mı (birim × şube sayısı)? Fiyatlar KDV HARİÇTİR.</summary>
    bool ChargePerBranch = false,
    /// <summary>Müşteri sayısı kademeleri — eşik ÜZERİ aylık ek ücret (KDV hariç).</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.PricingTier>? CustomerTiers = null,
    /// <summary>İmzalı dijital onam formu kademeleri — eşik ÜZERİ aylık ek ücret (KDV hariç).</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.PricingTier>? ConsentTiers = null,
    /// <summary>Yıllık dönemde kademe ücreti = aylık × çarpan (ör. 10).</summary>
    decimal YearlyTierMultiplier = 10);

public sealed record CreateSubscriptionPlanRequest(
    string PlanKey,
    string Name,
    string? Description,
    decimal MonthlyPriceTRY,
    int MaxBranches,
    int MaxStaff,
    int MaxCustomers,
    int MaxMonthlyAppointments,
    int MaxMonthlySmsCount,
    int MaxMonthlyWhatsAppCount,
    int MaxMonthlyEmailCount,
    string? Features,
    int DisplayOrder,
    decimal YearlyPriceTRY = 0,
    int MaxMonthlyWhatsAppMarketing = 0,
    decimal DefaultSpendCapCredits = 0,
    /// <summary>Fiyat şube başına mı (birim × şube sayısı)? Fiyatlar KDV HARİÇTİR.</summary>
    bool ChargePerBranch = false,
    /// <summary>Müşteri sayısı kademeleri — eşik ÜZERİ aylık ek ücret (KDV hariç).</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.PricingTier>? CustomerTiers = null,
    /// <summary>İmzalı dijital onam formu kademeleri — eşik ÜZERİ aylık ek ücret (KDV hariç).</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.PricingTier>? ConsentTiers = null,
    /// <summary>Yıllık dönemde kademe ücreti = aylık × çarpan (ör. 10).</summary>
    decimal YearlyTierMultiplier = 10);

public sealed record UpdateSubscriptionPlanRequest(
    string Name,
    string? Description,
    decimal MonthlyPriceTRY,
    int MaxBranches,
    int MaxStaff,
    int MaxCustomers,
    int MaxMonthlyAppointments,
    int MaxMonthlySmsCount,
    int MaxMonthlyWhatsAppCount,
    int MaxMonthlyEmailCount,
    string? Features,
    int DisplayOrder,
    bool IsActive,
    decimal YearlyPriceTRY = 0,
    int MaxMonthlyWhatsAppMarketing = 0,
    decimal DefaultSpendCapCredits = 0,
    // FİYATLAMA MODELİ — null = MEVCUT KORUNUR. Alanları bilmeyen bir kayıt (eski istemci) paketin
    // şube başı ücretini ve kademelerini sessizce silmesin; boş liste bilerek temizler.
    /// <summary>Fiyat şube başına mı (birim × şube sayısı)? Fiyatlar KDV HARİÇTİR.</summary>
    bool? ChargePerBranch = null,
    /// <summary>Müşteri sayısı kademeleri — eşik ÜZERİ aylık ek ücret (KDV hariç). Boş liste = kademe yok.</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.PricingTier>? CustomerTiers = null,
    /// <summary>İmzalı dijital onam formu kademeleri — eşik ÜZERİ aylık ek ücret (KDV hariç). Boş liste = kademe yok.</summary>
    IReadOnlyList<GuzellikMerkezi.Domain.Billing.PricingTier>? ConsentTiers = null,
    /// <summary>Yıllık dönemde kademe ücreti = aylık × çarpan (ör. 10).</summary>
    decimal? YearlyTierMultiplier = null);

public sealed record AssignPlanRequest(Guid SubscriptionPlanId);

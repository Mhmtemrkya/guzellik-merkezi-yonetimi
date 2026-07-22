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
    decimal DefaultWhatsAppSpendCapTry = 0);

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
    decimal DefaultWhatsAppSpendCapTry = 0);

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
    decimal DefaultWhatsAppSpendCapTry = 0);

public sealed record AssignPlanRequest(Guid SubscriptionPlanId);

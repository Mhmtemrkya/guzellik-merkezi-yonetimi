namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// Ücretli abonelik dönemi. Deneme (Trial) ayrı mekanizmadır (Tenant.TrialEndsAtUtc)
/// ve bu enuma dahil değildir.
/// </summary>
public enum BillingPeriod
{
    Monthly = 1,
    Yearly = 2
}

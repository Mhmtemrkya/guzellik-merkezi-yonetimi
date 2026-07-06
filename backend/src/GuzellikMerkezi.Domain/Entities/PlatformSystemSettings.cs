namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform geneli sistem ayarları (tenant'sız singleton) — yalnızca PlatformAdmin yönetir.
/// Her bölüm serbest şemalı JSON belge olarak saklanır; UI kartları (plan limitleri,
/// güvenlik, entegrasyonlar, bakım modu) alan ekleyip çıkarabildiği için kolonlara açılmaz.
/// </summary>
public sealed class PlatformSystemSettings : Entity
{
    public PlatformSystemSettings() { }

    public string? PlanLimitsJson { get; private set; }
    public string? SecurityJson { get; private set; }
    public string? IntegrationsJson { get; private set; }
    public string? MaintenanceJson { get; private set; }
    public string? DataRetentionJson { get; private set; }

    /// <summary>Bakım modu hızlı bayrağı — JSON'ı parse etmeden middleware/health kontrolü için.</summary>
    public bool MaintenanceEnabled { get; private set; }

    public void UpdateSection(string section, string json, bool? maintenanceEnabled)
    {
        switch (section)
        {
            case "planLimits": PlanLimitsJson = json; break;
            case "security": SecurityJson = json; break;
            case "integrations": IntegrationsJson = json; break;
            case "maintenance":
                MaintenanceJson = json;
                if (maintenanceEnabled is bool m) MaintenanceEnabled = m;
                break;
            case "dataRetention": DataRetentionJson = json; break;
            default: throw new Exceptions.DomainException("Bilinmeyen ayar bölümü.");
        }
        Touch();
    }
}

namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// Uygulama-içi bildirimin önem düzeyi. Mobil tarafta bildirim kanalı (ses/önem) ve renk seçimi için.
/// </summary>
public enum AppNotificationSeverity
{
    Info = 0,
    Success = 1,
    Warning = 2,
    Critical = 3,
}

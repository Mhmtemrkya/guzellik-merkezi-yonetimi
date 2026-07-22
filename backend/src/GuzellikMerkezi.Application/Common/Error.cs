namespace GuzellikMerkezi.Application.Common;

public sealed record Error(string Code, string Message)
{
    public static readonly Error None = new("None", string.Empty);
    public static Error Validation(string message) => new("Validation", message);
    public static Error NotFound(string message) => new("NotFound", message);
    public static Error Unauthorized(string message = "Yetkisiz işlem.") => new("Unauthorized", message);
    public static Error Conflict(string message) => new("Conflict", message);
    /// <summary>Personelin o saatte uygun yeri yok (409) — frontend bunu "bekleme listesine ekle?" için ayırt eder.</summary>
    public static Error SlotFull(string message) => new("SlotFull", message);
    /// <summary>Adisyon silinirken satılan seanslardan biri kullanılmış (400) — frontend bunu "zorla sil?" için ayırt eder.</summary>
    public static Error SessionUsed(string message) => new("AdisyonSessionUsed", message);
}

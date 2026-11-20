namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bir yapay zekâ modeli çağrısının sayısal kaydı: hangi kurum/rol/özellik, kaç token, ne kadar sürdü.
/// Maliyet raporu buradan hesaplanır. KVKK: istem ve cevap metni BİLEREK saklanmaz — müşteri adı, telefon
/// ya da sağlık bilgisi bu tabloya hiçbir yoldan giremez.
/// <para>
/// <see cref="Entity"/>'den türemez: kayıt yalnız eklenir (güncelleme/soft-delete yok) ve kendi kapsamındaki
/// DbContext ile yazılır; denetim alanlarına (CreatedBy vb.) ihtiyaç yoktur.
/// </para>
/// </summary>
public sealed class LlmUsageRecord
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? TenantId { get; set; }
    public Guid? UserId { get; set; }
    public string Role { get; set; } = string.Empty;
    /// <summary>ör. assistant.help</summary>
    public string Feature { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public int DurationMs { get; set; }
    public bool Succeeded { get; set; }
    public string Error { get; set; } = string.Empty;
    public int Attempts { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

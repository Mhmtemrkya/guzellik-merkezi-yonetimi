namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// OpenAI uyumlu sohbet uç noktalarına (NVIDIA, OpenRouter, Deep Infra, Ollama /v1) giden ortak istemci.
/// Hangi sağlayıcının kullanılacağını çağıran özellik kendi ayarından seçer (ör. QuestionImport:Model:Provider);
/// sağlayıcı ayarları "Llm:{Sağlayıcı}" bölümündedir (BaseUrl, ApiKey, Model, VisionModel...).
///
/// GÜVENLİK: Bu istemci bulut sağlayıcılarına gidebilir. Müşteri adı, telefon, TC ya da sağlık bilgisi gibi kişisel veri
/// gönderilmemelidir: çağıran metni önce maskeler (AssistantPrivacy). Konsültasyon/sağlık verisi buluta HİÇ gitmez.
///
/// Her çağrı yalnız sayılarla (token, süre, durum) kullanım tablosuna yazılır; istem/cevap metni saklanmaz.
/// Hata, zaman aşımı ya da kapalı sağlayıcıda istisna fırlatmaz, <see cref="LlmResult.Succeeded"/>=false döner
/// (yalnız çağıranın kendi iptali <see cref="OperationCanceledException"/> olarak geçer).
/// </summary>
public interface ILlmClient
{
    /// <summary>Sağlayıcı tanımlı ve (gerekiyorsa) anahtarı girilmiş mi.</summary>
    bool IsConfigured(string provider);

    /// <summary>Sağlayıcının metin modeli; tanımsızsa boş.</summary>
    string ModelFor(string provider, bool vision = false);

    Task<LlmResult> CompleteAsync(LlmRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// Tek bir model çağrısı. <see cref="Feature"/> kullanım raporunda maliyeti özelliğe bağlar
/// (ör. "assistant.help").
/// Kurum/kullanıcı/rol boşsa istekteki oturumdan alınır; arka plan işleri bunları açıkça vermelidir.
/// </summary>
public sealed record LlmRequest(string Provider, string Feature, IReadOnlyList<LlmMessage> Messages)
{
    /// <summary>Boşsa sağlayıcının modeli (görsel varsa VisionModel) kullanılır.</summary>
    public string? Model { get; init; }

    public double Temperature { get; init; }
    public int MaxTokens { get; init; } = 1024;

    /// <summary>Verilirse cevap bu JSON şemasına zorlanır (response_format json_schema, strict).</summary>
    public object? JsonSchema { get; init; }
    public string JsonSchemaName { get; init; } = "result";

    /// <summary>
    /// true: şema dilbilgisine kilitlenmeden JSON istenir (response_format=json_object) ve şema sistem istemine
    /// eklenir. Uzun şemalı çıktılarda (tam sayfa okuma) kilitli üretim bazen boşlukta döngüye girip sınıra kadar
    /// üretiyordu; gevşek modda bu görülmedi ve çıktı ~%30 kısaldı. Çağıran sonucu yine kendisi doğrular.
    /// </summary>
    public bool SchemaInPrompt { get; init; }

    /// <summary>Verilirse her adımda en olası N token ve olasılıkları döner (0-20).</summary>
    public int? TopLogprobs { get; init; }

    public Guid? TenantId { get; init; }
    public Guid? UserId { get; init; }
    public string? Role { get; init; }

    /// <summary>Boşsa sağlayıcı ayarı. Uzun üretimlerde (tam sayfa okuma) düşük tutulmalı.</summary>
    public int? MaxRetries { get; init; }

    /// <summary>Boşsa sağlayıcı ayarı (saniye).</summary>
    public int? TimeoutSeconds { get; init; }

    /// <summary>
    /// Zaman aşımında yeniden denensin mi. Uzun üretimde zaman aşımı, sağlayıcının cevabı üretip
    /// ücretlendirdiği anlamına gelebilir; yeniden denemek aynı işi iki kez ödetir.
    /// </summary>
    public bool RetryOnTimeout { get; init; } = true;
}

/// <summary>
/// Arka plan işlerinde (HTTP isteği olmayan) kullanım kaydının kurum/kullanıcı/rol bilgisi.
/// <c>using (LlmUsageContext.Begin(...))</c> bloğundaki bütün model çağrıları bu bilgiyle kaydedilir.
/// </summary>
public static class LlmUsageContext
{
    private static readonly AsyncLocal<LlmCaller?> current = new();

    public static LlmCaller? Current => current.Value;

    public static IDisposable Begin(Guid? tenantId, Guid? userId, string? role)
    {
        var previous = current.Value;
        current.Value = new LlmCaller(tenantId, userId, role);
        return new Restore(previous);
    }

    private sealed class Restore(LlmCaller? previous) : IDisposable
    {
        public void Dispose() => current.Value = previous;
    }
}

public sealed record LlmCaller(Guid? TenantId, Guid? UserId, string? Role);

/// <summary>Role: system, user, assistant. Görseller yalnız user mesajında anlamlıdır.</summary>
public sealed record LlmMessage(string Role, string Text, IReadOnlyList<LlmImage>? Images = null)
{
    public static LlmMessage System(string text) => new("system", text);
    public static LlmMessage User(string text, params LlmImage[] images) => new("user", text, images.Length == 0 ? null : images);
}

public sealed record LlmImage(byte[] Data, string MediaType = "image/jpeg");

public sealed record LlmResult
{
    public bool Succeeded { get; init; }
    public string Content { get; init; } = string.Empty;
    /// <summary>stop, length (yarıda kesildi), content_filter...</summary>
    public string? FinishReason { get; init; }
    /// <summary>Başarısızlık kodu: not_configured, http_401, http_429, timeout, network, bad_response...</summary>
    public string? Error { get; init; }
    public string Provider { get; init; } = string.Empty;
    /// <summary>Sağlayıcının cevapta bildirdiği model (istenenden farklı adla dönebilir).</summary>
    public string Model { get; init; } = string.Empty;
    public int PromptTokens { get; init; }
    public int CompletionTokens { get; init; }
    public TimeSpan Duration { get; init; }
    public int Attempts { get; init; }
    public IReadOnlyList<LlmLogprobStep>? Logprobs { get; init; }

    public bool Truncated => FinishReason == "length";
}

public sealed record LlmLogprobStep(string Token, double Logprob, IReadOnlyList<LlmTokenProbability> Top);

public sealed record LlmTokenProbability(string Token, double Logprob);

/// <summary>Model çağrılarının sayısal kaydı (metin yok). Kaydetme hatası çağıranı asla etkilemez.</summary>
public interface ILlmUsageRecorder
{
    Task RecordAsync(LlmUsageEntry entry, CancellationToken cancellationToken);
}

public sealed record LlmUsageEntry(
    Guid? TenantId, Guid? UserId, string? Role, string Feature, string Provider, string Model,
    int PromptTokens, int CompletionTokens, int DurationMs, bool Succeeded, string? Error, int Attempts);

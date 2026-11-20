using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GuzellikMerkezi.Application.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("GuzellikMerkezi.Tests")]


namespace GuzellikMerkezi.Infrastructure.Services.Llm;

/// <summary>
/// OpenAI uyumlu /chat/completions istemcisi. Sağlayıcı ayarları "Llm:{Ad}" bölümünden okunur:
/// <list type="bullet">
/// <item>BaseUrl — ör. https://integrate.api.nvidia.com/v1 (sonunda /chat/completions OLMADAN)</item>
/// <item>ApiKey — yalnız user-secrets / ortam değişkeni; Ollama için gerekmez</item>
/// <item>Model, VisionModel — boşsa Model kullanılır</item>
/// <item>ThinkingOff — düşünme modunu kapatma biçimi: "kwargs" (chat_template_kwargs.enable_thinking=false, NVIDIA),
/// "reasoning" (reasoning.enabled=false, OpenRouter — kwargs'ı yok sayar, açık kalırsa çıktı ~20 kat büyür) ya da "none".
/// Eski "DisableThinking": true ayarı "kwargs" sayılır.</item>
/// <item>DenyDataCollection — OpenRouter'da yalnız veriyi saklamayan/eğitmeyen sağlayıcılara yönlendir (provider.data_collection=deny)</item>
/// <item>TimeoutSeconds (varsayılan 180), MaxRetries (varsayılan 3; 429/5xx/ağ hatasında)</item>
/// </list>
/// Bilinen sağlayıcıların (Nvidia, Ollama) adres/model varsayılanları koddadır; anahtar asla koda yazılmaz.
/// </summary>
public sealed class OpenAiCompatibleLlmClient(
    HttpClient http,
    IConfiguration configuration,
    ILlmUsageRecorder recorder,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    ILogger<OpenAiCompatibleLlmClient> logger) : ILlmClient
{
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    /// <summary>Testlerde beklemeyi kısaltmak için.</summary>
    internal Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

    public bool IsConfigured(string provider)
    {
        var settings = Settings(provider);
        return settings is not null && (!settings.RequiresKey || !string.IsNullOrWhiteSpace(settings.ApiKey));
    }

    public string ModelFor(string provider, bool vision = false)
    {
        var settings = Settings(provider);
        if (settings is null) return string.Empty;
        return vision ? settings.VisionModel : settings.Model;
    }

    public async Task<LlmResult> CompleteAsync(LlmRequest request, CancellationToken cancellationToken)
    {
        var settings = Settings(request.Provider);
        var vision = request.Messages.Any(m => m.Images is { Count: > 0 });
        var model = !string.IsNullOrWhiteSpace(request.Model) ? request.Model! : settings is null ? string.Empty : vision ? settings.VisionModel : settings.Model;
        var watch = Stopwatch.StartNew();

        if (settings is null || (settings.RequiresKey && string.IsNullOrWhiteSpace(settings.ApiKey)) || model.Length == 0)
        {
            var notConfigured = new LlmResult { Error = "not_configured", Provider = request.Provider, Model = model };
            await RecordAsync(request, notConfigured, cancellationToken);
            return notConfigured;
        }

        var body = BuildBody(request, settings, model);
        var endpoint = new Uri(settings.BaseUrl.TrimEnd('/') + "/chat/completions");
        var attempts = 0;
        string error = "network";
        var maxRetries = Math.Clamp(request.MaxRetries ?? settings.MaxRetries, 0, 6);
        var timeoutAfter = request.TimeoutSeconds is int seconds ? TimeSpan.FromSeconds(Math.Clamp(seconds, 5, 900)) : settings.Timeout;

        while (true)
        {
            attempts++;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(timeoutAfter);
            TimeSpan? retryAfter = null;
            try
            {
                using var message = new HttpRequestMessage(HttpMethod.Post, endpoint)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                };
                if (!string.IsNullOrWhiteSpace(settings.ApiKey))
                    message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);
                message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                using var response = await http.SendAsync(message, HttpCompletionOption.ResponseContentRead, timeout.Token);
                if (response.IsSuccessStatusCode)
                {
                    var raw = await response.Content.ReadAsStringAsync(timeout.Token);
                    var parsed = Parse(raw, request.Provider, model);
                    var result = parsed with { Duration = watch.Elapsed, Attempts = attempts };
                    await RecordAsync(request, result, cancellationToken);
                    return result;
                }

                error = "http_" + ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture);
                if (!IsTransient(response.StatusCode)) break;
                retryAfter = RetryAfter(response);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (OperationCanceledException)
            {
                error = "timeout";
                if (!request.RetryOnTimeout) break;
            }
            catch (HttpRequestException exception)
            {
                error = "network";
                logger.LogWarning(exception, "LLM sağlayıcısına ulaşılamadı ({Provider}).", request.Provider);
            }

            if (attempts > maxRetries) break;
            var delay = retryAfter ?? TimeSpan.FromSeconds(Math.Pow(2, attempts - 1));
            await Delay(delay > MaxRetryDelay ? MaxRetryDelay : delay, cancellationToken);
        }

        logger.LogWarning("LLM çağrısı başarısız: {Provider} {Feature} {Error} ({Attempts} deneme).",
            request.Provider, request.Feature, error, attempts);
        var failed = new LlmResult
        {
            Error = error, Provider = request.Provider, Model = model, Duration = watch.Elapsed, Attempts = attempts,
        };
        await RecordAsync(request, failed, cancellationToken);
        return failed;
    }

    internal static string BuildBody(LlmRequest request, ProviderSettings settings, string model)
    {
        var messages = new JsonArray();
        var schemaNode = request.JsonSchema is null ? null
            : request.JsonSchema is JsonNode node ? node.DeepClone() : JsonSerializer.SerializeToNode(request.JsonSchema);
        var schemaNote = request.SchemaInPrompt && schemaNode is not null
            ? "\nReturn ONE compact JSON object (no extra whitespace or line breaks) that matches this JSON schema exactly:\n" + schemaNode.ToJsonString()
            : null;
        var systemDone = false;
        foreach (var source in request.Messages)
        {
            var item = source;
            if (schemaNote is not null && !systemDone && item.Role == "system")
            {
                item = item with { Text = item.Text + schemaNote };
                systemDone = true;
            }
            JsonNode content;
            if (item.Images is { Count: > 0 } images)
            {
                var parts = new JsonArray { new JsonObject { ["type"] = "text", ["text"] = item.Text } };
                foreach (var image in images)
                {
                    parts.Add(new JsonObject
                    {
                        ["type"] = "image_url",
                        ["image_url"] = new JsonObject { ["url"] = $"data:{image.MediaType};base64,{Convert.ToBase64String(image.Data)}" },
                    });
                }
                content = parts;
            }
            else
            {
                content = JsonValue.Create(item.Text)!;
            }
            messages.Add(new JsonObject { ["role"] = item.Role, ["content"] = content });
        }

        var body = new JsonObject
        {
            ["model"] = model,
            ["messages"] = messages,
            ["temperature"] = request.Temperature,
            ["max_tokens"] = Math.Max(1, request.MaxTokens),
            ["stream"] = false,
        };
        if (schemaNode is not null && request.SchemaInPrompt)
        {
            if (!systemDone) messages.Insert(0, new JsonObject { ["role"] = "system", ["content"] = schemaNote!.TrimStart('\n') });
            body["response_format"] = new JsonObject { ["type"] = "json_object" };
        }
        else if (schemaNode is not null)
        {
            body["response_format"] = new JsonObject
            {
                ["type"] = "json_schema",
                ["json_schema"] = new JsonObject
                {
                    ["name"] = request.JsonSchemaName,
                    ["strict"] = true,
                    // Çağıranlar şemayı statik tutar; JsonNode tek ebeveyne bağlanabildiği için kopyası kullanılır.
                    ["schema"] = schemaNode,
                },
            };
        }
        if (request.TopLogprobs is int top)
        {
            body["logprobs"] = true;
            body["top_logprobs"] = Math.Clamp(top, 0, 20);
        }
        switch (settings.ThinkingOff)
        {
            case "kwargs":
                body["chat_template_kwargs"] = new JsonObject { ["enable_thinking"] = false };
                break;
            case "reasoning":
                body["reasoning"] = new JsonObject { ["enabled"] = false };
                break;
        }
        if (settings.DenyDataCollection)
            body["provider"] = new JsonObject { ["data_collection"] = "deny" };
        return body.ToJsonString();
    }

    internal static LlmResult Parse(string raw, string provider, string requestedModel)
    {
        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            var choice = root.GetProperty("choices")[0];
            var content = choice.TryGetProperty("message", out var message)
                && message.TryGetProperty("content", out var text) && text.ValueKind == JsonValueKind.String
                ? text.GetString() ?? string.Empty
                : string.Empty;
            var finish = choice.TryGetProperty("finish_reason", out var reason) && reason.ValueKind == JsonValueKind.String
                ? reason.GetString()
                : null;
            int prompt = 0, completion = 0;
            if (root.TryGetProperty("usage", out var usage) && usage.ValueKind == JsonValueKind.Object)
            {
                prompt = usage.TryGetProperty("prompt_tokens", out var p) && p.TryGetInt32(out var pv) ? pv : 0;
                completion = usage.TryGetProperty("completion_tokens", out var c) && c.TryGetInt32(out var cv) ? cv : 0;
            }
            var model = root.TryGetProperty("model", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? requestedModel : requestedModel;
            // OpenRouter isteği hangi altyapı sağlayıcısının cevapladığını bildirir; sorun ayıklamak için kayda yazılır.
            if (root.TryGetProperty("provider", out var upstream) && upstream.ValueKind == JsonValueKind.String && upstream.GetString() is { Length: > 0 } name)
                model = $"{model} @{name}";
            return new LlmResult
            {
                Succeeded = true,
                Content = content,
                FinishReason = finish,
                Provider = provider,
                Model = model,
                PromptTokens = prompt,
                CompletionTokens = completion,
                Logprobs = ParseLogprobs(choice),
            };
        }
        catch (Exception exception) when (exception is JsonException or KeyNotFoundException or InvalidOperationException or IndexOutOfRangeException)
        {
            return new LlmResult { Error = "bad_response", Provider = provider, Model = requestedModel };
        }
    }

    private static IReadOnlyList<LlmLogprobStep>? ParseLogprobs(JsonElement choice)
    {
        if (!choice.TryGetProperty("logprobs", out var logprobs) || logprobs.ValueKind != JsonValueKind.Object
            || !logprobs.TryGetProperty("content", out var steps) || steps.ValueKind != JsonValueKind.Array)
            return null;
        var result = new List<LlmLogprobStep>();
        foreach (var step in steps.EnumerateArray())
        {
            var top = new List<LlmTokenProbability>();
            if (step.TryGetProperty("top_logprobs", out var candidates) && candidates.ValueKind == JsonValueKind.Array)
            {
                // Şemanın yasakladığı (maskelenmiş) adaylar logprob=null gelir: olasılığı sıfırdır, atlanır.
                foreach (var candidate in candidates.EnumerateArray())
                    if (candidate.TryGetProperty("logprob", out var value) && value.ValueKind == JsonValueKind.Number
                        && candidate.TryGetProperty("token", out var name) && name.ValueKind == JsonValueKind.String)
                        top.Add(new LlmTokenProbability(name.GetString() ?? string.Empty, value.GetDouble()));
            }
            result.Add(new LlmLogprobStep(
                step.TryGetProperty("token", out var token) && token.ValueKind == JsonValueKind.String ? token.GetString() ?? string.Empty : string.Empty,
                step.TryGetProperty("logprob", out var logprob) && logprob.ValueKind == JsonValueKind.Number ? logprob.GetDouble() : double.NegativeInfinity,
                top));
        }
        return result;
    }

    private static bool IsTransient(HttpStatusCode status)
        => status is HttpStatusCode.TooManyRequests or HttpStatusCode.RequestTimeout
            or HttpStatusCode.InternalServerError or HttpStatusCode.BadGateway
            or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;

    private static TimeSpan? RetryAfter(HttpResponseMessage response)
    {
        var header = response.Headers.RetryAfter;
        if (header?.Delta is TimeSpan delta) return delta;
        if (header?.Date is DateTimeOffset date) return date - DateTimeOffset.UtcNow is var wait && wait > TimeSpan.Zero ? wait : TimeSpan.Zero;
        return null;
    }

    private async Task RecordAsync(LlmRequest request, LlmResult result, CancellationToken cancellationToken)
    {
        // Öncelik: istekte açıkça verilen → arka plan işinin bağlamı → HTTP oturumu (ICurrentUser / ITenantContext).
        var caller = LlmUsageContext.Current;
        var entry = new LlmUsageEntry(
            request.TenantId ?? caller?.TenantId ?? tenantContext.TenantId ?? currentUser.TenantId,
            request.UserId ?? caller?.UserId ?? currentUser.UserId,
            request.Role ?? caller?.Role ?? currentUser.Role?.ToString(),
            request.Feature,
            result.Provider,
            result.Model,
            result.PromptTokens,
            result.CompletionTokens,
            (int)Math.Min(int.MaxValue, result.Duration.TotalMilliseconds),
            result.Succeeded,
            result.Error,
            result.Attempts);
        await recorder.RecordAsync(entry, cancellationToken);
    }

    private ProviderSettings? Settings(string provider)
    {
        if (string.IsNullOrWhiteSpace(provider)) return null;
        var section = configuration.GetSection("Llm:" + provider);
        var known = KnownDefaults(provider);
        var baseUrl = section["BaseUrl"] is { Length: > 0 } url ? url : known?.BaseUrl;
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;
        var model = section["Model"] is { Length: > 0 } configured ? configured : known?.Model ?? string.Empty;
        // Yalnız Model ayarlandıysa görsel istekler de o modele gider; varsayılan görsel model yalnız Model de varsayılansa kullanılır.
        var visionModel = section["VisionModel"] is { Length: > 0 } configuredVision ? configuredVision
            : section["Model"] is { Length: > 0 } ? model
            : known?.VisionModel ?? model;
        return new ProviderSettings(
            baseUrl,
            section["ApiKey"],
            model,
            visionModel.Length > 0 ? visionModel : model,
            ThinkingOffStyle(section, known),
            section.GetValue("DenyDataCollection", known?.DenyDataCollection ?? false),
            section.GetValue("RequiresKey", known?.RequiresKey ?? true),
            TimeSpan.FromSeconds(Math.Clamp(section.GetValue("TimeoutSeconds", 180), 5, 900)),
            Math.Clamp(section.GetValue("MaxRetries", 3), 0, 6));
    }

    private static string ThinkingOffStyle(IConfigurationSection section, ProviderSettings? known)
    {
        var style = section["ThinkingOff"]?.Trim().ToLowerInvariant();
        if (style is "kwargs" or "reasoning" or "none") return style;
        if (section["DisableThinking"] is { } legacy) return bool.TryParse(legacy, out var off) && off ? "kwargs" : "none";
        return known?.ThinkingOff ?? "none";
    }

    private static ProviderSettings? KnownDefaults(string provider) => provider.ToLowerInvariant() switch
    {
        "nvidia" => new ProviderSettings("https://integrate.api.nvidia.com/v1", null,
            "nvidia/nemotron-3.5-super-vl-120b-a12b", "nvidia/nemotron-3.5-super-vl-120b-a12b", "kwargs", false, true, TimeSpan.Zero, 0),
        "openrouter" => new ProviderSettings("https://openrouter.ai/api/v1", null,
            "nvidia/nemotron-3.5-super-vl", "nvidia/nemotron-3.5-super-vl", "reasoning", true, true, TimeSpan.Zero, 0),
        "ollama" => new ProviderSettings("http://127.0.0.1:11434/v1", null,
            "qwen2.5:3b", "qwen3-vl:4b-instruct", "none", false, false, TimeSpan.Zero, 0),
        _ => null,
    };

    internal sealed record ProviderSettings(
        string BaseUrl, string? ApiKey, string Model, string VisionModel,
        string ThinkingOff, bool DenyDataCollection, bool RequiresKey, TimeSpan Timeout, int MaxRetries);
}

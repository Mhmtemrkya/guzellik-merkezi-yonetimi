using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Infrastructure.Services.Llm;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure.Llm;

/// <summary>
/// Ortak model istemcisi: istek gövdesi (şema, düşünme kapalı, görsel, anahtar), cevap ayrıştırma
/// (token, logprobs), 429 yeniden deneme ve kayıt. Gerçek ağa gidilmez.
/// </summary>
public sealed class OpenAiCompatibleLlmClientTests
{
    private const string OkBody = """
        {"model":"private/nvidia/nemotron-3.5-super-120b-a12b",
         "choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"B"},
           "logprobs":{"content":[
             {"token":"B","logprob":-0.23,"top_logprobs":[{"token":"B","logprob":-0.23},{"token":"A","logprob":-1.73}]},
             {"token":"","logprob":-0.58,"top_logprobs":[{"token":"<|im_end|>","logprob":-0.58}]}]}}],
         "usage":{"prompt_tokens":47,"completion_tokens":2,"total_tokens":49}}
        """;

    private sealed class FakeHandler(params Func<HttpRequestMessage, HttpResponseMessage>[] responses) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            Calls.Add((request, body));
            var index = Math.Min(Calls.Count - 1, responses.Length - 1);
            return responses[index](request);
        }
    }

    private sealed class FakeRecorder : ILlmUsageRecorder
    {
        public List<LlmUsageEntry> Entries { get; } = [];
        public Task RecordAsync(LlmUsageEntry entry, CancellationToken cancellationToken)
        {
            Entries.Add(entry);
            return Task.CompletedTask;
        }
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static (OpenAiCompatibleLlmClient Client, FakeHandler Handler, FakeRecorder Recorder, List<TimeSpan> Delays) Build(
        Dictionary<string, string?> settings, Guid? tenantId, params Func<HttpRequestMessage, HttpResponseMessage>[] responses)
        => Build(settings, tenantId, Anonymous(), responses);

    /// <summary>Oturumsuz çağrı (arka plan işi gibi): kayıt kurum/kullanıcıyı yalnız istekten ya da bağlamdan alır.</summary>
    private static TestCurrentUser Anonymous() => new(role: null) { UserId = null, IsAuthenticated = false };

    private static (OpenAiCompatibleLlmClient Client, FakeHandler Handler, FakeRecorder Recorder, List<TimeSpan> Delays) Build(
        Dictionary<string, string?> settings, Guid? tenantId, ICurrentUser currentUser, params Func<HttpRequestMessage, HttpResponseMessage>[] responses)
    {
        var handler = new FakeHandler(responses);
        var recorder = new FakeRecorder();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var delays = new List<TimeSpan>();
        var client = new OpenAiCompatibleLlmClient(
            new HttpClient(handler), configuration, recorder, new TestTenantContext(tenantId),
            currentUser, NullLogger<OpenAiCompatibleLlmClient>.Instance)
        {
            Delay = (delay, _) => { delays.Add(delay); return Task.CompletedTask; },
        };
        return (client, handler, recorder, delays);
    }

    private static readonly Dictionary<string, string?> NvidiaWithKey = new() { ["Llm:Nvidia:ApiKey"] = "test-key" };

    [Fact]
    public async Task Nvidia_BuildsSchemaThinkingOffImageAndAuthHeader()
    {
        var (client, handler, _, _) = Build(NvidiaWithKey, null, _ => Json(OkBody));
        var schema = JsonNode.Parse("""{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}""");

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test.page",
            [LlmMessage.System("sistem"), LlmMessage.User("sayfa", new LlmImage([1, 2, 3]))])
        {
            JsonSchema = schema, JsonSchemaName = "page", MaxTokens = 500,
        }, CancellationToken.None);

        Assert.True(result.Succeeded);
        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("https://integrate.api.nvidia.com/v1/chat/completions", request.RequestUri!.ToString());
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal("test-key", request.Headers.Authorization.Parameter);

        var json = JsonNode.Parse(body)!;
        Assert.Equal("nvidia/nemotron-3.5-super-vl-120b-a12b", (string?)json["model"]);
        Assert.False((bool)json["chat_template_kwargs"]!["enable_thinking"]!);
        Assert.Equal("json_schema", (string?)json["response_format"]!["type"]);
        Assert.True((bool)json["response_format"]!["json_schema"]!["strict"]!);
        Assert.Equal("page", (string?)json["response_format"]!["json_schema"]!["name"]);
        Assert.Equal(500, (int)json["max_tokens"]!);
        var parts = json["messages"]![1]!["content"]!.AsArray();
        Assert.Equal("text", (string?)parts[0]!["type"]);
        Assert.Equal("data:image/jpeg;base64,AQID", (string?)parts[1]!["image_url"]!["url"]);
        Assert.Equal("sistem", (string?)json["messages"]![0]!["content"]);
        Assert.Null(json["logprobs"]);
    }

    [Fact]
    public async Task SameStaticSchema_CanBeSentRepeatedly()
    {
        // Yardım eşleştirici şemayı statik JsonNode olarak tutabilir; ikinci istekte "node already has a parent" olmamalı.
        var schema = JsonNode.Parse("""{"type":"object"}""");
        var (client, handler, _, _) = Build(NvidiaWithKey, null, _ => Json(OkBody));

        for (var i = 0; i < 3; i++)
        {
            var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]) { JsonSchema = schema }, CancellationToken.None);
            Assert.True(result.Succeeded);
        }
        Assert.Equal(3, handler.Calls.Count);
        Assert.Null(schema!.Parent);
    }

    [Fact]
    public async Task ParsesUsageModelAndLogprobs_AndRecordsCountsOnly()
    {
        var tenant = Guid.NewGuid();
        var user = Guid.NewGuid();
        var (client, handler, recorder, _) = Build(NvidiaWithKey, tenant, _ => Json(OkBody));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "assistant.help", [LlmMessage.User("harf?")])
        {
            TopLogprobs = 5, UserId = user, Role = "Staff",
        }, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal("B", result.Content);
        Assert.Equal("stop", result.FinishReason);
        Assert.Equal("private/nvidia/nemotron-3.5-super-120b-a12b", result.Model);
        Assert.Equal(47, result.PromptTokens);
        Assert.Equal(2, result.CompletionTokens);
        Assert.Equal(1, result.Attempts);
        Assert.NotNull(result.Logprobs);
        Assert.Equal("B", result.Logprobs![0].Token);
        Assert.Equal(["B", "A"], result.Logprobs[0].Top.Select(x => x.Token));
        Assert.Equal(-1.73, result.Logprobs[0].Top[1].Logprob, 3);

        var body = JsonNode.Parse(handler.Calls[0].Body)!;
        Assert.True((bool)body["logprobs"]!);
        Assert.Equal(5, (int)body["top_logprobs"]!);

        var entry = Assert.Single(recorder.Entries);
        Assert.Equal(tenant, entry.TenantId);
        Assert.Equal(user, entry.UserId);
        Assert.Equal("Staff", entry.Role);
        Assert.Equal("assistant.help", entry.Feature);
        Assert.Equal(47, entry.PromptTokens);
        Assert.Equal(2, entry.CompletionTokens);
        Assert.True(entry.Succeeded);
    }

    [Fact]
    public async Task MaskedCandidatesWithNullLogprob_AreSkipped()
    {
        // NVIDIA, şemanın yasakladığı adayları logprob=null ile listeler.
        const string body = """
            {"choices":[{"finish_reason":"stop","message":{"content":"{\"harf\": \"B\"}"},
              "logprobs":{"content":[{"token":"B","logprob":-0.1,"top_logprobs":[
                {"token":"B","logprob":-0.1},{"token":"<unk>","logprob":null},{"token":"A","logprob":-2.4}]}]}}],
             "usage":{"prompt_tokens":10,"completion_tokens":5}}
            """;
        var (client, _, _, _) = Build(NvidiaWithKey, null, _ => Json(body));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]) { TopLogprobs = 20 }, CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(["B", "A"], result.Logprobs![0].Top.Select(x => x.Token));
    }

    [Fact]
    public async Task TooManyRequests_RetriesHonoringRetryAfter_ThenSucceeds()
    {
        var limited = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        limited.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(7));
        var (client, handler, recorder, delays) = Build(NvidiaWithKey, null, _ => limited, _ => Json(OkBody));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.Equal(2, result.Attempts);
        Assert.Equal(2, handler.Calls.Count);
        Assert.Equal([TimeSpan.FromSeconds(7)], delays);
        Assert.Equal(2, Assert.Single(recorder.Entries).Attempts);
    }

    [Fact]
    public async Task PersistentServerError_StopsAfterMaxRetries_AndReturnsFailure()
    {
        var settings = new Dictionary<string, string?>(NvidiaWithKey) { ["Llm:Nvidia:MaxRetries"] = "2" };
        var (client, handler, recorder, delays) = Build(settings, null, _ => Json("{}", HttpStatusCode.ServiceUnavailable));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal("http_503", result.Error);
        Assert.Equal(3, handler.Calls.Count);
        Assert.Equal([TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)], delays);
        Assert.False(Assert.Single(recorder.Entries).Succeeded);
    }

    [Fact]
    public async Task Unauthorized_IsNotRetried()
    {
        var (client, handler, _, delays) = Build(NvidiaWithKey, null, _ => Json("{}", HttpStatusCode.Unauthorized));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        Assert.Equal("http_401", result.Error);
        Assert.Single(handler.Calls);
        Assert.Empty(delays);
    }

    [Fact]
    public async Task MissingKey_IsNotConfigured_AndNeverCallsNetwork()
    {
        var (client, handler, recorder, _) = Build(new Dictionary<string, string?>(), null, _ => Json(OkBody));

        Assert.False(client.IsConfigured("Nvidia"));
        Assert.False(client.IsConfigured("Bilinmeyen"));
        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal("not_configured", result.Error);
        Assert.Empty(handler.Calls);
        Assert.Equal("not_configured", Assert.Single(recorder.Entries).Error);
    }

    [Fact]
    public async Task Ollama_NeedsNoKey_SendsNoAuthAndNoThinkingFlag_UsesVisionModelForImages()
    {
        var (client, handler, _, _) = Build(new Dictionary<string, string?>(), null, _ => Json(OkBody));

        Assert.True(client.IsConfigured("Ollama"));
        await client.CompleteAsync(new LlmRequest("Ollama", "test", [LlmMessage.User("x", new LlmImage([9]))]), CancellationToken.None);

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("http://127.0.0.1:11434/v1/chat/completions", request.RequestUri!.ToString());
        Assert.Null(request.Headers.Authorization);
        var json = JsonNode.Parse(body)!;
        Assert.Null(json["chat_template_kwargs"]);
        Assert.Equal("qwen3-vl:4b-instruct", (string?)json["model"]);
    }

    [Fact]
    public async Task OpenRouter_TurnsReasoningOff_AndDeniesDataCollection()
    {
        var (client, handler, _, _) = Build(new Dictionary<string, string?> { ["Llm:OpenRouter:ApiKey"] = "k" }, null, _ => Json(OkBody));

        await client.CompleteAsync(new LlmRequest("OpenRouter", "test", [LlmMessage.User("x")]), CancellationToken.None);

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("https://openrouter.ai/api/v1/chat/completions", request.RequestUri!.ToString());
        var json = JsonNode.Parse(body)!;
        Assert.Equal("nvidia/nemotron-3.5-super-vl", (string?)json["model"]);
        // OpenRouter chat_template_kwargs'ı yok sayar; düşünme yalnız reasoning.enabled=false ile kapanır.
        Assert.False((bool)json["reasoning"]!["enabled"]!);
        Assert.Null(json["chat_template_kwargs"]);
        Assert.Equal("deny", (string?)json["provider"]!["data_collection"]);
    }

    [Theory]
    [InlineData("true", null, true)]   // eski ayar → kwargs
    [InlineData("false", null, false)]
    [InlineData(null, "none", false)]
    [InlineData(null, "kwargs", true)]
    public async Task ThinkingSetting_LegacyAndExplicit(string? legacy, string? style, bool expectKwargs)
    {
        var settings = new Dictionary<string, string?>(NvidiaWithKey)
        {
            ["Llm:Nvidia:DisableThinking"] = legacy,
            ["Llm:Nvidia:ThinkingOff"] = style,
        };
        var (client, handler, _, _) = Build(settings, null, _ => Json(OkBody));

        await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        var json = JsonNode.Parse(Assert.Single(handler.Calls).Body)!;
        Assert.Equal(expectKwargs, json["chat_template_kwargs"] is not null);
        Assert.Null(json["reasoning"]);
        Assert.Null(json["provider"]);
    }

    [Fact]
    public async Task SchemaInPrompt_UsesJsonObjectMode_AndAppendsSchemaToSystem()
    {
        var (client, handler, _, _) = Build(NvidiaWithKey, null, _ => Json(OkBody));
        var schema = JsonNode.Parse("""{"type":"object","properties":{"a":{"type":"string"}}}""");

        await client.CompleteAsync(new LlmRequest("Nvidia", "t", [LlmMessage.System("sistem"), LlmMessage.User("u")])
        {
            JsonSchema = schema, SchemaInPrompt = true,
        }, CancellationToken.None);

        var json = JsonNode.Parse(Assert.Single(handler.Calls).Body)!;
        Assert.Equal("json_object", (string?)json["response_format"]!["type"]);
        Assert.Null(json["response_format"]!["json_schema"]);
        var system = (string?)json["messages"]![0]!["content"];
        Assert.StartsWith("sistem", system);
        Assert.Contains("\"properties\":{\"a\"", system);
        Assert.Equal(2, json["messages"]!.AsArray().Count);
        Assert.Null(schema!.Parent);
    }

    [Fact]
    public async Task TruncatedAnswer_IsReported()
    {
        var truncated = OkBody.Replace("\"finish_reason\":\"stop\"", "\"finish_reason\":\"length\"");
        var (client, _, _, _) = Build(NvidiaWithKey, null, _ => Json(truncated));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.True(result.Truncated);
    }

    [Fact]
    public async Task MalformedResponse_IsBadResponse_NotException()
    {
        var (client, _, _, _) = Build(NvidiaWithKey, null, _ => Json("{\"choices\":[]}"));

        var result = await client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal("bad_response", result.Error);
    }

    [Fact]
    public async Task CallerCancellation_Propagates()
    {
        var (client, _, _, _) = Build(NvidiaWithKey, null, _ => throw new TaskCanceledException());
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            client.CompleteAsync(new LlmRequest("Nvidia", "test", [LlmMessage.User("x")]), cancelled.Token));
    }

    [Fact]
    public void ConfiguredModelOverridesKnownDefault()
    {
        var settings = new Dictionary<string, string?>(NvidiaWithKey)
        {
            ["Llm:OpenRouter:BaseUrl"] = "https://openrouter.ai/api/v1",
            ["Llm:OpenRouter:ApiKey"] = "k",
            ["Llm:OpenRouter:Model"] = "nvidia/nemotron-x",
        };
        var (client, _, _, _) = Build(settings, null, _ => Json(OkBody));

        Assert.True(client.IsConfigured("OpenRouter"));
        Assert.Equal("nvidia/nemotron-x", client.ModelFor("OpenRouter"));
        Assert.Equal("nvidia/nemotron-x", client.ModelFor("OpenRouter", vision: true));
    }

    [Fact]
    public async Task Caller_FallsBackToSignedInUser_WhenRequestHasNoIdentity()
    {
        var tenant = Guid.NewGuid();
        var staff = new TestCurrentUser(GuzellikMerkezi.Domain.Enums.UserRole.Staff, tenant);
        var (client, _, recorder, _) = Build(NvidiaWithKey, null, staff, _ => Json(OkBody));

        await client.CompleteAsync(new LlmRequest("Nvidia", "assistant.help", [LlmMessage.User("x")]), CancellationToken.None);

        var entry = Assert.Single(recorder.Entries);
        Assert.Equal(tenant, entry.TenantId);
        Assert.Equal(staff.UserId, entry.UserId);
        Assert.Equal("Staff", entry.Role);
    }

    [Fact]
    public async Task BackgroundContext_WinsOverSignedInUser()
    {
        var job = (Tenant: Guid.NewGuid(), User: Guid.NewGuid());
        var (client, _, recorder, _) = Build(NvidiaWithKey, null,
            new TestCurrentUser(GuzellikMerkezi.Domain.Enums.UserRole.InstitutionOwner, Guid.NewGuid()), _ => Json(OkBody));

        using (LlmUsageContext.Begin(job.Tenant, job.User, "System"))
            await client.CompleteAsync(new LlmRequest("Nvidia", "assistant.help", [LlmMessage.User("x")]), CancellationToken.None);

        var entry = Assert.Single(recorder.Entries);
        Assert.Equal(job.Tenant, entry.TenantId);
        Assert.Equal(job.User, entry.UserId);
        Assert.Equal("System", entry.Role);
    }
}

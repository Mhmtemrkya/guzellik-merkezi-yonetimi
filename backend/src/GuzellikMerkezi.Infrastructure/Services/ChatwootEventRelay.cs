using System.Net.Http.Headers;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>Kuyruktaki Chatwoot iletimi: Meta'nın ham gövdesi ve imza başlığı.</summary>
public sealed record ChatwootRelayJob(string Body, string Signature);

/// <summary>
/// OLAYLAR ÖNCE BEAUTYASIST'E — Chatwoot'a ham iletim (bkz. <see cref="IWhatsAppEventRelay"/>).
///
/// <para>
/// <b>Önce doğrudan, olmazsa kuyruk:</b> her giden mesaj ~3 durum olayı üretir; toplu hatırlatmada yüzlerce olay
/// kalıcı kuyruğu (hatırlatma, push, KVKK işleriyle ortak) tıkardı. Olağan yolda iletim istek içinde kısa zaman
/// aşımıyla yapılır; yalnız başarısız olan kuyruğa düşer (uzun yeniden deneme, sonra Sistem sayfasında görünür).
/// Kuyruğa da yazılamazsa istisna yukarı çıkar: Meta 200 almaz ve olayı yeniden gönderir — olay kaybolmaz.
/// </para>
/// <para>
/// <b>Bayt bayt aynı:</b> Chatwoot <c>X-Hub-Signature-256</c>'yı uygulama sırrıyla HAM gövde üzerinde doğrular.
/// BeautyAsist imzayı aynı UTF-8 baytları üzerinde doğruladığı için (doğrulama geçtiyse) bu baytlar Meta'nın
/// imzaladıklarıyla aynıdır; gövde yeniden serileştirilmez, başlık değiştirilmez.
/// </para>
/// </summary>
public sealed class ChatwootEventRelay : IWhatsAppEventRelay
{
    public const string HttpClientName = "ChatwootRelay";

    /// <summary>İstek yolundaki (Meta bekliyor) doğrudan deneme süresi.</summary>
    public static readonly TimeSpan InlineTimeout = TimeSpan.FromSeconds(3);

    /// <summary>Kuyruktan yapılan denemenin süresi.</summary>
    public static readonly TimeSpan QueuedTimeout = TimeSpan.FromSeconds(15);

    /// <summary>
    /// Kuyruk deneme hakkı: 30 sn·2^n bekleme ile ≈ 4 saatlik Chatwoot kesintisine dayanır; sonra iş "başarısız"
    /// olur ve Platform › Sistem › Arka plan iş kuyruğu'ndan elle yeniden denenebilir.
    /// </summary>
    public const int MaxAttempts = 10;

    private readonly GuzellikDbContext _db;
    private readonly IHttpClientFactory _http;
    private readonly IDurableJobQueue _queue;
    private readonly ILogger<ChatwootEventRelay> _logger;

    public ChatwootEventRelay(GuzellikDbContext db, IHttpClientFactory http, IDurableJobQueue queue, ILogger<ChatwootEventRelay> logger)
    {
        _db = db;
        _http = http;
        _queue = queue;
        _logger = logger;
    }

    public async Task RelayAsync(string payloadJson, string signatureHeader, CancellationToken ct = default)
    {
        var url = await RelayUrlAsync(ct);
        if (url is null) return; // iletim kapalı

        try
        {
            var status = await PostAsync(url, payloadJson, signatureHeader, InlineTimeout, ct);
            if (status is >= 200 and < 300) return;
            _logger.LogWarning("[Chatwoot iletimi] Chatwoot HTTP {Status} döndü — olay kuyruğa alındı, yeniden denenecek.", status);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or InvalidOperationException)
        {
            if (ct.IsCancellationRequested) throw; // istek iptal edildi: Meta 200 almadı, yeniden gönderecek
            _logger.LogWarning("[Chatwoot iletimi] Doğrudan iletilemedi ({Error}) — olay kuyruğa alındı.", ex.Message);
        }

        // Kuyruğa da yazılamazsa istisna YUKARI çıkar (yutulmaz): Meta 200 almaz → olayı yeniden gönderir.
        await _queue.EnqueueAsync(DurableJobTypes.ChatwootRelay, new ChatwootRelayJob(payloadJson, signatureHeader), MaxAttempts, ct);
    }

    public async Task SendQueuedAsync(string payloadJson, string signatureHeader, CancellationToken ct = default)
    {
        var url = await RelayUrlAsync(ct);
        if (url is null)
        {
            _logger.LogInformation("[Chatwoot iletimi] İletim adresi kaldırılmış — kuyruktaki olay iletilmeden kapatıldı.");
            return;
        }

        var status = await PostAsync(url, payloadJson, signatureHeader, QueuedTimeout, ct);
        if (status is < 200 or >= 300)
            throw new HttpRequestException($"Chatwoot iletimi HTTP {status} döndü.");
    }

    private async Task<string?> RelayUrlAsync(CancellationToken ct)
    {
        var url = await _db.PlatformIntegrationSettings.AsNoTracking()
            .Select(p => p.ChatwootRelayUrl)
            .FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(url) ? null : url;
    }

    private async Task<int> PostAsync(string url, string payloadJson, string signatureHeader, TimeSpan timeout, CancellationToken ct)
    {
        // HER GÖNDERİMDE yeniden doğrulanır: ad kayıttan sonra iç bir adrese çözülecek şekilde değiştirilmiş olabilir.
        if (OutboundEndpointGuard.ValidateRelayUrl(url) is { } error) throw new InvalidOperationException(error);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(payloadJson)),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        request.Headers.TryAddWithoutValidation("X-Hub-Signature-256", signatureHeader);

        using var response = await _http.CreateClient(HttpClientName)
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        return (int)response.StatusCode;
    }
}

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;

namespace GuzellikMerkezi.Infrastructure.Background;

/// <summary>
/// Kalıcı iş kuyruğunun RabbitMQ sinyal katmanı (outbox + broker deseni):
/// iş her zaman ÖNCE background_jobs tablosuna yazılır (kaynak-of-truth, kayıp yok);
/// RabbitMQ yalnızca "yeni iş var" sinyalini (job Id) taşır → tüketici anında işler,
/// DB poller düşük frekansta güvenlik ağı olarak kalır. Broker kapalıysa sinyal
/// sessizce atlanır ve sistem salt-poller moduna düşer — hiçbir şey kaybolmaz.
/// </summary>
public interface IJobSignalPublisher
{
    Task TryPublishAsync(Guid jobId, CancellationToken ct = default);
}

public sealed class RabbitMqOptions
{
    public const string Section = "RabbitMq";
    public bool Enabled { get; set; }
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string User { get; set; } = "guest";
    public string Pass { get; set; } = "guest";
    public string Queue { get; set; } = "beautyasist.jobs";
}

/// <summary>RabbitMQ kapalıyken kayıtlı no-op — DurableJobQueue koşulsuz publish çağırabilsin.</summary>
public sealed class NoopJobSignalPublisher : IJobSignalPublisher
{
    public Task TryPublishAsync(Guid jobId, CancellationToken ct = default) => Task.CompletedTask;
}

/// <summary>Tembel tek bağlantı + kanal; her hata yutulur (sinyal best-effort, garanti DB'de).</summary>
public sealed class RabbitMqJobSignalPublisher : IJobSignalPublisher, IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<RabbitMqJobSignalPublisher> _logger;
    private readonly SemaphoreSlim _connectLock = new(1, 1);
    private IConnection? _connection;
    private IChannel? _channel;

    public RabbitMqJobSignalPublisher(IConfiguration configuration, ILogger<RabbitMqJobSignalPublisher> logger)
    {
        _options = configuration.GetSection(RabbitMqOptions.Section).Get<RabbitMqOptions>() ?? new RabbitMqOptions();
        _logger = logger;
    }

    public async Task TryPublishAsync(Guid jobId, CancellationToken ct = default)
    {
        try
        {
            var channel = await GetChannelAsync(ct);
            var body = System.Text.Encoding.UTF8.GetBytes(jobId.ToString());
            await channel.BasicPublishAsync(
                exchange: string.Empty,
                routingKey: _options.Queue,
                mandatory: false,
                basicProperties: new BasicProperties { Persistent = true },
                body: body,
                cancellationToken: ct);
        }
        catch (Exception ex)
        {
            // Broker yoksa/koptuysa poller devralır; iş DB'de güvende.
            _logger.LogWarning(ex, "RabbitMQ iş sinyali gönderilemedi (jobId={JobId}); poller devralacak.", jobId);
            await ResetAsync();
        }
    }

    private async Task<IChannel> GetChannelAsync(CancellationToken ct)
    {
        if (_channel is { IsOpen: true }) return _channel;
        await _connectLock.WaitAsync(ct);
        try
        {
            if (_channel is { IsOpen: true }) return _channel;
            var factory = new ConnectionFactory
            {
                HostName = _options.Host,
                Port = _options.Port,
                UserName = _options.User,
                Password = _options.Pass,
            };
            _connection = await factory.CreateConnectionAsync(ct);
            _channel = await _connection.CreateChannelAsync(cancellationToken: ct);
            await _channel.QueueDeclareAsync(_options.Queue, durable: true, exclusive: false, autoDelete: false, cancellationToken: ct);
            return _channel;
        }
        finally
        {
            _connectLock.Release();
        }
    }

    private async Task ResetAsync()
    {
        try { if (_channel is not null) await _channel.DisposeAsync(); } catch { /* kapanış */ }
        try { if (_connection is not null) await _connection.DisposeAsync(); } catch { /* kapanış */ }
        _channel = null;
        _connection = null;
    }

    public async ValueTask DisposeAsync() => await ResetAsync();
}

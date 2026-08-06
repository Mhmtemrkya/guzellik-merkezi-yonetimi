using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace GuzellikMerkezi.Api.Background;

/// <summary>
/// RabbitMQ iş sinyali tüketicisi (outbox + broker deseninin tüketici yarısı).
/// Mesaj yalnızca job Id taşır; işin kendisi background_jobs satırıdır — böylece
/// mesaj çift gelse/kaybolsa bile doğruluk bozulmaz (DB durumu tek gerçek).
/// Broker'a bağlanamazsa aralıklı yeniden dener; bu sırada DB poller işleri taşır.
/// </summary>
public sealed class RabbitMqJobConsumerHostedService : BackgroundService
{
    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(5);

    private readonly RabbitMqOptions _options;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RabbitMqJobConsumerHostedService> _logger;

    public RabbitMqJobConsumerHostedService(IConfiguration configuration, IServiceScopeFactory scopeFactory, ILogger<RabbitMqJobConsumerHostedService> logger)
    {
        _options = configuration.GetSection(RabbitMqOptions.Section).Get<RabbitMqOptions>() ?? new RabbitMqOptions();
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConsumeLoopAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "RabbitMQ tüketici bağlantısı koptu; {Delay}sn sonra yeniden denenecek (poller devrede).", ReconnectDelay.TotalSeconds);
                try { await Task.Delay(ReconnectDelay, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task ConsumeLoopAsync(CancellationToken ct)
    {
        var factory = new ConnectionFactory
        {
            HostName = _options.Host,
            Port = _options.Port,
            UserName = _options.User,
            Password = _options.Pass,
        };
        await using var connection = await factory.CreateConnectionAsync(ct);
        await using var channel = await connection.CreateChannelAsync(cancellationToken: ct);
        await channel.QueueDeclareAsync(_options.Queue, durable: true, exclusive: false, autoDelete: false, cancellationToken: ct);
        await channel.BasicQosAsync(0, prefetchCount: 5, global: false, ct);
        _logger.LogInformation("RabbitMQ iş tüketicisi bağlandı ({Host}:{Port}/{Queue}).", _options.Host, _options.Port, _options.Queue);

        var consumer = new AsyncEventingBasicConsumer(channel);
        consumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                if (Guid.TryParse(System.Text.Encoding.UTF8.GetString(ea.Body.Span), out var jobId))
                    await ProcessJobAsync(jobId, ct);
                await channel.BasicAckAsync(ea.DeliveryTag, multiple: false, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "RabbitMQ iş mesajı işlenemedi; ack'lenip poller'a bırakılıyor.");
                // Ack yine de ver: iş DB'de, poller backoff'la yeniden dener. Requeue fırtınası olmasın.
                try { await channel.BasicAckAsync(ea.DeliveryTag, multiple: false, ct); } catch { /* kanal kapanmış olabilir */ }
            }
        };
        await channel.BasicConsumeAsync(_options.Queue, autoAck: false, consumer, ct);

        // Bağlantı düşene ya da kapanışa kadar bekle.
        while (!ct.IsCancellationRequested && connection.IsOpen)
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
        if (!connection.IsOpen) throw new InvalidOperationException("RabbitMQ bağlantısı kapandı.");
    }

    /// <summary>
    /// Sinyali gelen tek işi işler — DurableJobHostedService ile AYNI sahiplenme protokolü.
    ///
    /// <para>
    /// Bu yol ile DB poller aynı satır için yarışabilir (broker sinyali ile poll turu çakışır).
    /// Sahiplenme koşullu tek UPDATE olduğu için yalnız biri kazanır; kaybeden hiç çalışmaz.
    /// Eskiden ikisi de okuyup ikisi de handler'ı çalıştırabiliyordu — handler dış dünyaya
    /// yazdığından (WhatsApp, push) müşteriye çift mesaj gidiyordu.
    /// </para>
    /// </summary>
    private async Task ProcessJobAsync(Guid jobId, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var job = await db.BackgroundJobs.FirstOrDefaultAsync(j => j.Id == jobId, ct);
        if (job is null) return; // satır yok (temizlenmiş) — mesaj güvenle yutulur

        var token = Guid.NewGuid().ToString("N");
        if (!await DurableJobClaim.TryClaimAsync(db, job, token, LockDuration, ct))
            return; // poller almış ya da bitmiş — mesaj güvenle yutulur

        // KİLİT KALP ATIŞI — DB poller ile AYNI ortak yardımcı.
        //
        // SOMUT AÇIK: bu yol 5 dakikalık kirayı hiç uzatmıyordu. Uzun süren bir iş (yavaş Meta/SMTP
        // çağrısı) sürerken kira doluyor, DB poller işi "bayat" sayıp YENİDEN çalıştırıyordu —
        // handler dış dünyaya yazdığı için müşteriye çift mesaj gidiyordu.
        var heartbeat = DurableJobClaim.KeepAlive(_scopeFactory, job.Id, token, LockDuration);

        bool succeeded;
        string? error = null;
        try
        {
            var handler = scope.ServiceProvider.GetServices<IDurableJobHandler>()
                .FirstOrDefault(h => string.Equals(h.JobType, job.Type, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"'{job.Type}' için kayıtlı handler yok.");
            await handler.ExecuteAsync(job.PayloadJson, ct);
            succeeded = true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await heartbeat.DisposeAsync();
            throw;
        }
        catch (Exception ex)
        {
            succeeded = false;
            error = ex.Message;
            _logger.LogWarning(ex, "Kalıcı iş başarısız (RabbitMQ yolu, type={Type}, attempt={Attempt}/{Max}).",
                job.Type, job.Attempts + 1, job.MaxAttempts);
        }

        await heartbeat.DisposeAsync();

        if (!await DurableJobClaim.TryCompleteAsync(db, job, token, succeeded, error, ct))
        {
            _logger.LogWarning(
                "Kalıcı iş sonucu yazılamadı, sahiplenme kaybedilmiş (RabbitMQ yolu, id={JobId}, type={Type}).",
                job.Id, job.Type);
        }
    }
}

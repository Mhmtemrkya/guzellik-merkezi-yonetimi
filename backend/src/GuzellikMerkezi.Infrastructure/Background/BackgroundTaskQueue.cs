using System.Threading.Channels;
using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Infrastructure.Background;

/// <summary>
/// <see cref="IBackgroundTaskQueue"/> — bounded <see cref="Channel{T}"/> tabanlı FIFO kuyruk (singleton).
/// Kapasite dolarsa üretici düşürmek yerine kısa süre bekletilir (best-effort gönderim kaybolmasın).
/// </summary>
public sealed class BackgroundTaskQueue : IBackgroundTaskQueue
{
    private readonly Channel<Func<IServiceProvider, CancellationToken, Task>> _channel;

    public BackgroundTaskQueue(int capacity = 1000)
    {
        _channel = Channel.CreateBounded<Func<IServiceProvider, CancellationToken, Task>>(
            new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleReader = true,   // tek consumer (QueuedHostedService)
                SingleWriter = false,  // çok endpoint/servis yazar
            });
    }

    public int PendingCount => _channel.Reader.Count;

    public void Enqueue(Func<IServiceProvider, CancellationToken, Task> workItem)
    {
        ArgumentNullException.ThrowIfNull(workItem);
        // Senkron TryWrite çağıranı bloke etmez. Kuyruk doluysa (nadir) yazımı arka plana bırakarak
        // ertele — düşürme; ValueTask fault'lanmaz (bounded/wait kanalı).
        if (!_channel.Writer.TryWrite(workItem))
            _ = _channel.Writer.WriteAsync(workItem);
    }

    public ValueTask<Func<IServiceProvider, CancellationToken, Task>> DequeueAsync(CancellationToken cancellationToken)
        => _channel.Reader.ReadAsync(cancellationToken);
}

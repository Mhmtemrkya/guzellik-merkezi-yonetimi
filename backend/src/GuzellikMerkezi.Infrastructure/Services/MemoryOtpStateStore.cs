using System.Collections.Concurrent;
using GuzellikMerkezi.Application.Abstractions;
using Microsoft.Extensions.Caching.Memory;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// <see cref="IOtpStateStore"/>'un PROCESS İÇİ uygulaması — Redis yapılandırılmadığında kullanılır.
///
/// <para>
/// Tek instance kurulumunda davranışı Redis'inkiyle aynıdır; TEK farkı yeniden başlatmada durumun
/// kaybolmasıdır (kodlar düşer, kullanıcı yeni kod ister). Çok instance'a geçildiğinde bu uygulama
/// YETMEZ — bkz. <see cref="IOtpStateStore"/> ve <c>Redis:ConnectionString</c>.
/// </para>
/// <para>
/// Atomiklik anahtar başına bir <see cref="SemaphoreSlim"/> ile sağlanır. Nesne üzerinde
/// <c>lock</c> tutmak yeterli DEĞİLDİ: kayıt önbellekte yoksa kilitlenecek bir nesne de yoktur,
/// dolayısıyla "yoktan oluştur" yolu yarışa açık kalırdı.
/// </para>
/// </summary>
public sealed class MemoryOtpStateStore : IOtpStateStore
{
    private readonly IMemoryCache _cache;

    /// <summary>
    /// Anahtar başına kilit. Sözlükten kayıt SİLİNMEZ: anahtar uzayı sınırlıdır (telefon/challenge
    /// başına bir giriş) ve silme, kilidi tutan bir çağrı varken yeni bir semafor üretilmesine yol
    /// açarak kilidi işlevsiz bırakırdı.
    /// </summary>
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new(StringComparer.Ordinal);

    public MemoryOtpStateStore(IMemoryCache cache) => _cache = cache;

    public Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class =>
        Task.FromResult(_cache.TryGetValue<T>(key, out var value) ? value : null);

    public Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default) where T : class
    {
        _cache.Set(key, value, ttl);
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key, CancellationToken ct = default)
    {
        _cache.Remove(key);
        return Task.CompletedTask;
    }

    public async Task<long> IncrementAsync(string key, TimeSpan window, CancellationToken ct = default)
    {
        var gate = Locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            // Pencere YALNIZ ilk artırımda kurulur; sonraki artırımlar uzatmaz (sabit pencere).
            var current = _cache.TryGetValue<long>(key, out var v) ? v : 0L;
            var next = current + 1;
            if (current == 0) _cache.Set(key, next, window);
            else _cache.Set(key, next, GetRemaining(key, window));
            return next;
        }
        finally { gate.Release(); }
    }

    public async Task<TResult> MutateAsync<TState, TResult>(
        string key,
        TimeSpan ttl,
        Func<TState?, (TState? Next, TResult Result)> mutator,
        CancellationToken ct = default) where TState : class
    {
        var gate = Locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var current = _cache.TryGetValue<TState>(key, out var value) ? value : null;
            var (next, result) = mutator(current);
            if (next is null) _cache.Remove(key);
            else _cache.Set(key, next, ttl);
            return result;
        }
        finally { gate.Release(); }
    }

    /// <summary>
    /// Sabit pencerenin kalan süresi. <see cref="IMemoryCache"/> kalan ömrü OKUTMAZ, bu yüzden
    /// pencere başlangıcı ayrı bir anahtarda tutulur; yoksa pencere yeniden kurulur.
    /// </summary>
    private TimeSpan GetRemaining(string key, TimeSpan window)
    {
        var startKey = key + ":window-start";
        if (!_cache.TryGetValue<DateTimeOffset>(startKey, out var start))
        {
            start = DateTimeOffset.UtcNow;
            _cache.Set(startKey, start, window);
        }
        var remaining = window - (DateTimeOffset.UtcNow - start);
        return remaining > TimeSpan.Zero ? remaining : TimeSpan.FromSeconds(1);
    }
}

using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// <see cref="IOtpStateStore"/>'un REDIS uygulaması — <c>Redis:ConnectionString</c> verildiğinde
/// devreye girer.
///
/// <para>
/// Kazanç iki katmanlıdır: durum process dışında yaşar (yeniden başlatma kodları düşürmez) ve
/// birden çok instance aynı depoyu görür (kodu üreten ile doğrulayan aynı olmak zorunda değil,
/// hız sınırı sayaçları da instance sayısıyla çarpılmaz).
/// </para>
/// <para>
/// <b>TTL depo seviyesindedir.</b> Süre dolduğunda anahtar Redis tarafından silinir; uygulama
/// tarafında "acaba süresi doldu mu" kontrolü YAPILMAZ — o kontrol, saati kayan bir sunucuda
/// süresi geçmiş kodu geçerli sayabilirdi.
/// </para>
/// </summary>
public sealed class RedisOtpStateStore : IOtpStateStore
{
    /// <summary>Anahtar ön eki: aynı Redis örneği SignalR backplane ve başka işler için de kullanılıyor olabilir.</summary>
    private readonly string _prefix;
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<RedisOtpStateStore> _logger;

    /// <summary>
    /// Dağıtık kilidin ömrü. Kilidi alan süreç çökerse anahtar bu süre sonunda kendiliğinden
    /// serbest kalır — aksi hâlde tek bir çökme o kullanıcının girişini kalıcı olarak kilitlerdi.
    /// Mutator'ın saf ve hızlı olması sözleşme gereği olduğundan (bkz. <see cref="IOtpStateStore"/>)
    /// 5 saniye fazlasıyla yeterlidir.
    /// </summary>
    private static readonly TimeSpan LockTtl = TimeSpan.FromSeconds(5);

    /// <summary>Kilit beklemesinin üst sınırı; aşılırsa istek reddedilir (süresiz beklemek yerine).</summary>
    private static readonly TimeSpan LockWaitTimeout = TimeSpan.FromSeconds(10);

    /// <summary>
    /// SAYAÇ ARTIRIMI TEK ADIMDA. <c>INCR</c> + <c>EXPIRE</c> iki ayrı komut olsaydı, aradaki
    /// çökme sayacı ÖMÜRSÜZ bırakır ve kullanıcı o numarayla bir daha hiç kod isteyemezdi.
    /// Ömür yalnız sayaç ilk kez oluşturulduğunda (sonuç 1) kurulur: sabit pencere.
    /// </summary>
    private const string IncrementScript = @"
        local value = redis.call('INCR', KEYS[1])
        if value == 1 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
        end
        return value";

    /// <summary>
    /// KİLİDİ YALNIZ SAHİBİ AÇAR. Düz <c>DEL</c> olsaydı, süresi dolmuş bir kilidi bu arada
    /// başkasının aldığı durumda o sahibin kilidini silerdik ve karşılıklı dışlama çökerdi.
    /// </summary>
    private const string ReleaseScript = @"
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        end
        return 0";

    public RedisOtpStateStore(IConnectionMultiplexer redis, ILogger<RedisOtpStateStore> logger, string? prefix = null)
    {
        _redis = redis;
        _logger = logger;
        _prefix = string.IsNullOrWhiteSpace(prefix) ? "beautyasist:otp:" : prefix!;
    }

    private IDatabase Db => _redis.GetDatabase();
    private RedisKey Key(string key) => _prefix + key;

    public async Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class
    {
        var raw = await Db.StringGetAsync(Key(key));
        return Deserialize<T>(raw);
    }

    public Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default) where T : class =>
        Db.StringSetAsync(Key(key), JsonSerializer.Serialize(value), ttl);

    public Task RemoveAsync(string key, CancellationToken ct = default) =>
        Db.KeyDeleteAsync(Key(key));

    public async Task<long> IncrementAsync(string key, TimeSpan window, CancellationToken ct = default)
    {
        var result = await Db.ScriptEvaluateAsync(
            IncrementScript,
            [Key(key)],
            [(long)window.TotalMilliseconds]);
        return (long)result;
    }

    public async Task<TResult> MutateAsync<TState, TResult>(
        string key,
        TimeSpan ttl,
        Func<TState?, (TState? Next, TResult Result)> mutator,
        CancellationToken ct = default) where TState : class
    {
        var lockKey = Key(key + ":lock");
        var token = Guid.NewGuid().ToString("N");
        if (!await AcquireLockAsync(lockKey, token, ct))
        {
            // Kilit alınamadı: bu, aynı anahtar üzerinde başka bir doğrulamanın sürdüğü anlamına
            // gelir. Kilitsiz devam etmek tek-kullanım garantisini bozardı, o yüzden atılır.
            throw new TimeoutException($"OTP durumu için kilit alınamadı: {key}");
        }

        try
        {
            var current = Deserialize<TState>(await Db.StringGetAsync(Key(key)));
            var (next, result) = mutator(current);
            if (next is null) await Db.KeyDeleteAsync(Key(key));
            else await Db.StringSetAsync(Key(key), JsonSerializer.Serialize(next), ttl);
            return result;
        }
        finally
        {
            try { await Db.ScriptEvaluateAsync(ReleaseScript, [lockKey], [token]); }
            catch (RedisException ex)
            {
                // Kilit kendi ömrüyle zaten serbest kalacak; isteği bu yüzden başarısız saymayız.
                _logger.LogWarning(ex, "OTP kilidi serbest bırakılamadı: {Key}", key);
            }
        }
    }

    private async Task<bool> AcquireLockAsync(RedisKey lockKey, string token, CancellationToken ct)
    {
        var deadline = DateTimeOffset.UtcNow + LockWaitTimeout;
        var delay = TimeSpan.FromMilliseconds(20);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (await Db.StringSetAsync(lockKey, token, LockTtl, When.NotExists)) return true;
            await Task.Delay(delay, ct);
            // Kademeli geri çekilme: yoğun bir anahtarda Redis'i sabit aralıkla dövmemek için.
            if (delay < TimeSpan.FromMilliseconds(200)) delay *= 2;
        }
        return false;
    }

    private static T? Deserialize<T>(RedisValue raw) where T : class
    {
        if (raw.IsNullOrEmpty) return null;
        // RedisValue hem string hem ReadOnlySpan<byte>'a örtük dönüştüğü için aşırı yükleme
        // belirsiz kalıyor; hedef tip açıkça seçilir.
        try { return JsonSerializer.Deserialize<T>((string)raw!); }
        catch (JsonException)
        {
            // Biçimi bozuk kayıt = kayıt yok. Atmak, kullanıcıyı "yeni kod iste" akışına düşürür;
            // istisna fırlatmak girişi tamamen kilitlerdi.
            return null;
        }
    }
}

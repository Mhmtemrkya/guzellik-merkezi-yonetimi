namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// KISA ÖMÜRLÜ KİMLİK DOĞRULAMA DURUMUNUN DEPOSU — doğrulama kodları, panel giriş challenge'ı,
/// kurum kayıt taslağı ve hız sınırı sayaçları.
///
/// <para>
/// <b>Neden ayrı bir soyutlama?</b> Bu durum <see cref="Microsoft.Extensions.Caching.Memory.IMemoryCache"/>
/// içinde tutuluyordu, yani <b>process belleğinde</b>. Sonuçları:
/// </para>
/// <list type="bullet">
///   <item>Backend yeniden başlatıldığında (deploy dahil) o an geçerli TÜM kodlar kaybolur;
///         kullanıcı elindeki doğru kodu girer ve "süresi doldu" cevabı alır.</item>
///   <item>Birden çok instance'a geçildiğinde kodu üreten instance ile doğrulayan instance
///         farklı olabilir ve doğru kod reddedilir.</item>
///   <item>Hız sınırı sayaçları her instance'ta ayrı tutulduğu için toplam sınır instance
///         sayısıyla çarpılır.</item>
/// </list>
///
/// <para>
/// <b>Atomiklik burada bir ayrıntı değil, sözleşmenin kendisidir.</b> "Oku → karşılaştır → sil"
/// üç ayrı adım olarak yapılırsa aynı kodu taşıyan iki eşzamanlı istek ikisi de kaydı okuyup İKİ
/// ayrı oturum açabilir; deneme sayacı da yarışta kaybolur ve yanlış deneme freni delinir. Bu
/// yüzden okuma-değiştirme-yazma döngüsü <see cref="MutateAsync"/> ile, sayaç artırımı ise
/// <see cref="IncrementAsync"/> ile yapılır — ikisi de uygulama tarafından değil, DEPO tarafından
/// bölünmez kılınır.
/// </para>
/// </summary>
public interface IOtpStateStore
{
    /// <summary>Kayıtlı durumu okur; yoksa (ya da süresi dolduysa) <c>null</c>.</summary>
    Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class;

    /// <summary>Durumu yazar ve ömrünü <paramref name="ttl"/> olarak ayarlar (varsa üzerine yazar).</summary>
    Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default) where T : class;

    /// <summary>Durumu siler. Kayıt yoksa sessizce başarılıdır.</summary>
    Task RemoveAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Sayacı bölünmez biçimde 1 artırır ve YENİ değeri döner. Sayaç ilk kez oluşturulduğunda
    /// ömrü <paramref name="window"/> olur; sonraki artırımlar pencereyi UZATMAZ (kayan değil,
    /// sabit pencere — kullanıcı sürekli deneyerek sınırı süresiz tutamaz).
    /// </summary>
    Task<long> IncrementAsync(string key, TimeSpan window, CancellationToken ct = default);

    /// <summary>
    /// Oku-değiştir-yaz döngüsünü BÖLÜNMEZ biçimde yürütür: <paramref name="mutator"/> çalışırken
    /// aynı anahtar üzerinde başka hiçbir çağrı ilerleyemez.
    ///
    /// <para>
    /// <paramref name="mutator"/>, mevcut durumu (yoksa <c>null</c>) alır ve ne yazılacağını
    /// döner: <c>Next</c> <c>null</c> ise kayıt SİLİNİR, değilse <paramref name="ttl"/> ile
    /// yazılır. <c>Result</c> çağırana döner.
    /// </para>
    /// <para>
    /// <b>Mutator saf ve hızlı olmalıdır:</b> içinde ağ, veritabanı ya da mesaj gönderimi
    /// YAPILMAZ. Kilit süresi boyunca aynı kullanıcının diğer istekleri bekler; dahası dağıtık
    /// kilidin kendi ömrü vardır ve uzun süren bir işlem kilidin altından kayabilir.
    /// </para>
    /// </summary>
    Task<TResult> MutateAsync<TState, TResult>(
        string key,
        TimeSpan ttl,
        Func<TState?, (TState? Next, TResult Result)> mutator,
        CancellationToken ct = default) where TState : class;
}

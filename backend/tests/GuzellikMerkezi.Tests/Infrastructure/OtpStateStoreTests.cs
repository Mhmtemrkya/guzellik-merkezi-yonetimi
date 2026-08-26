using System.Text.Json;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.Extensions.Caching.Memory;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// OTP DURUM DEPOSUNUN SÖZLEŞMESİ.
///
/// <para>
/// Burada doğrulanan davranışlar, kimlik doğrulamanın doğruluğunu taşıdığı için "yardımcı sınıf
/// testi" değildir: sayacın atomikliği yanlış deneme frenini, tek-kullanım ise kodun iki oturum
/// açamamasını garanti eder.
/// </para>
/// </summary>
public sealed class OtpStateStoreTests
{
    private static MemoryOtpStateStore NewStore() =>
        new(new MemoryCache(new MemoryCacheOptions()));

    private sealed class State
    {
        public string Code { get; set; } = string.Empty;
        public int Attempts { get; set; }
    }

    [Fact]
    public async Task SetGetRemove_RoundTrips()
    {
        var store = NewStore();
        var key = Guid.NewGuid().ToString("N");

        Assert.Null(await store.GetAsync<State>(key));

        await store.SetAsync(key, new State { Code = "123456" }, TimeSpan.FromMinutes(5));
        Assert.Equal("123456", (await store.GetAsync<State>(key))!.Code);

        await store.RemoveAsync(key);
        Assert.Null(await store.GetAsync<State>(key));
    }

    /// <summary>Süresi dolan kayıt OKUNAMAZ — ömür deponun sorumluluğudur.</summary>
    [Fact]
    public async Task Expired_IsNotReadable()
    {
        var store = NewStore();
        var key = Guid.NewGuid().ToString("N");

        await store.SetAsync(key, new State { Code = "123456" }, TimeSpan.FromMilliseconds(30));
        await Task.Delay(120);

        Assert.Null(await store.GetAsync<State>(key));
    }

    /// <summary>
    /// SAYAÇ ATOMİK ARTMALI. Eşzamanlı 50 artırım, oku-artır-yaz yarışında kaybolan güncellemeler
    /// yüzünden 50'nin altında kalırsa yanlış deneme freni delinebilir demektir.
    /// </summary>
    [Fact]
    public async Task Increment_IsAtomicUnderConcurrency()
    {
        var store = NewStore();
        var key = Guid.NewGuid().ToString("N");

        var results = await Task.WhenAll(Enumerable.Range(0, 50)
            .Select(_ => store.IncrementAsync(key, TimeSpan.FromMinutes(1))));

        Assert.Equal(50, results.Max());
        // Her çağrı BENZERSİZ bir değer görmeli: aynı numarayı iki çağrının alması, sayacın
        // atomik olmadığının kanıtı olurdu.
        Assert.Equal(50, results.Distinct().Count());
    }

    /// <summary>
    /// TEK KULLANIM. 20 eşzamanlı "tüket" çağrısından YALNIZ BİRİ başarılı olmalı; ikisi
    /// başarılı olsaydı tek kod iki oturum açardı.
    /// </summary>
    [Fact]
    public async Task Mutate_ConsumesOnlyOnce()
    {
        var store = NewStore();
        var key = Guid.NewGuid().ToString("N");
        await store.SetAsync(key, new State { Code = "123456" }, TimeSpan.FromMinutes(5));

        var wins = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ =>
            store.MutateAsync<State, bool>(key, TimeSpan.FromMinutes(5), current =>
                current is null ? (null, false) : (null, true))));

        Assert.Equal(1, wins.Count(w => w));
        Assert.Null(await store.GetAsync<State>(key));
    }

    /// <summary>Mutator null döndürmezse kayıt yazılır ve sonraki okumada görünür.</summary>
    [Fact]
    public async Task Mutate_PersistsUpdatedState()
    {
        var store = NewStore();
        var key = Guid.NewGuid().ToString("N");
        await store.SetAsync(key, new State { Code = "123456" }, TimeSpan.FromMinutes(5));

        await store.MutateAsync<State, bool>(key, TimeSpan.FromMinutes(5), current =>
        {
            current!.Attempts++;
            return (current, true);
        });

        Assert.Equal(1, (await store.GetAsync<State>(key))!.Attempts);
    }

    /// <summary>
    /// REDIS TUZAĞI: <see cref="JsonSerializer"/> ALANLARI serileştirmez, yalnız property'leri.
    ///
    /// <para>
    /// <c>CustomerOtpService.OtpEntry</c> bir zamanlar public ALAN kullanıyordu. Durum process
    /// belleğindeyken bu görünmezdi (nesne referansı olduğu gibi saklanır), ama Redis'e yazılıp
    /// geri okunduğunda Code/Identity/Attempts sessizce varsayılana döner ve HİÇBİR kod
    /// doğrulanamazdı. Bu test o sınıfın serileştirilebilir kaldığını sabitler.
    /// </para>
    /// </summary>
    [Fact]
    public void OtpEntry_SurvivesJsonRoundTrip()
    {
        var type = typeof(GuzellikMerkezi.Api.Services.CustomerOtpService).GetNestedType(
            "OtpEntry", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
        Assert.NotNull(type);

        var entry = Activator.CreateInstance(type!)!;
        type!.GetProperty("Code")!.SetValue(entry, "654321");
        type.GetProperty("Identity")!.SetValue(entry, "ayse|5551112233");
        type.GetProperty("Attempts")!.SetValue(entry, 3);
        type.GetProperty("PhoneProven")!.SetValue(entry, true);

        var restored = JsonSerializer.Deserialize(JsonSerializer.Serialize(entry, type), type)!;

        Assert.Equal("654321", type.GetProperty("Code")!.GetValue(restored));
        Assert.Equal("ayse|5551112233", type.GetProperty("Identity")!.GetValue(restored));
        Assert.Equal(3, type.GetProperty("Attempts")!.GetValue(restored));
        Assert.Equal(true, type.GetProperty("PhoneProven")!.GetValue(restored));
    }
}

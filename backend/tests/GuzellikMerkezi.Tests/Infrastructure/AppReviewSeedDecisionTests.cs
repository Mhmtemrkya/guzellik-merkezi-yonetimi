using GuzellikMerkezi.Api.Setup;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// İNCELEME BAYRAĞININ İKİ AYRI ÖMRÜ — "inceleme modu açık" ≠ "demo kurumu kur".
///
/// <para>
/// <c>AppReview:Enabled</c> iki işi birden yapıyordu: müşteri OTP'sinde sabit kodu kabul etmek ve
/// inceleme kurumunu kurmak. İkincisi <c>OwnerEmail/OwnerPassword</c> olmadan açılışta
/// FIRLATIYORDU. Kısayolu bayrakla yönetilir hâle getirip canlıda <c>Enabled=true</c> verince
/// backend çökme döngüsüne girdi ve API bir süre kapalı kaldı (19 Eyl 2026).
/// </para>
///
/// <para>
/// Bu dosya ayrımı sabitler: <b>hesap kurulumu bayrakla değil, sahip bilgilerinin VARLIĞIYLA
/// istenir.</b> Fail-fast kaldırılmadı, yalnız gerçekten yarım olan yapılandırmaya daraltıldı.
/// Seeder'ın hiç testi yoktu — kesintiyi yakalayabilecek tek kapı buydu.
/// </para>
/// </summary>
public sealed class AppReviewSeedDecisionTests
{
    private static IConfiguration Config(params (string Key, string Value)[] pairs) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build();

    /// <summary>
    /// KESİNTİNİN TAM SENARYOSU: inceleme modu açık, kurulacak hesap tarif edilmemiş.
    /// </summary>
    /// <remarks>
    /// Canlının bu deploy'dan sonraki hedef durumu tam olarak budur: OTP kısayolu bayrakla açık,
    /// demo kurum İSTENMİYOR. Eskiden burası <c>InvalidOperationException</c> fırlatıyor ve
    /// uygulama hiç ayağa kalkmıyordu.
    /// </remarks>
    [Fact]
    public void Enabled_AmaSahipBilgisiYok_Firlatmaz_VeKurulumIstemez()
    {
        var config = Config(("AppReview:Enabled", "true"));

        var seed = AppReviewAccountSeeder.ShouldSeedAccount(config, out var warning);

        Assert.False(seed);
        // Sessizce geçilmez: log, kurumun NEDEN kurulmadığını söyler.
        Assert.NotNull(warning);
        Assert.Contains("OwnerEmail", warning);
    }

    /// <summary>Bayrak kapalıyken sahip bilgisi dolu olsa bile hiçbir şey kurulmaz ve uyarı da yok.</summary>
    [Fact]
    public void Kapali_SahipBilgisiOlsaBile_KurulumIstemez()
    {
        var config = Config(
            ("AppReview:Enabled", "false"),
            ("AppReview:OwnerEmail", "denetci@example.com"),
            ("AppReview:OwnerPassword", "cokGuclu123"));

        var seed = AppReviewAccountSeeder.ShouldSeedAccount(config, out var warning);

        Assert.False(seed);
        Assert.Null(warning);
    }

    /// <summary>Bayrak hiç tanımlı değilse de kurulum yapılmaz.</summary>
    [Fact]
    public void BayrakYok_KurulumIstemez()
    {
        var seed = AppReviewAccountSeeder.ShouldSeedAccount(Config(), out var warning);

        Assert.False(seed);
        Assert.Null(warning);
    }

    /// <summary>
    /// YARIM YAPILANDIRMA HÂLÂ FIRLATIR: biri verilip diğeri unutulduysa sessiz geçmek,
    /// "hesap açıldı" sanılıp mağazaya yanlış giriş bilgisi verilmesine yol açar.
    /// </summary>
    [Fact]
    public void Enabled_YalnizEposta_Firlatir()
    {
        var config = Config(
            ("AppReview:Enabled", "true"),
            ("AppReview:OwnerEmail", "denetci@example.com"));

        var ex = Assert.Throws<InvalidOperationException>(
            () => AppReviewAccountSeeder.ShouldSeedAccount(config, out _));
        Assert.Contains("yalnız biri", ex.Message);
    }

    [Fact]
    public void Enabled_YalnizParola_Firlatir()
    {
        var config = Config(
            ("AppReview:Enabled", "true"),
            ("AppReview:OwnerPassword", "cokGuclu123"));

        Assert.Throws<InvalidOperationException>(
            () => AppReviewAccountSeeder.ShouldSeedAccount(config, out _));
    }

    [Fact]
    public void Enabled_KisaParola_Firlatir()
    {
        var config = Config(
            ("AppReview:Enabled", "true"),
            ("AppReview:OwnerEmail", "denetci@example.com"),
            ("AppReview:OwnerPassword", "kisa"));

        var ex = Assert.Throws<InvalidOperationException>(
            () => AppReviewAccountSeeder.ShouldSeedAccount(config, out _));
        Assert.Contains("8 karakter", ex.Message);
    }

    /// <summary>Tam yapılandırmada kurulum İSTENİR — demo kurum açma yolu kapanmadı.</summary>
    [Fact]
    public void Enabled_TamYapilandirma_KurulumIster()
    {
        var config = Config(
            ("AppReview:Enabled", "true"),
            ("AppReview:OwnerEmail", "denetci@example.com"),
            ("AppReview:OwnerPassword", "cokGuclu123"));

        var seed = AppReviewAccountSeeder.ShouldSeedAccount(config, out var warning);

        Assert.True(seed);
        Assert.Null(warning);
    }

    /// <summary>
    /// OTP KISAYOLU BU KARARDAN BAĞIMSIZDIR — ikisi aynı bayrağı okur ama farklı şeyler yapar.
    /// </summary>
    /// <remarks>
    /// Kısayolun kendi davranışı <c>StoreReviewOtpTests</c>'te sabitlenir. Burada sabitlenen şey,
    /// kısayolu açmak için verilen bayrağın kurumu kurmaya ÇALIŞMAMASI — yani canlının hedef
    /// yapılandırmasının uygulamayı başlatabiliyor olması.
    /// </remarks>
    [Fact]
    public void KisayolIcinVerilenBayrak_AcilisiBozmaz()
    {
        var config = Config(
            ("AppReview:Enabled", "true"),
            ("AppReview:CustomerPhone", "+90 555 000 11 22"),
            ("AppReview:CustomerOtpCode", "424242"));

        var seed = AppReviewAccountSeeder.ShouldSeedAccount(config, out var warning);

        Assert.False(seed);
        Assert.NotNull(warning);
    }
}

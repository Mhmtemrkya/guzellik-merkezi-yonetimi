using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Tests.Application;

/// <summary>
/// DOĞRULAMA KODU E-POSTASI — markalı şablonun kırılmaması gereken yerleri.
///
/// <para>
/// Şablon bir tasarım PNG'sinden HTML'e çevrildi. Buradaki testler "güzel görünüyor mu"yu değil,
/// <b>kodun kullanıcıya ULAŞMASINI</b> sabitler: görsel engellense bile okunabilir olması,
/// geçerlilik süresinin akışın sabitinden türemesi ve kurum adının HTML'e sızmaması.
/// </para>
/// </summary>
public sealed class VerificationEmailTemplateTests
{
    private static VerificationEmailContent Sample(
        string code = "905641",
        string email = "kullanici@ornek.test",
        int minutes = 10,
        string operation = "Yönetici Girişi",
        string? tenant = "Burcu Bozkır Beauty",
        string? link = "https://beautyasist.com/login",
        string? note = "Bu girişi siz yapmadıysanız parolanızı hemen değiştirin.") =>
        new(code, email, TimeSpan.FromMinutes(minutes), operation, tenant, link, note);

    // ------------------------------------------------------------ kod okunabilirliği

    /// <summary>
    /// KOD METİNDİR, GÖRSEL DEĞİL. Gmail/Outlook tanımadığı göndericinin görsellerini varsayılan
    /// olarak engeller; kod piksel olsaydı kullanıcı onu HİÇ göremezdi.
    /// </summary>
    [Fact]
    public void Kod_metin_olarak_basilir_ve_gorsel_kullanilmaz()
    {
        var html = VerificationEmailTemplate.Build(Sample());

        Assert.Contains(">905641<", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<svg", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("background-image", html, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Diğer testler kodu gövdeden REGEX'le ayıklıyor (başka türlü bilmelerinin yolu yok).
    /// Şablon düzenlenirken bu iki desen kırılırsa OTP testlerinin tamamı sessizce boş kod
    /// doğrulamaya başlar — bu yüzden desenler burada da kilitlenir.
    /// </summary>
    [Fact]
    public void Testlerin_kod_ayiklama_desenleri_calismaya_devam_eder()
    {
        var html = VerificationEmailTemplate.Build(Sample());

        Assert.Equal("905641", Regex.Match(html, @">(\d{6})<").Groups[1].Value);
        Assert.Equal("905641", Regex.Match(html, @"letter-spacing:8px[^>]*>(\d{6})<").Groups[1].Value);
    }

    // ------------------------------------------------------------ geçerlilik

    [Theory]
    [InlineData(5, "5 Dakika")]
    [InlineData(10, "10 Dakika")]
    [InlineData(30, "30 Dakika")]
    [InlineData(60, "1 Saat")]
    [InlineData(90, "1 Saat 30 Dakika")]
    public void Gecerlilik_sureden_turer(int minutes, string expected)
    {
        Assert.Equal(expected, VerificationEmailTemplate.FormatValidity(TimeSpan.FromMinutes(minutes)));
        Assert.Contains(expected, VerificationEmailTemplate.Build(Sample(minutes: minutes)), StringComparison.Ordinal);
    }

    /// <summary>
    /// Süre metni ŞABLONDA SABİT YAZILMAZ. Tasarım görselinde örnek olarak "15 Dakika" geçiyor;
    /// o değer hiçbir akışın gerçek sabiti değil ve şablona kopyalanmamalı.
    /// </summary>
    [Fact]
    public void Tasarim_gorselindeki_ornek_sure_sablona_kopyalanmamis()
    {
        Assert.DoesNotContain("15 Dakika", VerificationEmailTemplate.Build(Sample(minutes: 10)), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------ bağlantı satırı

    /// <summary>
    /// Taban adres yapılandırılmamışsa (üretimde <c>App:PublicBaseUrl</c> varsayılanı BOŞTUR)
    /// satır hiç basılmaz — kimlik doğrulama e-postasında 404'e giden bir link, linksizlikten
    /// daha kötüdür.
    /// </summary>
    [Fact]
    public void Baglanti_yoksa_satir_hic_basilmaz()
    {
        var html = VerificationEmailTemplate.Build(Sample(link: null));

        Assert.DoesNotContain("Doğrulama Bağlantısı", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<a href", html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Baglanti_varsa_kisaltilmis_metinle_basilir()
    {
        var html = VerificationEmailTemplate.Build(Sample(link: "https://beautyasist.com/randevu/giris/"));

        Assert.Contains("Doğrulama Bağlantısı", html, StringComparison.Ordinal);
        Assert.Contains("href=\"https://beautyasist.com/randevu/giris/\"", html, StringComparison.Ordinal);
        Assert.Contains(">beautyasist.com/randevu/giris<", html, StringComparison.Ordinal);
    }

    /// <summary>
    /// <c>IConfiguration</c> tanımlı ama boş anahtar için <c>""</c> döner; <c>??</c> zinciri
    /// orada takılırdı. BuildLink boş adayları ATLAMALI, hepsi boşsa null dönmeli.
    /// </summary>
    [Fact]
    public void BuildLink_bos_adaylari_atlar()
    {
        Assert.Null(VerificationEmailTemplate.BuildLink("/login", null, "", "   "));
        Assert.Equal("https://x.test/login", VerificationEmailTemplate.BuildLink("/login", "", "https://x.test/"));
        Assert.Equal("https://x.test/login", VerificationEmailTemplate.BuildLink("login", "https://x.test"));
    }

    /// <summary>Mutlak olmayan / http-dışı adres basılmaz (javascript: gibi şemalar dahil).</summary>
    [Theory]
    [InlineData("beautyasist.com/login")]
    [InlineData("javascript:alert(1)")]
    [InlineData("/login")]
    public void Gecersiz_baglanti_basilmaz(string link)
    {
        Assert.DoesNotContain("Doğrulama Bağlantısı", VerificationEmailTemplate.Build(Sample(link: link)), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------ kaçış

    /// <summary>
    /// Kurum adı, işlem tipi ve e-posta kullanıcıdan gelir; HTML'e ham girerlerse e-posta
    /// gövdesine etiket enjekte edilebilirdi.
    /// </summary>
    [Fact]
    public void Kullanici_verisi_html_kacisindan_gecer()
    {
        var html = VerificationEmailTemplate.Build(Sample(
            email: "<b>x</b>@ornek.test",
            operation: "Giriş <script>",
            tenant: "Salon & <img src=x>"));

        Assert.DoesNotContain("<script>", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Salon &amp; &lt;img src=x&gt;", html, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------ tasarım bütünlüğü

    /// <summary>Kurum adı bilinmiyorsa başlık altındaki satır hiç basılmaz (boş şablon hâli).</summary>
    [Fact]
    public void Kurum_adi_yoksa_baslik_alti_bos_kalir()
    {
        var html = VerificationEmailTemplate.Build(Sample(tenant: null));

        Assert.Contains("DOĞRULAMA KODU BİLGİLERİ", html, StringComparison.Ordinal);
        Assert.DoesNotContain("font-style:italic", html, StringComparison.Ordinal);
    }

    /// <summary>Tasarımın sabit bölümleri (tasarım PNG'sinden birebir) gövdede yer alır.</summary>
    [Fact]
    public void Tasarimin_sabit_bolumleri_yerinde()
    {
        var html = VerificationEmailTemplate.Build(Sample());

        Assert.Contains("Beauty Asist", html, StringComparison.Ordinal);
        Assert.Contains("Beauty&amp;Wellness Technology", html, StringComparison.Ordinal);
        Assert.Contains("KOD DETAYLARI", html, StringComparison.Ordinal);
        Assert.Contains("Kodun süresi dolmadan kullanılması gerekir.", html, StringComparison.Ordinal);
        Assert.Contains("NASIL KULLANILIR?", html, StringComparison.Ordinal);
        Assert.Contains("ÖNEMLİ NOTLAR", html, StringComparison.Ordinal);
        Assert.Contains("Kod kişiye özeldir.", html, StringComparison.Ordinal);
        Assert.Contains("Aynı kod ikinci kez kullanılamaz.", html, StringComparison.Ordinal);
        Assert.Contains("maydanoz", html, StringComparison.Ordinal);
    }

    /// <summary>Akışa özel güvenlik uyarısı KAYBOLMAZ — eski düz gövdelerin taşıdığı tek uyarıydı.</summary>
    [Fact]
    public void Guvenlik_uyarisi_govdede_kalir()
    {
        Assert.Contains("parolanızı hemen değiştirin", VerificationEmailTemplate.Build(Sample()), StringComparison.Ordinal);
        Assert.DoesNotContain("parolanızı hemen değiştirin", VerificationEmailTemplate.Build(Sample(note: null)), StringComparison.Ordinal);
    }
}

using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Tests.Application;

/// <summary>
/// Kodsuz bildirim e-postası şablonu (başvuru alındı / reddedildi, hesap açıldı). Doğrulama kodu şablonunun kuralları
/// burada da kilitlenir: görsel yok, kullanıcı verisi kaçışlı, bağlantı yalnız mutlak http(s), style bloğunda metin yok.
/// </summary>
public sealed class NoticeEmailTemplateTests
{
    private static NoticeEmailContent Full(string? actionUrl = "https://maydanozasist.com/giris/beauty") => new(
        Title: "HESABINIZ AÇILDI",
        Preheader: "Hesabınız hazır.",
        Greeting: "Merhaba Ayşe Yılmaz,",
        Paragraphs: ["Başvurunuz onaylandı.", " ", "14 günlük ücretsiz deneme ilk girişte başlar."],
        TenantName: "Güzel Salon",
        HighlightLabel: "Kurum Kodu",
        Highlight: "BA-01-0007",
        CardTitle: "HESAP BİLGİLERİ",
        Rows: [new("E-Posta", "sahip@ornek.com"), new("Boş", " "), new("Paket", "BeautyAsist")],
        CalloutLabel: "Gerekçe",
        Callout: "Vergi levhası okunmuyor.",
        StepsTitle: "İLK GİRİŞ NASIL YAPILIR?",
        Steps: ["Giriş sayfasını açın.", "“Şifremi unuttum” bağlantısına basın.", "Kodu girin.", "Şifrenizi belirleyin.", "Beşinci adım basılmaz."],
        ActionText: "Giriş sayfasını aç",
        ActionUrl: actionUrl,
        Notes: ["Şifre e-postayla gönderilmez."]);

    [Fact]
    public void Gorsel_kullanmaz_ve_tum_bolumleri_basar()
    {
        var html = NoticeEmailTemplate.Build(Full());

        Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<svg", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("background-image", html, StringComparison.OrdinalIgnoreCase);
        foreach (var text in new[]
                 {
                     "HESABINIZ AÇILDI", "Güzel Salon", "Merhaba Ayşe Yılmaz,", "BA-01-0007", "HESAP BİLGİLERİ", "sahip@ornek.com",
                     "<b>Gerekçe:</b> Vergi levhası okunmuyor.", "İLK GİRİŞ NASIL YAPILIR?", "“Şifremi unuttum”", "ÖNEMLİ NOTLAR",
                     "href=\"https://maydanozasist.com/giris/beauty\"", "Giriş sayfasını aç", "BEAUTY&nbsp;ASIST",
                 })
        {
            Assert.Contains(text, html);
        }
        Assert.DoesNotContain("Boş", html);
        Assert.DoesNotContain("Beşinci adım", html);
        Assert.Equal(4, Regex.Matches(html, "class=\"ba-step\"").Count);
    }

    [Fact]
    public void Style_blogunda_arayuz_metni_yok_ve_kullanici_verisi_kacisli()
    {
        var html = NoticeEmailTemplate.Build(Full() with { TenantName = "<script>alert('x')</script>", Greeting = "Merhaba A & B," });
        var style = Regex.Match(html, "<style>(.*?)</style>", RegexOptions.Singleline).Groups[1].Value;

        Assert.DoesNotContain("HESABINIZ", style);
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;", html);
        Assert.Contains("Merhaba A &amp; B,", html);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("/giris/beauty")]
    [InlineData(" ")]
    [InlineData(null)]
    public void Gecersiz_baglantida_dugme_basilmaz(string? url)
    {
        var html = NoticeEmailTemplate.Build(Full(url));
        Assert.DoesNotContain("<a href", html);
        Assert.DoesNotContain(">Giriş sayfasını aç</a>", html);
        Assert.DoesNotContain("javascript", html);
    }

    [Fact]
    public void Bos_bolumler_hic_basilmaz()
    {
        var html = NoticeEmailTemplate.Build(new NoticeEmailContent("BAŞVURU SONUCU", "Önizleme", "Merhaba,", ["Tek paragraf."]));

        Assert.Contains("BAŞVURU SONUCU", html);
        foreach (var missing in new[] { "BİLGİLER", "ÖNEMLİ NOTLAR", "NASIL İLERLER?", "Gerekçe", "class=\"ba-code\"", "font-style:italic" })
        {
            Assert.DoesNotContain(missing, html);
        }
    }

    [Fact]
    public void Yalniz_satirlar_ya_da_yalniz_kod_kutusu_basilabilir()
    {
        var rowsOnly = NoticeEmailTemplate.Build(new NoticeEmailContent("T", "P", "G", [], Rows: [new("Durum", "İnceleniyor")], Steps: ["Tek adım."]));
        Assert.Contains("BİLGİLER", rowsOnly);
        Assert.DoesNotContain("class=\"ba-code\"", rowsOnly);
        Assert.Contains("NASIL İLERLER?", rowsOnly);

        var highlightOnly = NoticeEmailTemplate.Build(new NoticeEmailContent("T", "P", "G", [], Highlight: "BA-01-0001", Callout: "Not"));
        Assert.Contains("class=\"ba-code\"", highlightOnly);
        Assert.DoesNotContain("İnceleniyor", highlightOnly);
        Assert.Contains(">Not</td>", highlightOnly);
    }
}

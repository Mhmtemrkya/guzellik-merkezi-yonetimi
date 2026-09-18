using System.Globalization;
using System.Net;
using System.Text;

namespace GuzellikMerkezi.Application.Common;

/// <summary>
/// Doğrulama kodu e-postasının içeriği. Değerler <b>akışın kendi sabitlerinden</b> gelir —
/// tasarım görselindeki örnek değerler (ör. "15 Dakika") ölçüt DEĞİLDİR.
/// </summary>
/// <param name="Code">6 haneli kod. Şablonda kopyalanabilir METİN olarak basılır.</param>
/// <param name="Email">Kodun gittiği adres (kullanıcı hangi kutuya bakacağını görsün).</param>
/// <param name="Validity">Kodun ömrü. <b>TimeSpan geçilir, metin değil</b>: her akış kendi
/// sabitini (CodeLifetime/ChallengeLifetime/DraftLifetime) verir, böylece sabit değiştiğinde
/// e-posta yalan söylemez.</param>
/// <param name="OperationType">"Yönetici Girişi", "Müşteri Girişi", "Kurum Kaydı" gibi.</param>
/// <param name="TenantName">Başlık altındaki kurum adı; bilinmiyorsa satır hiç basılmaz.</param>
/// <param name="VerificationLink">Kodun girileceği ekranın adresi; yoksa satır hiç basılmaz.</param>
/// <param name="SecurityNote">Akışa özel uyarı ("Bu girişi siz yapmadıysanız...").</param>
public sealed record VerificationEmailContent(
    string Code,
    string Email,
    TimeSpan Validity,
    string OperationType,
    string? TenantName = null,
    string? VerificationLink = null,
    string? SecurityNote = null);

/// <summary>
/// BeautyAsist doğrulama kodu e-postasının TEK şablonu — kod e-postayla nereye gidiyorsa
/// (panel girişi, müşteri girişi/kaydı, kurum kaydı) hepsi buradan geçer.
/// </summary>
/// <remarks>
/// <para>
/// <b>NEDEN GÖRSEL DEĞİL HTML?</b> Tasarım bir PNG olarak verildi. Ama bunlar kimlik doğrulama
/// e-postalarıdır: Gmail, Outlook.com ve Apple Mail tanımadıkları göndericinin görsellerini
/// VARSAYILAN OLARAK ENGELLER. Kod yalnızca piksel olsaydı, ilk kez yazan bir gönderici için
/// kullanıcı kodu HİÇ GÖREMEZDİ — "görselleri göster"e basana kadar e-posta boş bir çerçeveden
/// ibaret olurdu. Bu yüzden tasarımın aynısı HTML/CSS ile yeniden kuruldu: kod gerçek metindir
/// (seçilebilir, kopyalanabilir, ekran okuyucu okur) ve görsel engelleme e-postayı bozamaz.
/// </para>
/// <para>
/// <b>ÇİZGİ İKONLAR BİLEREK YOK.</b> Görseldeki kalkan/zarf/saat/kişi/zincir ikonları e-postada
/// ya SVG (Gmail tamamen siler, Outlook çizmez) ya da uzak görsel (yine engellenir) olurdu.
/// Yerlerine tipografi + pembe ayraç çizgisi kullanıldı; taşıdıkları bilgi zaten satır
/// etiketlerinde yazılı.
/// </para>
/// <para>
/// <b>TABLO DÜZENİ + SATIR İÇİ STİL ZORUNLU.</b> Outlook'un Word tabanlı motoru flex/grid ve
/// harici stil sayfası tanımaz. Baştaki style bloğu YALNIZCA iyileştirmedir (dar ekranda yazı
/// boyu); silinse de düzen ayakta kalır. Yuvarlak köşeler Outlook'ta düz görünür — kabul.
/// </para>
/// <para>
/// Renkler tasarım PNG'sinden örneklendi: başlık bandı #E093A6, kod kutusu #FCE4E7,
/// adım rozeti #DA6285, alt bant #001C35.
/// </para>
/// </remarks>
public static class VerificationEmailTemplate
{
    // --- tasarımdan örneklenen palet ---
    private const string HeaderBg = "#E093A6";
    private const string HeaderInk = "#3B1526";
    private const string PageBg = "#F1E4E9";
    private const string CardBorder = "#F6DDE4";
    private const string TintBg = "#FDECED";
    private const string CodeBoxBg = "#FCE4E7";
    private const string CodeBoxBorder = "#F7CFDB";
    private const string CodeInk = "#2A0317";
    private const string Ink = "#2F1724";
    private const string BodyInk = "#4A2E3B";
    private const string Muted = "#7C6170";
    private const string Accent = "#D14E78";
    private const string AccentSoft = "#E48AA6";
    private const string StepBadge = "#DA6285";
    private const string RowRule = "#F7E7EC";
    private const string FooterBg = "#001C35";

    private const string Sans = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
    private const string Serif = "Georgia,'Times New Roman',Times,serif";

    private static readonly string[] Schemes = ["https://", "http://"];

    /// <summary>Süreyi tasarımdaki gibi yazar: "5 Dakika", "1 Saat", "1 Saat 30 Dakika".</summary>
    public static string FormatValidity(TimeSpan validity)
    {
        var total = (int)Math.Round(validity.TotalMinutes, MidpointRounding.AwayFromZero);
        if (total <= 0) total = 1;

        var hours = total / 60;
        var minutes = total % 60;

        return hours switch
        {
            0 => $"{minutes} Dakika",
            _ when minutes == 0 => $"{hours} Saat",
            _ => $"{hours} Saat {minutes} Dakika",
        };
    }

    /// <summary>Bağlantıyı tasarımdaki gibi kısaltır: "https://beautyasist.com/login" → "beautyasist.com/login".</summary>
    private static string PrettyLink(string url)
    {
        var text = url.Trim();
        foreach (var scheme in Schemes)
        {
            if (text.StartsWith(scheme, StringComparison.OrdinalIgnoreCase))
            {
                text = text[scheme.Length..];
                break;
            }
        }
        return text.TrimEnd('/');
    }

    /// <summary>
    /// "Doğrulama Bağlantısı" satırının adresini üretir; hiçbir taban adres tanımlı değilse
    /// <c>null</c> döner ve satır e-postaya HİÇ basılmaz.
    /// </summary>
    /// <remarks>
    /// <b><c>??</c> KULLANILAMAZ:</b> <c>IConfiguration</c>, anahtarı tanımlı ama değeri BOŞ olan
    /// ayar için <c>null</c> değil <c>""</c> döndürür. appsettings.json'da <c>"PublicBaseUrl": ""</c>
    /// yazılı olduğu için <c>??</c> zinciri ilk anahtarda takılır ve yedeklere hiç düşmezdi.
    /// (Aynı tuzak CustomerOtpService'in mağaza inceleme ayarlarında da not edilmiş.)
    /// </remarks>
    /// <param name="path">Kodun girileceği ekranın yolu, ör. "/login".</param>
    /// <param name="baseUrlCandidates">Öncelik sırasıyla taban adres adayları.</param>
    public static string? BuildLink(string path, params string?[] baseUrlCandidates)
    {
        foreach (var candidate in baseUrlCandidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            var root = candidate.Trim().TrimEnd('/');
            var suffix = path.StartsWith('/') ? path : "/" + path;
            return root + suffix;
        }
        return null;
    }

    /// <summary>
    /// HTML kaçışı — yalnız tehlikeli beş karakter. Hem metin hem çift tırnaklı öznitelik
    /// içeriği için yeterlidir (şablonda başka ekleme noktası yok).
    /// </summary>
    /// <remarks>
    /// <b><see cref="WebUtility.HtmlEncode"/> KULLANILMAZ:</b> o, ASCII dışındaki HER karakteri
    /// sayısal varlığa çevirir ve "Yönetici Girişi" gövdeye "Y&amp;#246;netici Giri&amp;#351;i"
    /// olarak girer. Şablonun sabit metinleri ("DOĞRULAMA KODU BİLGİLERİ", "NASIL KULLANILIR?")
    /// zaten ham UTF-8 olduğu için bu, aynı e-postada iki farklı yazım demekti; üstelik gövdeyi
    /// şişirip metni aranamaz hâle getiriyordu. Kodlamayı MIME katmanı taşır
    /// (PlatformMessagingService'te <c>BodyEncoding = UTF8</c>).
    /// </remarks>
    /// <summary>
    /// E-posta gövdesine kullanıcı girdisi basan HER YER buradan geçmelidir.
    /// </summary>
    /// <remarks>
    /// <c>public</c> olmasının sebebi paylaşım değil TEKİLLİK: yukarıdaki gerekçe (neden
    /// <see cref="WebUtility.HtmlEncode"/> değil) tek bir yerde durmalı. İkinci bir kopya,
    /// aynı e-postada iki farklı yazım demekti.
    /// </remarks>
    public static string HtmlEscape(string? value) => E(value);

    private static string E(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;

        var sb = new StringBuilder(value.Length + 16);
        foreach (var ch in value)
        {
            switch (ch)
            {
                case '&': sb.Append("&amp;"); break;
                case '<': sb.Append("&lt;"); break;
                case '>': sb.Append("&gt;"); break;
                case '"': sb.Append("&quot;"); break;
                case '\'': sb.Append("&#39;"); break;
                default: sb.Append(ch); break;
            }
        }
        return sb.ToString();
    }

    public static string Build(VerificationEmailContent content)
    {
        var code = E(content.Code);
        var email = E(content.Email);
        var validity = E(FormatValidity(content.Validity));
        var operation = E(content.OperationType);
        var tenant = string.IsNullOrWhiteSpace(content.TenantName) ? null : E(content.TenantName!.Trim());
        var note = string.IsNullOrWhiteSpace(content.SecurityNote) ? null : E(content.SecurityNote!.Trim());

        // Bağlantı yalnızca MUTLAK http/https ise basılır: yapılandırılmamış taban adresle
        // ("App:PublicBaseUrl" boş) üretilen bozuk bir link, kimlik doğrulama e-postasında
        // hiç link olmamasından daha kötüdür.
        string? linkHref = null, linkText = null;
        if (!string.IsNullOrWhiteSpace(content.VerificationLink)
            && Uri.TryCreate(content.VerificationLink!.Trim(), UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            linkHref = E(uri.AbsoluteUri);
            linkText = E(PrettyLink(uri.AbsoluteUri));
        }

        var sb = new StringBuilder(10000);

        sb.Append(CultureInfo.InvariantCulture, $$"""
<!DOCTYPE html>
<html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Doğrulama Kodu Bilgileri</title>
<style>
  /* Telefon düzeni. Bu blok DÜŞERSE (bazı istemciler style'ı siler) satır içi stiller
     devrededir: düzen dört sütun kalır, istemci sığdırmak için küçültür — bozulmaz. */
  @media only screen and (max-width:520px){
    .ba-wordmark{font-size:32px!important}
    .ba-title{font-size:18px!important}
    .ba-code{font-size:30px!important;letter-spacing:6px!important}
    .ba-pad{padding-left:14px!important;padding-right:14px!important}
    /* Dört adım kutusu yan yana en az ~460px ister; telefonda alt alta iner. */
    .ba-steprow{display:block!important}
    .ba-step{display:block!important;width:100%!important;padding:0 0 8px 0!important}
    .ba-chev{display:none!important}
    /* İki not sütunu da alt alta iner; aradaki dikey ayraç kalkar. */
    .ba-notecol{display:block!important;width:100%!important;padding:0!important;border-left:0!important}
    .ba-notecol + .ba-notecol{padding-top:2px!important}
    /* Uzun satır etiketleri dar ekranda değere yer bırakmıyordu.
       NOT: bu blokta arayüz metni GEÇMEZ; testler gövdeyi dizgiyle arıyor. */
    .ba-rowlabel{font-size:12.5px!important}
    .ba-rowvalue{font-size:12.5px!important;width:auto!important}
    .ba-rowsep{width:14px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:{{PageBg}};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Doğrulama kodunuz {{validity}} geçerlidir.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:{{PageBg}}">
<tr><td align="center" style="padding:26px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:640px;background:#FFFFFF;border:1px solid {{CardBorder}};border-radius:20px;overflow:hidden">

""");

        // ── başlık bandı ────────────────────────────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td align="center" class="ba-pad" style="background:{{HeaderBg}};padding:34px 28px 28px 28px">
  <div class="ba-wordmark" style="font-family:{{Serif}};font-size:42px;line-height:1.05;color:{{HeaderInk}};letter-spacing:.5px">Beauty Asist</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px auto 0 auto"><tr>
    <td style="border-bottom:1px solid {{HeaderInk}};padding:0 6px 5px 6px;font-family:{{Serif}};font-size:16px;line-height:1.3;color:{{HeaderInk}}">Beauty&amp;Wellness Technology</td>
  </tr></table>
  <div class="ba-title" style="font-family:{{Sans}};font-size:22px;font-weight:800;line-height:1.3;color:{{Ink}};letter-spacing:.3px;padding-top:16px">DOĞRULAMA KODU BİLGİLERİ</div>

""");

        if (tenant is not null)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
  <div style="font-family:{{Serif}};font-style:italic;font-size:17px;line-height:1.4;color:{{HeaderInk}};padding-top:5px">{{tenant}}</div>

""");
        }

        sb.Append("</td></tr>\n\n");

        // ── KOD DETAYLARI kartı ─────────────────────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:26px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid {{CardBorder}};border-radius:18px">
    <tr><td style="padding:0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="background:{{TintBg}};border-radius:18px 0 18px 0;padding:11px 24px;font-family:{{Sans}};font-size:13px;font-weight:800;letter-spacing:1.2px;color:{{Accent}}">KOD DETAYLARI</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 22px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
        <td style="border-left:2px solid #F6D3DE;padding-left:18px">

          <div style="font-family:{{Serif}};font-size:17px;line-height:1.4;color:{{BodyInk}};padding-bottom:9px">Doğrulama Kodu</div>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0"><tr>
            <td align="center" style="background:{{CodeBoxBg}};border:1px solid {{CodeBoxBorder}};border-radius:14px;padding:15px 10px">
              <div class="ba-code" style="font-family:{{Sans}};font-size:36px;font-weight:800;line-height:1.15;color:{{CodeInk}};letter-spacing:8px">{{code}}</div>
            </td>
          </tr></table>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:16px">

""");

        AppendRow(sb, "E-Posta", email, isLast: false, valueColor: BodyInk, href: null);
        AppendRow(sb, "Geçerlilik", validity, isLast: false, valueColor: BodyInk, href: null);
        AppendRow(sb, "İşlem Tipi", operation, isLast: linkHref is null, valueColor: BodyInk, href: null);
        if (linkHref is not null)
            AppendRow(sb, "Doğrulama Bağlantısı", linkText!, isLast: true, valueColor: Accent, href: linkHref);

        sb.Append(CultureInfo.InvariantCulture, $$"""
          </table>

        </td>
      </tr></table>
    </td></tr>
  </table>
</td></tr>

<tr><td align="center" class="ba-pad" style="padding:16px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
    <td style="background:{{TintBg}};border-radius:22px;padding:10px 22px;font-family:{{Sans}};font-size:13px;line-height:1.4;color:{{BodyInk}}">Kodun süresi dolmadan kullanılması gerekir.</td>
  </tr></table>
</td></tr>

""");

        // ── NASIL KULLANILIR? ───────────────────────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:20px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid {{CardBorder}};border-radius:18px">
    <tr><td style="padding:20px 16px 18px 16px">
      <div style="font-family:{{Sans}};font-size:14px;font-weight:800;letter-spacing:.6px;color:{{Ink}};padding-left:4px">NASIL KULLANILIR?</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 14px 4px"><tr><td style="width:42px;height:3px;background:{{AccentSoft}};border-radius:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr class="ba-steprow">

""");

        AppendStep(sb, 1, "Giriş ekranını açın.", chevronAfter: true);
        AppendStep(sb, 2, "E-postanıza gelen kodu kontrol edin.", chevronAfter: true);
        AppendStep(sb, 3, "Doğrulama kodunu sisteme girin.", chevronAfter: true);
        AppendStep(sb, 4, "Onaylayarak işlemi tamamlayın.", chevronAfter: false);

        sb.Append("""
      </tr></table>
    </td></tr>
  </table>
</td></tr>

""");

        // ── ÖNEMLİ NOTLAR ───────────────────────────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:16px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid {{CardBorder}};border-radius:18px">
    <tr><td style="padding:20px 18px 18px 18px">
      <div style="font-family:{{Sans}};font-size:14px;font-weight:800;letter-spacing:.6px;color:{{Ink}}">ÖNEMLİ NOTLAR</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 14px 0"><tr><td style="width:42px;height:3px;background:{{AccentSoft}};border-radius:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
        <td width="50%" valign="top" class="ba-notecol" style="padding-right:14px">

""");

        AppendBullet(sb, "Kod kişiye özeldir.");
        AppendBullet(sb, "Aynı kod ikinci kez kullanılamaz.");

        sb.Append(CultureInfo.InvariantCulture, $$"""
        </td>
        <td width="50%" valign="top" class="ba-notecol" style="padding-left:14px;border-left:1px solid {{RowRule}}">

""");

        AppendBullet(sb, "E-posta adresinizi doğru girdiğinizden emin olun.");
        AppendBullet(sb, "Sorun yaşarsanız destek ekibiyle iletişime geçin.");

        sb.Append("        </td>\n      </tr></table>\n");

        if (note is not null)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:14px"><tr>
        <td style="background:{{TintBg}};border-radius:12px;padding:12px 14px;font-family:{{Sans}};font-size:12.5px;font-weight:600;line-height:1.5;color:#7A2942">{{note}}</td>
      </tr></table>

""");
        }

        sb.Append("    </td></tr>\n  </table>\n</td></tr>\n\n");

        // ── alt bant ────────────────────────────────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td style="padding:22px 26px 0 26px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="ba-pad" style="background:{{FooterBg}};padding:18px 26px 20px 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
    <td valign="middle" style="font-family:{{Sans}};font-size:17px;font-weight:800;line-height:1.15;color:#FFFFFF"><span style="color:#2E9E5B">maydanoz</span> yazılım</td>
    <td valign="middle" align="right">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="background:{{HeaderBg}};border-radius:10px;padding:7px 12px;font-family:{{Sans}};font-size:11px;font-weight:800;letter-spacing:.8px;line-height:1.2;color:#FFFFFF;white-space:nowrap">BEAUTY&nbsp;ASIST</td>
      </tr></table>
    </td>
  </tr></table>
  <div style="font-family:{{Sans}};font-size:11px;line-height:1.65;color:#C9D6E2;padding-top:12px">Beauty Asist, işletmenizi geleceğe taşıyan Maydanoz Yazılım teknolojisiyle yanınızda. Güzelliğin yönetimi artık daha akıllı. Beauty Asist, Maydanoz Yazılım teknolojisiyle işletmenizin tüm süreçlerini tek bir çatı altında kolaylaştırmak ve daha hızlı ve daha akıllı yönetmeniz için geliştirildi.</div>
</td></tr>
</table>
<div style="font-family:{{Sans}};font-size:11px;line-height:1.6;color:{{Muted}};padding:14px 8px 0 8px">Bu e-posta otomatik olarak gönderildi; lütfen yanıtlamayın.</div>
</td></tr>
</table>
</body></html>
""");

        return sb.ToString();
    }

    /// <summary>"E-Posta : değer" satırı — tasarımdaki üç sütunlu (etiket / iki nokta / değer) düzen.</summary>
    private static void AppendRow(StringBuilder sb, string label, string value, bool isLast, string valueColor, string? href)
    {
        var rule = isLast ? "none" : $"1px solid {RowRule}";
        var rendered = href is null
            ? value
            : $"""<a href="{href}" style="color:{valueColor};text-decoration:none">{value}</a>""";

        sb.Append(CultureInfo.InvariantCulture, $$"""
            <tr>
              <td valign="top" class="ba-rowlabel" style="border-bottom:{{rule}};padding:9px 0;font-family:{{Sans}};font-size:13.5px;font-weight:700;line-height:1.45;color:{{Ink}}">{{label}}:</td>
              <td valign="top" width="26" align="center" class="ba-rowsep" style="border-bottom:{{rule}};padding:9px 0;font-family:{{Sans}};font-size:13.5px;line-height:1.45;color:#B9909F">:</td>
              <td valign="top" width="52%" class="ba-rowvalue" style="border-bottom:{{rule}};padding:9px 0;font-family:{{Sans}};font-size:13.5px;line-height:1.45;color:{{valueColor}};word-break:break-word">{{rendered}}</td>
            </tr>

""");
    }

    /// <summary>"NASIL KULLANILIR?" adım kutusu; aralara tasarımdaki pembe ayraç girer.</summary>
    private static void AppendStep(StringBuilder sb, int number, string caption, bool chevronAfter)
    {
        // GENİŞLİK AÇIKÇA VERİLİR: dört kutu içeriklerine göre büyüseydi ("Giriş ekranını açın."
        // ile "E-postanıza gelen kodu kontrol edin." yan yana) ızgara eğri dururdu.
        sb.Append(CultureInfo.InvariantCulture, $$"""
        <td valign="top" align="center" width="24%" class="ba-step" style="width:24%;padding:0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #F8E4EA;border-radius:14px"><tr>
            <td align="center" style="padding:14px 6px 13px 6px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
                <td align="center" width="28" height="28" style="background:{{StepBadge}};border-radius:14px;font-family:{{Sans}};font-size:13px;font-weight:800;line-height:28px;color:#FFFFFF">{{number}}</td>
              </tr></table>
              <div style="font-family:{{Sans}};font-size:11.5px;line-height:1.5;color:#3A2029;padding-top:10px;overflow-wrap:break-word;word-break:break-word">{{caption}}</div>
            </td>
          </tr></table>
        </td>

""");

        if (chevronAfter)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
        <td valign="middle" align="center" width="16" class="ba-chev" style="font-family:{{Sans}};font-size:15px;font-weight:700;color:{{AccentSoft}}">&rsaquo;</td>

""");
        }
    }

    private static void AppendBullet(StringBuilder sb, string text)
    {
        sb.Append(CultureInfo.InvariantCulture, $$"""
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
            <td valign="top" width="14" style="padding:3px 0;font-family:{{Sans}};font-size:14px;line-height:1.5;color:{{AccentSoft}}">&bull;</td>
            <td valign="top" style="padding:3px 0;font-family:{{Sans}};font-size:12.5px;line-height:1.5;color:#3A2029">{{text}}</td>
          </tr></table>

""");
    }
}

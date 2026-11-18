using System.Globalization;
using System.Text;
using T = GuzellikMerkezi.Application.Common.VerificationEmailTemplate;

namespace GuzellikMerkezi.Application.Common;

/// <summary>Bildirim e-postasındaki "Etiket : değer" satırı.</summary>
public sealed record NoticeEmailRow(string Label, string Value);

/// <summary>
/// Kodsuz bildirim e-postasının içeriği (başvuru alındı / reddedildi, hesap açıldı — ilk giriş). Tüm metinler DÜZ
/// METİNDİR; şablon kaçışı kendisi yapar (<see cref="VerificationEmailTemplate.HtmlEscape"/>).
/// </summary>
/// <param name="Title">Başlık bandındaki büyük başlık, ör. "BAŞVURUNUZ ALINDI".</param>
/// <param name="Preheader">Gelen kutusunda konunun yanında görünen gizli önizleme metni.</param>
/// <param name="Greeting">"Merhaba Işıl Yılmaz," gibi.</param>
/// <param name="Paragraphs">Giriş paragrafları.</param>
/// <param name="TenantName">Başlık altındaki kurum adı; yoksa satır basılmaz.</param>
/// <param name="HighlightLabel">Öne çıkan değer kutusunun etiketi (ör. "Kurum Kodu").</param>
/// <param name="Highlight">Öne çıkan değer — doğrulama e-postasındaki kod kutusu görünümünde.</param>
/// <param name="CardTitle">Bilgi kartının sekme başlığı, ör. "HESAP BİLGİLERİ".</param>
/// <param name="Rows">Bilgi kartının satırları.</param>
/// <param name="CalloutLabel">Vurgulu kutunun etiketi (ör. "Gerekçe").</param>
/// <param name="Callout">Vurgulu kutu metni.</param>
/// <param name="StepsTitle">Adımlar başlığı, ör. "İLK GİRİŞ NASIL YAPILIR?".</param>
/// <param name="Steps">En fazla dört kısa adım.</param>
/// <param name="ActionText">Düğme metni.</param>
/// <param name="ActionUrl">Düğme adresi — yalnız MUTLAK https/http basılır; değilse düğme hiç çıkmaz.</param>
/// <param name="Notes">"ÖNEMLİ NOTLAR" maddeleri.</param>
public sealed record NoticeEmailContent(
    string Title,
    string Preheader,
    string Greeting,
    IReadOnlyList<string> Paragraphs,
    string? TenantName = null,
    string? HighlightLabel = null,
    string? Highlight = null,
    string? CardTitle = null,
    IReadOnlyList<NoticeEmailRow>? Rows = null,
    string? CalloutLabel = null,
    string? Callout = null,
    string? StepsTitle = null,
    IReadOnlyList<string>? Steps = null,
    string? ActionText = null,
    string? ActionUrl = null,
    IReadOnlyList<string>? Notes = null);

/// <summary>
/// KODSUZ BİLDİRİM E-POSTASI ŞABLONU (kullanıcı isteği 18 Kas 2026: "yeni mailleri — ilk giriş vs — kod doğrulama
/// mailindeki gibi şık yap"). Görsel dil <see cref="VerificationEmailTemplate"/> ile birebir: aynı palet, pembe başlık
/// bandı, sekmeli bilgi kartı, numaralı adımlar, ÖNEMLİ NOTLAR ve lacivert alt bant.
/// </summary>
/// <remarks>
/// Kurallar doğrulama şablonuyla aynı: <c>&lt;img&gt;</c>, <c>&lt;svg&gt;</c>, <c>background-image</c> YASAK (gönderici
/// tanınmadığında istemci görselleri engeller); tablo düzeni + satır içi stil (Outlook); style bloğuna arayüz metni
/// yazılmaz (testler gövdeyi dizgiyle arar); kaçış yalnız <see cref="VerificationEmailTemplate.HtmlEscape"/> ile.
/// </remarks>
public static class NoticeEmailTemplate
{
    public static string Build(NoticeEmailContent content)
    {
        static string E(string? value) => T.HtmlEscape(value?.Trim());

        var sb = new StringBuilder(9000);
        sb.Append(CultureInfo.InvariantCulture, $$"""
<!DOCTYPE html>
<html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{E(content.Title)}}</title>
<style>
  @media only screen and (max-width:520px){
    .ba-wordmark{font-size:32px!important}
    .ba-title{font-size:18px!important}
    .ba-code{font-size:26px!important;letter-spacing:3px!important}
    .ba-pad{padding-left:14px!important;padding-right:14px!important}
    .ba-steprow{display:block!important}
    .ba-step{display:block!important;width:100%!important;padding:0 0 8px 0!important}
    .ba-chev{display:none!important}
    .ba-rowlabel{font-size:12.5px!important}
    .ba-rowvalue{font-size:12.5px!important;width:auto!important}
    .ba-rowsep{width:14px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:{{T.PageBg}};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{{E(content.Preheader)}}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:{{T.PageBg}}">
<tr><td align="center" style="padding:26px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:640px;background:#FFFFFF;border:1px solid {{T.CardBorder}};border-radius:20px;overflow:hidden">

<tr><td align="center" class="ba-pad" style="background:{{T.HeaderBg}};padding:34px 28px 28px 28px">
  <div class="ba-wordmark" style="font-family:{{T.Serif}};font-size:42px;line-height:1.05;color:{{T.HeaderInk}};letter-spacing:.5px">Beauty Asist</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px auto 0 auto"><tr>
    <td style="border-bottom:1px solid {{T.HeaderInk}};padding:0 6px 5px 6px;font-family:{{T.Serif}};font-size:16px;line-height:1.3;color:{{T.HeaderInk}}">Beauty&amp;Wellness Technology</td>
  </tr></table>
  <div class="ba-title" style="font-family:{{T.Sans}};font-size:22px;font-weight:800;line-height:1.3;color:{{T.Ink}};letter-spacing:.3px;padding-top:16px">{{E(content.Title)}}</div>

""");
        if (!string.IsNullOrWhiteSpace(content.TenantName))
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
  <div style="font-family:{{T.Serif}};font-style:italic;font-size:17px;line-height:1.4;color:{{T.HeaderInk}};padding-top:5px">{{E(content.TenantName)}}</div>

""");
        }
        sb.Append("</td></tr>\n\n");

        // ── selam + giriş paragrafları ─────────────────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:26px 30px 0 30px">
  <div style="font-family:{{T.Serif}};font-size:19px;line-height:1.4;color:{{T.Ink}};padding-bottom:8px">{{E(content.Greeting)}}</div>

""");
        foreach (var paragraph in content.Paragraphs.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
  <p style="margin:0 0 10px 0;font-family:{{T.Sans}};font-size:14.5px;line-height:1.65;color:{{T.BodyInk}}">{{E(paragraph)}}</p>

""");
        }
        sb.Append("</td></tr>\n\n");

        // ── öne çıkan değer + bilgi kartı ───────────────────────────────────────────────
        var rows = content.Rows?.Where(r => !string.IsNullOrWhiteSpace(r.Value)).ToList() ?? [];
        var highlight = string.IsNullOrWhiteSpace(content.Highlight) ? null : E(content.Highlight);
        if (highlight is not null || rows.Count > 0)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:18px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid {{T.CardBorder}};border-radius:18px">
    <tr><td style="padding:0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="background:{{T.TintBg}};border-radius:18px 0 18px 0;padding:11px 24px;font-family:{{T.Sans}};font-size:13px;font-weight:800;letter-spacing:1.2px;color:{{T.Accent}}">{{E(content.CardTitle ?? "BİLGİLER")}}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 22px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
        <td style="border-left:2px solid #F6D3DE;padding-left:18px">

""");
            if (highlight is not null)
            {
                sb.Append(CultureInfo.InvariantCulture, $$"""
          <div style="font-family:{{T.Serif}};font-size:17px;line-height:1.4;color:{{T.BodyInk}};padding-bottom:9px">{{E(content.HighlightLabel ?? string.Empty)}}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0"><tr>
            <td align="center" style="background:{{T.CodeBoxBg}};border:1px solid {{T.CodeBoxBorder}};border-radius:14px;padding:15px 10px">
              <div class="ba-code" style="font-family:{{T.Sans}};font-size:32px;font-weight:800;line-height:1.15;color:{{T.CodeInk}};letter-spacing:4px">{{highlight}}</div>
            </td>
          </tr></table>

""");
            }
            if (rows.Count > 0)
            {
                sb.Append(CultureInfo.InvariantCulture, $$"""
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:{{(highlight is null ? 0 : 16)}}px">

""");
                for (var i = 0; i < rows.Count; i++)
                {
                    var rule = i == rows.Count - 1 ? "none" : $"1px solid {T.RowRule}";
                    sb.Append(CultureInfo.InvariantCulture, $$"""
            <tr>
              <td valign="top" class="ba-rowlabel" style="border-bottom:{{rule}};padding:9px 0;font-family:{{T.Sans}};font-size:13.5px;font-weight:700;line-height:1.45;color:{{T.Ink}}">{{E(rows[i].Label)}}</td>
              <td valign="top" width="26" align="center" class="ba-rowsep" style="border-bottom:{{rule}};padding:9px 0;font-family:{{T.Sans}};font-size:13.5px;line-height:1.45;color:#B9909F">:</td>
              <td valign="top" width="52%" class="ba-rowvalue" style="border-bottom:{{rule}};padding:9px 0;font-family:{{T.Sans}};font-size:13.5px;line-height:1.45;color:{{T.BodyInk}};word-break:break-word">{{E(rows[i].Value)}}</td>
            </tr>

""");
                }
                sb.Append("          </table>\n");
            }
            sb.Append("        </td>\n      </tr></table>\n    </td></tr>\n  </table>\n</td></tr>\n\n");
        }

        // ── vurgulu kutu (ör. ret gerekçesi) ────────────────────────────────────────────
        if (!string.IsNullOrWhiteSpace(content.Callout))
        {
            var label = string.IsNullOrWhiteSpace(content.CalloutLabel) ? string.Empty : $"<b>{E(content.CalloutLabel)}:</b> ";
            sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:16px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
    <td style="background:{{T.TintBg}};border-left:3px solid {{T.Accent}};border-radius:12px;padding:14px 16px;font-family:{{T.Sans}};font-size:14px;line-height:1.6;color:#7A2942">{{label}}{{E(content.Callout)}}</td>
  </tr></table>
</td></tr>

""");
        }

        // ── düğme ───────────────────────────────────────────────────────────────────────
        if (!string.IsNullOrWhiteSpace(content.ActionText) && SafeUrl(content.ActionUrl) is { } href)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td align="center" class="ba-pad" style="padding:22px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>
    <td align="center" style="background:{{T.StepBadge}};border-radius:14px">
      <a href="{{E(href)}}" style="display:inline-block;padding:14px 30px;font-family:{{T.Sans}};font-size:15px;font-weight:800;letter-spacing:.3px;color:#FFFFFF;text-decoration:none">{{E(content.ActionText)}}</a>
    </td>
  </tr></table>
  <div style="font-family:{{T.Sans}};font-size:12px;line-height:1.5;color:{{T.Muted}};padding-top:8px;word-break:break-all"><a href="{{E(href)}}" style="color:{{T.Accent}};text-decoration:none">{{E(href)}}</a></div>
</td></tr>

""");
        }

        // ── adımlar ─────────────────────────────────────────────────────────────────────
        var steps = content.Steps?.Where(s => !string.IsNullOrWhiteSpace(s)).Take(4).ToList() ?? [];
        if (steps.Count > 0)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:20px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid {{T.CardBorder}};border-radius:18px">
    <tr><td style="padding:20px 16px 18px 16px">
      <div style="font-family:{{T.Sans}};font-size:14px;font-weight:800;letter-spacing:.6px;color:{{T.Ink}};padding-left:4px">{{E(content.StepsTitle ?? "NASIL İLERLER?")}}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 14px 4px"><tr><td style="width:42px;height:3px;background:{{T.AccentSoft}};border-radius:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr class="ba-steprow">

""");
            var width = 100 / steps.Count - 1;
            for (var i = 0; i < steps.Count; i++)
            {
                sb.Append(CultureInfo.InvariantCulture, $$"""
        <td valign="top" align="center" width="{{width}}%" class="ba-step" style="width:{{width}}%;padding:0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #F8E4EA;border-radius:14px"><tr>
            <td align="center" style="padding:14px 6px 13px 6px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
                <td align="center" width="28" height="28" style="background:{{T.StepBadge}};border-radius:14px;font-family:{{T.Sans}};font-size:13px;font-weight:800;line-height:28px;color:#FFFFFF">{{i + 1}}</td>
              </tr></table>
              <div style="font-family:{{T.Sans}};font-size:11.5px;line-height:1.5;color:#3A2029;padding-top:10px;overflow-wrap:break-word;word-break:break-word">{{E(steps[i])}}</div>
            </td>
          </tr></table>
        </td>

""");
                if (i < steps.Count - 1)
                {
                    sb.Append(CultureInfo.InvariantCulture, $$"""
        <td valign="middle" align="center" width="16" class="ba-chev" style="font-family:{{T.Sans}};font-size:15px;font-weight:700;color:{{T.AccentSoft}}">&rsaquo;</td>

""");
                }
            }
            sb.Append("      </tr></table>\n    </td></tr>\n  </table>\n</td></tr>\n\n");
        }

        // ── önemli notlar ───────────────────────────────────────────────────────────────
        var notes = content.Notes?.Where(n => !string.IsNullOrWhiteSpace(n)).ToList() ?? [];
        if (notes.Count > 0)
        {
            sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td class="ba-pad" style="padding:16px 26px 0 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid {{T.CardBorder}};border-radius:18px">
    <tr><td style="padding:20px 18px 16px 18px">
      <div style="font-family:{{T.Sans}};font-size:14px;font-weight:800;letter-spacing:.6px;color:{{T.Ink}}">ÖNEMLİ NOTLAR</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 12px 0"><tr><td style="width:42px;height:3px;background:{{T.AccentSoft}};border-radius:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>

""");
            foreach (var note in notes)
            {
                sb.Append(CultureInfo.InvariantCulture, $$"""
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
        <td valign="top" width="14" style="padding:3px 0;font-family:{{T.Sans}};font-size:14px;line-height:1.5;color:{{T.AccentSoft}}">&bull;</td>
        <td valign="top" style="padding:3px 0;font-family:{{T.Sans}};font-size:12.5px;line-height:1.5;color:#3A2029">{{E(note)}}</td>
      </tr></table>

""");
            }
            sb.Append("    </td></tr>\n  </table>\n</td></tr>\n\n");
        }

        // ── alt bant (doğrulama şablonuyla aynı) ───────────────────────────────────────
        sb.Append(CultureInfo.InvariantCulture, $$"""
<tr><td style="padding:22px 26px 0 26px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="ba-pad" style="background:{{T.FooterBg}};padding:18px 26px 20px 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
    <td valign="middle" style="font-family:{{T.Sans}};font-size:17px;font-weight:800;line-height:1.15;color:#FFFFFF"><span style="color:#2E9E5B">maydanoz</span> yazılım</td>
    <td valign="middle" align="right">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
        <td style="background:{{T.HeaderBg}};border-radius:10px;padding:7px 12px;font-family:{{T.Sans}};font-size:11px;font-weight:800;letter-spacing:.8px;line-height:1.2;color:#FFFFFF;white-space:nowrap">BEAUTY&nbsp;ASIST</td>
      </tr></table>
    </td>
  </tr></table>
  <div style="font-family:{{T.Sans}};font-size:11px;line-height:1.65;color:#C9D6E2;padding-top:12px">Beauty Asist, işletmenizi geleceğe taşıyan Maydanoz Yazılım teknolojisiyle yanınızda. Güzelliğin yönetimi artık daha akıllı.</div>
</td></tr>
</table>
<div style="font-family:{{T.Sans}};font-size:11px;line-height:1.6;color:{{T.Muted}};padding:14px 8px 0 8px">Bu e-posta otomatik olarak gönderildi; lütfen yanıtlamayın.</div>
</td></tr>
</table>
</body></html>
""");
        return sb.ToString();
    }

    /// <summary>Düğme adresi yalnız MUTLAK http/https ise kullanılır (javascript:, göreli yol vb. düşer).</summary>
    private static string? SafeUrl(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
            ? uri.AbsoluteUri
            : null;
}

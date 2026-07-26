using System.Reflection;
using System.Text;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PublicSalons;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Kuruma özel KVKK aydınlatma metnini PDF'e basar (WhatsApp eki + "PDF indir").
///
/// Metin kaynağı: <c>TenantPublicProfile.KvkkConsentText</c> — kurum yöneticisinin Ayarlar'dan
/// yazdığı metin. Boşsa <see cref="KvkkTextDefaults"/> varsayılanı kurum adı yerleştirilerek kullanılır.
/// Panelde gösterilen metinle birebir aynıdır.
///
/// Yazı tipi: uygulamayla gömülü KvkkSans (mobil PDF ile aynı) — Türkçe karakterler için sistem
/// fontuna güvenilmez, sunucuda hiçbir font kurulu olmayabilir.
/// </summary>
public sealed class KvkkDocumentService : IKvkkDocumentService
{
    private const string FontFamily = "KvkkSans";
    private const double PageWidth = 595;   // A4 @72dpi
    private const double PageHeight = 842;
    private const double Margin = 52;
    private const double FooterHeight = 34;

    private readonly GuzellikDbContext _db;
    private readonly ILogger<KvkkDocumentService> _logger;

    public KvkkDocumentService(GuzellikDbContext db, ILogger<KvkkDocumentService> logger)
    {
        _db = db;
        _logger = logger;
        EmbeddedFontResolver.EnsureRegistered();
    }

    public async Task<Guid?> ResolveTenantIdBySlugAsync(string slug, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(slug)) return null;
        var normalized = slug.Trim().ToLowerInvariant();
        var id = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => !t.IsDeleted && t.Slug == normalized)
            .Select(t => (Guid?)t.Id)
            .FirstOrDefaultAsync(cancellationToken);
        return id;
    }

    public async Task<KvkkContentDto?> GetContentAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => !t.IsDeleted && t.Id == tenantId)
            .Select(t => new { t.Name })
            .FirstOrDefaultAsync(cancellationToken);
        if (tenant is null) return null;

        var profile = await _db.TenantPublicProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .Select(p => new { p.KvkkConsentText, p.LogoData })
            .FirstOrDefaultAsync(cancellationToken);

        return new KvkkContentDto(
            tenant.Name,
            KvkkTextDefaults.Resolve(profile?.KvkkConsentText, tenant.Name),
            profile?.LogoData);
    }

    public async Task<byte[]?> BuildPdfAsync(Guid tenantId, string? customerName = null, CancellationToken cancellationToken = default)
    {
        var content = await GetContentAsync(tenantId, cancellationToken);
        if (content is null) return null;
        return Render(content, customerName);
    }

    // ---------------------------------------------------------------- çizim ---

    private byte[] Render(KvkkContentDto content, string? customerName)
    {
        using var document = new PdfDocument();
        document.Info.Title = $"{content.SalonName} — KVKK Aydınlatma Metni";
        document.Info.Author = content.SalonName;
        document.Info.Subject = "KVKK Aydınlatma Metni ve Açık Rıza Beyanı";

        // Unicode kodlaması ŞART: varsayılan WinAnsi, Türkçeye özgü ş/ğ/İ/ı karakterlerini
        // temsil edemez ve bunları sessizce DÜŞÜRÜR ("Kişisel" → "Kiisel").
        var unicode = new XPdfFontOptions(PdfFontEncoding.Unicode);
        var body = new XFont(FontFamily, 9.5, XFontStyleEx.Regular, unicode);
        var bold = new XFont(FontFamily, 9.5, XFontStyleEx.Bold, unicode);
        var heading = new XFont(FontFamily, 11, XFontStyleEx.Bold, unicode);
        var title = new XFont(FontFamily, 15, XFontStyleEx.Bold, unicode);
        var footer = new XFont(FontFamily, 7.5, XFontStyleEx.Regular, unicode);

        var contentWidth = PageWidth - Margin * 2;
        var bottom = PageHeight - Margin - FooterHeight;

        PdfPage page = null!;
        XGraphics gfx = null!;
        var y = 0.0;

        void NewPage()
        {
            gfx?.Dispose();
            page = document.AddPage();
            page.Width = XUnit.FromPoint(PageWidth);
            page.Height = XUnit.FromPoint(PageHeight);
            gfx = XGraphics.FromPdfPage(page);
            y = Margin;
        }

        void EnsureSpace(double needed)
        {
            if (y + needed > bottom) NewPage();
        }

        NewPage();

        // --- başlık bloğu: logo (varsa) + kurum adı
        var logo = TryDecodeLogo(content.LogoData);
        if (logo is not null)
        {
            try
            {
                const double logoMax = 46;
                var scale = Math.Min(logoMax / logo.PixelWidth, logoMax / logo.PixelHeight);
                var w = logo.PixelWidth * scale;
                var h = logo.PixelHeight * scale;
                gfx.DrawImage(logo, (PageWidth - w) / 2, y, w, h);
                y += h + 10;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "KVKK PDF logosu çizilemedi, metinle devam ediliyor.");
            }
        }

        gfx.DrawString(content.SalonName, title, XBrushes.Black,
            new XRect(Margin, y, contentWidth, 22), XStringFormats.TopCenter);
        y += 26;
        gfx.DrawLine(new XPen(XColor.FromArgb(0xE0, 0xCA, 0xD4), 0.8), Margin, y, PageWidth - Margin, y);
        y += 14;

        // --- gövde: paragraf paragraf, sayfa taşınca yeni sayfa
        foreach (var rawLine in content.Text.Replace("\r\n", "\n").Split('\n'))
        {
            var line = rawLine.TrimEnd();
            if (line.Length == 0)
            {
                y += 6;
                continue;
            }

            var isBullet = line.StartsWith('•') || line.StartsWith('-');
            var isHeading = IsSectionHeading(line);
            var font = isHeading ? heading : body;
            var lineHeight = isHeading ? 15.0 : 13.0;
            var indent = isBullet ? 12.0 : 0.0;

            if (isHeading) { EnsureSpace(lineHeight + 4); y += 4; }

            foreach (var wrapped in WrapText(gfx, line, font, contentWidth - indent))
            {
                EnsureSpace(lineHeight);
                gfx.DrawString(wrapped, font, XBrushes.Black, new XPoint(Margin + indent, y + lineHeight - 4));
                y += lineHeight;
            }
        }

        // --- imza bloğu: "Müşteri Ad Soyad" ve "Tarih & İmza".
        // WhatsApp'la kişiye gönderilen belgede ad OTOMATİK yazılır; herkese açık indirmede
        // boş çizgi kalır (elle doldurulsun diye).
        EnsureSpace(46);
        y += 12;
        var colWidth = (contentWidth - 24) / 2;
        var lineY = y + 20;
        gfx.DrawString("Müşteri Ad Soyad", bold, XBrushes.Black, new XPoint(Margin, y + 9));
        gfx.DrawString("Tarih & İmza", bold, XBrushes.Black, new XPoint(Margin + colWidth + 24, y + 9));
        if (!string.IsNullOrWhiteSpace(customerName))
            gfx.DrawString(customerName!.Trim(), body, XBrushes.Black, new XPoint(Margin, lineY - 3));
        var pen = new XPen(XColor.FromArgb(0x9A, 0x84, 0x90), 0.7);
        gfx.DrawLine(pen, Margin, lineY, Margin + colWidth, lineY);
        gfx.DrawLine(pen, Margin + colWidth + 24, lineY, Margin + contentWidth, lineY);

        gfx.Dispose();

        // --- alt bilgi: her sayfaya "Kurum · KVKK · Sayfa X/Y"
        var stamp = DateTime.UtcNow.AddHours(3).ToString("dd.MM.yyyy");
        for (var i = 0; i < document.PageCount; i++)
        {
            using var pageGfx = XGraphics.FromPdfPage(document.Pages[i]);
            var text = $"{content.SalonName} · KVKK Aydınlatma Metni ve Açık Rıza Beyanı · {stamp} · Sayfa {i + 1}/{document.PageCount}";
            pageGfx.DrawString(text, footer, XBrushes.Gray,
                new XRect(Margin, PageHeight - Margin - 10, contentWidth, 12), XStringFormats.TopCenter);
        }

        using var stream = new MemoryStream();
        document.Save(stream, closeStream: false);
        return stream.ToArray();
    }

    /// <summary>"3. KİŞİSEL VERİLERİN..." gibi numaralı bölüm başlığı mı?</summary>
    private static bool IsSectionHeading(string line)
    {
        var i = 0;
        while (i < line.Length && char.IsDigit(line[i])) i++;
        return i > 0 && i < line.Length && line[i] == '.' && line.Length > i + 1;
    }

    /// <summary>Metni verilen genişliğe kelime kelime sarar (PDFsharp akış düzeni sunmaz).</summary>
    private static IEnumerable<string> WrapText(XGraphics gfx, string text, XFont font, double maxWidth)
    {
        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0) yield break;

        var current = new StringBuilder(words[0]);
        for (var i = 1; i < words.Length; i++)
        {
            var candidate = $"{current} {words[i]}";
            if (gfx.MeasureString(candidate, font).Width <= maxWidth)
            {
                current.Clear().Append(candidate);
            }
            else
            {
                yield return current.ToString();
                current.Clear().Append(words[i]);
            }
        }
        yield return current.ToString();
    }

    /// <summary>Logo "data:image/...;base64,..." biçiminde saklanır; ham baytlara çevirir.</summary>
    private XImage? TryDecodeLogo(string? logoData)
    {
        if (string.IsNullOrWhiteSpace(logoData)) return null;
        try
        {
            var comma = logoData.IndexOf(',');
            if (!logoData.StartsWith("data:image", StringComparison.OrdinalIgnoreCase) || comma < 0) return null;
            var bytes = Convert.FromBase64String(logoData[(comma + 1)..]);
            return XImage.FromStream(new MemoryStream(bytes));
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "KVKK PDF logosu çözülemedi.");
            return null;
        }
    }
}

/// <summary>
/// PDFsharp'ın (GDI'sız sürüm) yazı tipi çözücüsü. Sunucuda kurulu font olmayabileceği için
/// KvkkSans ailesi assembly'ye gömülüdür — mobil KVKK PDF'i ile aynı yazı tipi.
/// </summary>
internal sealed class EmbeddedFontResolver : IFontResolver
{
    private const string Regular = "KvkkSans#regular";
    private const string Bold = "KvkkSans#bold";

    private static readonly object Gate = new();
    private static bool _registered;

    /// <summary>Global çözücü süreç başına bir kez kurulur.</summary>
    public static void EnsureRegistered()
    {
        if (_registered) return;
        lock (Gate)
        {
            if (_registered) return;
            GlobalFontSettings.FontResolver ??= new EmbeddedFontResolver();
            _registered = true;
        }
    }

    public FontResolverInfo? ResolveTypeface(string familyName, bool isBold, bool isItalic)
        => new(isBold ? Bold : Regular);

    public byte[]? GetFont(string faceName)
    {
        var resource = faceName == Bold
            ? "GuzellikMerkezi.Infrastructure.Assets.Fonts.KvkkSans-Bold.ttf"
            : "GuzellikMerkezi.Infrastructure.Assets.Fonts.KvkkSans.ttf";

        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)
            ?? throw new InvalidOperationException($"Gömülü yazı tipi bulunamadı: {resource}");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}

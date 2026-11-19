using System.Security.Claims;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// MAYDANOZ PLATFORM KÖPRÜSÜ (kullanıcı kararı 18 Kas 2026: platform ayarları Maydanoz panelinden yönetilir; gizli
/// anahtarlar yazılır, geri okunmaz). İmzalı <c>/api/connector/v1/platform/&lt;yol&gt;</c> isteği, izin listesindeki
/// <c>/api/platform/&lt;yol&gt;</c> ucuna platform yöneticisi kimliğiyle aktarılır. YÖNLENDİRMEDEN ÖNCE çalışır: hedef
/// uç, doğrulama ve iş kuralları platform panelininkiyle aynıdır (ikinci bir kopya yoktur).
/// <para>
/// Güvenlik kuralları:
/// <list type="bullet">
///   <item>İmza ÖZGÜN yol (köprü yolu) üzerinden, bağlayıcının kendi kapısında doğrulanır (<see cref="ConnectorAuthMiddleware.AuthenticateAsync"/>).</item>
///   <item><c>platform.manage</c> kapsamı zorunludur; mevcut anahtar bu kapsam verilmeden köprüyü kullanamaz.</item>
///   <item>İzin listesi yöntem + TAM yol kalıbıdır; varsayılan RET. Yol yalnız küçük harf, rakam ve tire içerebilir.</item>
///   <item>Gelen <c>Authorization</c> başlığı silinir: bir taşıyıcı jeton köprünün kimliğini değiştiremez.</item>
///   <item>Kimlik etkin bir platform yöneticisi hesabıdır (yabancı anahtar sürprizi olmasın) ve <c>via=maydanoz</c> taşır.</item>
///   <item>Yazmalar denetim kaydına GÖVDESİZ girer: gövde gizli anahtar taşıyabilir.</item>
/// </list>
/// </para>
/// </summary>
public sealed partial class PlatformBridgeMiddleware(RequestDelegate next, ILogger<PlatformBridgeMiddleware> logger)
{
    public const string BridgePrefix = "/api/connector/v1/platform";
    public const string TargetPrefix = "/api/platform";
    public const string Scope = "platform.manage";
    public const string AuthenticationType = "MaydanozConnector";
    public const string ViaClaim = "via";
    public const string AuditAction = "MaydanozPlatform";

    private const string Id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    /// <summary>
    /// Köprüden geçebilen uçlar — 1. dilim: platform AYARLARI (mesajlaşma ve ödeme, sistem bölümleri ve kuyruk,
    /// WhatsApp kontör ayarları / fiyat kuralları / kredi paketleri, abonelik paketleri).
    /// 2. dilim (kullanıcı isteği 19 Kas 2026: "BeautyAsist'in destek mesajlarını Maydanoz'un destek kısmına çek; müşteriler
    /// sayfasında kurum adına tıklayınca düzenleme yapılabilsin; veritabanları dinamik olsun"): DESTEK kuyruğu (liste,
    /// özet, ayrıntı, yanıt, durum/öncelik), KURUMLAR (liste, ayrıntı, YALNIZ PROFİL güncellemesi — paket/dönem/durum
    /// köprüden değişmez) ve VERİTABANI izleme (ölçümler + şema; satır verisi YOK).
    /// </summary>
    internal static readonly IReadOnlyList<(string Method, Regex Path)> Allowed =
    [
        ("GET", Rule("^/support$")),
        ("GET", Rule("^/support/summary$")),
        ("GET", Rule($"^/support/{Id}$")),
        ("POST", Rule($"^/support/{Id}/reply$")),
        ("PUT", Rule($"^/support/{Id}$")),
        ("GET", Rule("^/tenants$")),
        ("GET", Rule($"^/tenants/{Id}$")),
        ("PUT", Rule($"^/tenants/{Id}/profile$")),
        ("GET", Rule("^/system/database$")),
        ("GET", Rule("^/system/database/schema$")),
        ("GET", Rule("^/messaging/settings$")),
        ("PUT", Rule("^/messaging/settings$")),
        ("POST", Rule("^/messaging/test-(sms|email|whatsapp)$")),
        ("GET", Rule("^/system/settings$")),
        ("PUT", Rule("^/system/settings$")),
        ("GET", Rule("^/system/queue$")),
        ("POST", Rule($"^/system/queue/{Id}/requeue$")),
        ("GET", Rule("^/whatsapp/billing-settings$")),
        ("PUT", Rule("^/whatsapp/billing-settings$")),
        ("GET", Rule("^/whatsapp/(pricing|credit-packages)$")),
        ("POST", Rule("^/whatsapp/(pricing|credit-packages)$")),
        ("PUT", Rule($"^/whatsapp/(pricing|credit-packages)/{Id}$")),
        ("DELETE", Rule($"^/whatsapp/(pricing|credit-packages)/{Id}$")),
        ("GET", Rule("^/subscription-plans$")),
        ("POST", Rule("^/subscription-plans$")),
        ("GET", Rule($"^/subscription-plans/{Id}$")),
        ("PUT", Rule($"^/subscription-plans/{Id}$")),
        ("DELETE", Rule($"^/subscription-plans/{Id}$")),
    ];

    [GeneratedRegex("^(/[a-z0-9-]+)+$", RegexOptions.CultureInvariant, 100)]
    private static partial Regex SafePath();

    private static Regex Rule(string pattern) => new(pattern, RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromMilliseconds(100));

    public async Task InvokeAsync(HttpContext http, IConfiguration config, GuzellikDbContext db, IAuditLogger audit)
    {
        if (!http.Request.Path.StartsWithSegments(BridgePrefix, StringComparison.Ordinal, out var remaining))
        {
            await next(http);
            return;
        }

        var key = await ConnectorAuthMiddleware.AuthenticateAsync(http, config, db, logger);
        if (key is null) return;

        if (!key.Allows(Scope))
        {
            await Refuse(http, StatusCodes.Status403Forbidden, "connector.scope", $"Bu anahtarın '{Scope}' yetkisi yok.");
            return;
        }

        var path = remaining.Value ?? string.Empty;
        var method = http.Request.Method.ToUpperInvariant();
        if (!IsAllowed(method, path))
        {
            await Refuse(http, StatusCodes.Status404NotFound, "connector.platform-path", "Bu platform ucu köprüden kullanılamaz.");
            return;
        }

        var admin = await db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
            .Where(u => u.Role == UserRole.PlatformAdmin && u.IsActive)
            .OrderBy(u => u.CreatedAtUtc)
            .Select(u => new { u.Id, u.Email })
            .FirstOrDefaultAsync(http.RequestAborted);
        if (admin is null)
        {
            await Refuse(http, StatusCodes.Status503ServiceUnavailable, "connector.platform-user", "Etkin platform yöneticisi hesabı yok.");
            return;
        }

        http.Request.Headers.Remove("Authorization");
        http.User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, admin.Id.ToString()),
                new Claim(ClaimTypes.Email, admin.Email),
                new Claim(ClaimTypes.Role, nameof(UserRole.PlatformAdmin)),
                new Claim(ViaClaim, "maydanoz"),
                new Claim("connector_key", key.Id),
            ],
            AuthenticationType, ClaimTypes.Email, ClaimTypes.Role));
        http.Items[ConnectorAuthMiddleware.KeyItem] = key;
        var target = TargetPrefix + path;
        http.Request.Path = target;

        await next(http);

        if (method != "GET" && http.Response.StatusCode is >= 200 and < 300)
        {
            // GÖVDE YAZILMAZ: mesajlaşma/ödeme ayarlarının gövdesi gizli anahtar taşıyabilir.
            await audit.LogAsync(null, null, AuditAction, "Platform", null,
                $"Maydanoz platform köprüsü: {method} {target}",
                new { method, path = target, status = http.Response.StatusCode, key = key.Id, via = "maydanoz" },
                CancellationToken.None);
        }
    }

    public static bool IsAllowed(string method, string path) =>
        path.Length is > 0 and <= 200 && SafePath().IsMatch(path) && Allowed.Any(rule => rule.Method == method && rule.Path.IsMatch(path));

    private static Task Refuse(HttpContext http, int status, string code, string message)
    {
        http.Response.StatusCode = status;
        return http.Response.WriteAsJsonAsync(new { success = false, error = new { code, message } });
    }
}

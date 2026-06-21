using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Api.Approval;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Evrensel personel onay kapısı. Staff rolünün TÜM yazma isteklerini (POST/PUT/PATCH/DELETE, /api/admin/*)
/// yakalar; çalıştırmak yerine PendingOperation (taslak) olarak kuyruğa alır ve "onaya gönderildi" yanıtı döner.
/// Kurum yöneticisi onaylayınca <see cref="IApprovalReplayer"/> isteği aynen uygular; reddedilirse hiç işlenmez.
/// İstisnalar: pending-operations (özyineleme) ve adisyonlar (kendi onay akışı var).
/// </summary>
public sealed class StaffApprovalGateMiddleware
{
    private readonly RequestDelegate _next;

    // Kendi onay/akışı olan ya da özyinelemeye yol açacak yollar — kapı bunları yakalamaz.
    private static readonly string[] ExemptPrefixes =
    {
        "/api/admin/pending-operations",
        "/api/admin/adisyonlar",
    };

    public StaffApprovalGateMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext http, ICurrentUser currentUser, ITenantContext tenantContext, IPendingOperationService pendingOps)
    {
        if (!ShouldGate(http, currentUser))
        {
            await _next(http);
            return;
        }

        var tenantId = currentUser.TenantId ?? Guid.Empty;
        if (tenantId == Guid.Empty)
        {
            await _next(http); // tenant yoksa normal akışta uygun hata döner
            return;
        }

        // İstek gövdesini oku (kısa devre yapacağımız için stream'i geri sarmaya gerek yok).
        http.Request.EnableBuffering();
        string body = string.Empty;
        if (http.Request.ContentLength is > 0)
        {
            using var reader = new StreamReader(http.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
            body = await reader.ReadToEndAsync(http.RequestAborted);
            http.Request.Body.Position = 0;
        }

        var payload = JsonSerializer.Serialize(new ReplayPayload(
            http.Request.Method,
            http.Request.Path.Value ?? string.Empty,
            http.Request.QueryString.Value ?? string.Empty,
            http.Request.ContentType,
            body,
            tenantContext.BranchId?.ToString()));

        var (title, summary) = Describe(http.Request.Method, http.Request.Path.Value ?? string.Empty);
        var requestedByName = currentUser.Email ?? "Personel";

        var createReq = new CreatePendingOperationRequest(PendingOperationType.HttpReplay, title, summary, payload);
        var result = await pendingOps.CreateAsync(tenantId, tenantContext.BranchId, currentUser.UserId ?? Guid.Empty, requestedByName, createReq, http.RequestAborted);

        http.Response.StatusCode = StatusCodes.Status200OK;
        var envelope = ApiResponse<object>.Ok(new
        {
            pendingApproval = true,
            message = "İşlem onaya gönderildi. Kurum yöneticisi onayladığında geçerli olacak.",
            pendingOperationId = result.IsSuccess ? result.Value?.Id : (Guid?)null,
            title,
        }, http.TraceIdentifier);
        await http.Response.WriteAsJsonAsync(envelope, http.RequestAborted);
    }

    private static bool ShouldGate(HttpContext http, ICurrentUser currentUser)
    {
        if (!currentUser.IsAuthenticated || currentUser.Role != UserRole.Staff) return false;

        var method = http.Request.Method;
        if (!(HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method)))
            return false;

        var path = http.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/admin/", StringComparison.OrdinalIgnoreCase)) return false;
        foreach (var prefix in ExemptPrefixes)
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;

        // Randevu durum değişikliği (Tamamlandı/İptal/Gelmedi/Onaylandı) onay kapısından muaf —
        // personel direkt uygular; rutin operasyon, onay yığılması/tamamlanamaz hatası oluşmasın.
        if (path.StartsWith("/api/admin/appointments/", StringComparison.OrdinalIgnoreCase)
            && path.EndsWith("/status", StringComparison.OrdinalIgnoreCase))
            return false;

        return true;
    }

    /// <summary>Yol + method'tan kullanıcı dostu başlık üretir (onaylar sayfasında okunur olsun).</summary>
    private static (string Title, string Summary) Describe(string method, string path)
    {
        // Nested kaynaklar segments[2]'yi gölgeler (ör. customers/{id}/treatment-photos) — özel olarak etiketle.
        if (path.Contains("/treatment-photos", StringComparison.OrdinalIgnoreCase))
        {
            var photoAction = method.ToUpperInvariant() == "DELETE" ? "silme" : "ekleme";
            return ($"İşlem fotoğrafı {photoAction}", $"{method} {path}");
        }
        if (path.Contains("/consultation", StringComparison.OrdinalIgnoreCase))
            return ("Müşteri bilgi ve onay formu güncelleme", $"{method} {path}");
        if (path.Contains("/whatsapp/reminder", StringComparison.OrdinalIgnoreCase))
            return ("WhatsApp hatırlatma gönderme", $"{method} {path}");
        if (path.Contains("/whatsapp/settings", StringComparison.OrdinalIgnoreCase))
            return ("WhatsApp ayarı güncelleme", $"{method} {path}");
        if (path.Contains("/blacklist", StringComparison.OrdinalIgnoreCase))
            return ("Kara liste güncelleme", $"{method} {path}");
        if (path.Contains("/passive-threshold", StringComparison.OrdinalIgnoreCase))
            return ("Pasif müşteri eşiği güncelleme", $"{method} {path}");

        // /api/admin/<area>/... → alan etiketi
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var area = segments.Length >= 3 ? segments[2] : "kayıt";
        var label = area switch
        {
            "customers" => "Müşteri",
            "appointments" => "Randevu",
            "services" => "Hizmet",
            "packages" => "Paket",
            "products" => "Ürün",
            "stock-movements" => "Stok hareketi",
            "accounts" => "Cari hesap",
            "expenses" => "Gider",
            "expense-categories" => "Gider kategorisi",
            "service-categories" => "Hizmet kategorisi",
            "notification-templates" => "Bildirim şablonu",
            "campaigns" => "Kampanya",
            "loyalty" => "Sadakat puanı",
            "branches" => "Şube",
            "staff" => "Personel",
            "schedule" => "Çizelge/İzin",
            _ => "Kayıt",
        };
        var action = method.ToUpperInvariant() switch
        {
            "POST" => "oluşturma",
            "PUT" => "güncelleme",
            "PATCH" => "güncelleme",
            "DELETE" => "silme",
            _ => "işlemi",
        };
        return ($"{label} {action}", $"{method} {path}");
    }
}

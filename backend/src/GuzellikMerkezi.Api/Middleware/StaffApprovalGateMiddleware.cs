using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Api.Approval;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain;
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
        // Randevu durum güncelleme kapıdan muaftır (rutin operasyon) ama İŞLEM iznine tabidir.
        if (IsStaffWrite(http, currentUser) && IsAppointmentStatusPath(http.Request.Path.Value ?? string.Empty)
            && !Permissions.IsActionAllowed(currentUser.Permissions, Permissions.AppointmentsStatus))
        {
            await WriteForbiddenAsync(http, "Randevu durumunu güncelleme yetkiniz yok. Kurum yöneticinizden yetki isteyin.");
            return;
        }

        if (!ShouldGate(http, currentUser))
        {
            await _next(http);
            return;
        }

        // İşlem (aksiyon) izni: yönetici bu personel için ilgili aksiyonu kapattıysa
        // istek taslağa bile alınmaz — doğrudan 403 döner (sayfayı görmek ≠ işlemi yapmak).
        var requiredAction = RequiredAction(http.Request.Method, http.Request.Path.Value ?? string.Empty);
        if (requiredAction is not null && !Permissions.IsActionAllowed(currentUser.Permissions, requiredAction))
        {
            await WriteForbiddenAsync(http, "Bu işlem için yetkiniz yok. Kurum yöneticinizden yetki isteyin.");
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

        // Onaya alma BAŞARISIZ olduysa "gönderildi" DEME — gerçek hatayı dön; aksi halde işlem sessizce kaybolur
        // (kullanıcı onaya gittiğini sanır ama kayıt oluşmamıştır).
        if (!result.IsSuccess)
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            var errorEnvelope = ApiResponse<object>.Fail(
                result.Error.Code,
                $"İşlem onaya alınamadı: {result.Error.Message}",
                http.TraceIdentifier);
            await http.Response.WriteAsJsonAsync(errorEnvelope, http.RequestAborted);
            return;
        }

        http.Response.StatusCode = StatusCodes.Status200OK;
        var envelope = ApiResponse<object>.Ok(new
        {
            pendingApproval = true,
            message = "İşlem onaya gönderildi. Kurum yöneticisi onayladığında geçerli olacak.",
            pendingOperationId = result.Value?.Id,
            title,
        }, http.TraceIdentifier);
        await http.Response.WriteAsJsonAsync(envelope, http.RequestAborted);
    }

    private static bool IsStaffWrite(HttpContext http, ICurrentUser currentUser)
    {
        if (!currentUser.IsAuthenticated || currentUser.Role != UserRole.Staff) return false;
        var method = http.Request.Method;
        return HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
    }

    private static bool IsAppointmentStatusPath(string path) =>
        path.StartsWith("/api/admin/appointments/", StringComparison.OrdinalIgnoreCase)
        && path.EndsWith("/status", StringComparison.OrdinalIgnoreCase);

    private static async Task WriteForbiddenAsync(HttpContext http, string message)
    {
        http.Response.StatusCode = StatusCodes.Status403Forbidden;
        await http.Response.WriteAsJsonAsync(
            ApiResponse<object>.Fail("Forbidden", message, http.TraceIdentifier), http.RequestAborted);
    }

    /// <summary>
    /// Yol + method'tan gerekli İŞLEM izni anahtarı (Permissions.*). null → aksiyon izni tanımlı değil,
    /// yalnız onay kapısı işler. Adisyon uçları muaf listede olduğundan burada görünmez;
    /// onların izni AdisyonEndpoints'te endpoint filtresiyle uygulanır.
    /// </summary>
    private static string? RequiredAction(string method, string path)
    {
        bool Is(string prefix) => path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        bool Has(string part) => path.Contains(part, StringComparison.OrdinalIgnoreCase);

        if (Is("/api/admin/customers"))
        {
            if (Has("/blacklist") || Has("/vip")) return Permissions.CustomersTags;
            if (HttpMethods.IsDelete(method) && !Has("/treatment-photos")) return Permissions.CustomersDelete;
            return Permissions.CustomersManage; // müşteri kartı + konsültasyon + tedavi günlüğü
        }
        if (Is("/api/admin/appointments")) return Permissions.AppointmentsCreate;
        if (Is("/api/admin/waitlist")) return Permissions.WaitlistManage;
        if (Is("/api/admin/services") || Is("/api/admin/packages") || Is("/api/admin/service-categories")
            || Is("/api/admin/campaigns") || Is("/api/admin/loyalty")) return Permissions.ServicesManage;
        if (Is("/api/admin/gift-cards")) return Permissions.GiftCardsManage;
        if (Is("/api/admin/products")) return Permissions.StockManage;
        if (Is("/api/admin/stock-movements")) return Permissions.StockMovements;
        if (Is("/api/admin/cash/closing")) return Permissions.CashClosingClose;
        if (Is("/api/admin/cash-flow")) return Permissions.CashRegisterEntry;
        if (Is("/api/admin/accounts")) return Has("/payments") ? Permissions.AccountingCollect : Permissions.AccountingAccounts;
        if (Is("/api/admin/expenses") || Is("/api/admin/expense-categories")) return Permissions.AccountingExpenses;
        if (Is("/api/admin/notification-templates")) return Permissions.NotificationsTemplates;
        if (Is("/api/admin/notifications") || Is("/api/admin/whatsapp")) return Permissions.NotificationsSend;
        return null;
    }

    private static bool ShouldGate(HttpContext http, ICurrentUser currentUser)
    {
        if (!IsStaffWrite(http, currentUser)) return false;

        var path = http.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/admin/", StringComparison.OrdinalIgnoreCase)) return false;
        foreach (var prefix in ExemptPrefixes)
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;

        // Randevu durum değişikliği (Tamamlandı/İptal/Gelmedi/Onaylandı) onay kapısından muaf —
        // personel direkt uygular; rutin operasyon, onay yığılması/tamamlanamaz hatası oluşmasın.
        // (İşlem izni kontrolü InvokeAsync başında ayrıca yapılır.)
        if (IsAppointmentStatusPath(path)) return false;

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

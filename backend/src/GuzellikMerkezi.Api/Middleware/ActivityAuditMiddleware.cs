using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Kurum kullanıcılarının panelde yaptığı ve servis seviyesinde detaylı audit üretmeyen
/// başarılı API işlemlerini merkezi olarak loglar. Böylece yeni endpoint eklenince
/// kurum sahibi/personel aksiyonları audit ekranından kaybolmaz.
/// </summary>
public sealed class ActivityAuditMiddleware
{
    private static readonly IReadOnlyDictionary<string, string> EntityNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["accounts"] = "CustomerAccount",
        ["adisyonlar"] = "Adisyon",
        ["appointments"] = "Appointment",
        ["branches"] = "Branch",
        ["campaigns"] = "Campaign",
        ["cash-flow"] = "CashFlow",
        ["commissions"] = "StaffCommission",
        ["customers"] = "Customer",
        ["expense-categories"] = "ExpenseCategory",
        ["expenses"] = "Expense",
        ["features"] = "Feature",
        ["loyalty"] = "LoyaltyTransaction",
        ["logs"] = "AuditLog",
        ["notification-logs"] = "NotificationLog",
        ["notification-templates"] = "NotificationTemplate",
        ["notifications"] = "Notification",
        ["packages"] = "ServicePackage",
        ["pending-operations"] = "PendingOperation",
        ["products"] = "Product",
        ["ratings"] = "Rating",
        ["schedule"] = "StaffTimeOff",
        ["service-categories"] = "ServiceCategory",
        ["services"] = "Service",
        ["staff"] = "Staff",
        ["stock-movements"] = "StockMovement",
        ["subscription-plans"] = "SubscriptionPlan",
        ["tenant"] = "Tenant",
        ["usage"] = "Usage",
        ["whatsapp"] = "WhatsApp",
    };

    private readonly RequestDelegate _next;

    public ActivityAuditMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext http,
        ICurrentUser currentUser,
        IAuditLogger auditLogger,
        IAuditActivityScope activityScope)
    {
        await _next(http);

        if (!ShouldWriteActivityLog(http, currentUser, activityScope)) return;

        var path = http.Request.Path.Value ?? string.Empty;
        var action = ResolveAction(http.Request.Method, path);
        var entityName = ResolveEntityName(path);
        var entityId = ResolveRouteEntityId(http);
        var actor = currentUser.Email ?? currentUser.UserId?.ToString() ?? "Kullanıcı";

        await auditLogger.LogAsync(
            currentUser.TenantId,
            currentUser.BranchId,
            action,
            entityName,
            entityId,
            // Özet kullanıcıya gösterilir — API yolu/HTTP metodu gibi teknik detaylar burada yer almaz
            // (onlar DataJson payload'ında kalır).
            $"{RoleDisplay(currentUser.Role)} {actor}, {EntityDisplay(entityName)} modülünde {ActionDisplay(action)} işlemi gerçekleştirdi.",
            new
            {
                method = http.Request.Method.ToUpperInvariant(),
                path,
                query = SafeQuery(http.Request.Query),
                statusCode = http.Response.StatusCode,
                endpoint = http.GetEndpoint()?.DisplayName,
                source = currentUser.Role == UserRole.Staff ? "StaffPanel" : "InstitutionPanel",
                traceId = http.TraceIdentifier
            },
            CancellationToken.None);
    }

    private static bool ShouldWriteActivityLog(HttpContext http, ICurrentUser currentUser, IAuditActivityScope activityScope)
    {
        if (activityScope.HasAuditLogWritten) return false;
        if (!currentUser.IsAuthenticated) return false;
        if (currentUser.TenantId is null) return false;
        if (!IsInstitutionActor(currentUser.Role)) return false;
        if (http.Response.StatusCode is < 200 or >= 400) return false;

        var method = http.Request.Method.ToUpperInvariant();
        if (method is "OPTIONS" or "HEAD") return false;

        var path = http.Request.Path.Value ?? string.Empty;
        var isAdminPanelApi = path.StartsWith("/api/admin", StringComparison.OrdinalIgnoreCase);
        var isTenantRatingAction = path.StartsWith("/api/ratings", StringComparison.OrdinalIgnoreCase);
        var isAuditableAuthAction = path.StartsWith("/api/auth/change-password", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/auth/logout", StringComparison.OrdinalIgnoreCase);

        if (!isAdminPanelApi && !isTenantRatingAction && !isAuditableAuthAction) return false;

        // Log ekranını okumak yeni log üretmesin; fakat DELETE /api/admin/logs/clear ayrıca loglansın.
        if (method == "GET" && path.StartsWith("/api/admin/logs", StringComparison.OrdinalIgnoreCase)) return false;

        return true;
    }

    private static bool IsInstitutionActor(UserRole? role) =>
        role is UserRole.InstitutionOwner or UserRole.BranchManager or UserRole.Staff;

    private static string ResolveAction(string method, string path)
    {
        var upperMethod = method.ToUpperInvariant();
        if (upperMethod == "GET") return "View";
        if (upperMethod == "PUT") return "Update";
        if (upperMethod == "DELETE") return "Delete";
        if (upperMethod == "PATCH")
        {
            if (path.Contains("/approve", StringComparison.OrdinalIgnoreCase)) return "Approve";
            if (path.Contains("/reject", StringComparison.OrdinalIgnoreCase)) return "Reject";
            if (path.Contains("/cancel", StringComparison.OrdinalIgnoreCase)) return "Cancel";
            if (path.Contains("/status", StringComparison.OrdinalIgnoreCase)) return "ChangeStatus";
            if (path.Contains("/schedule", StringComparison.OrdinalIgnoreCase)
                || path.Contains("/reschedule", StringComparison.OrdinalIgnoreCase)) return "Reschedule";
            if (path.Contains("/notes", StringComparison.OrdinalIgnoreCase)) return "ChangeNotes";
            return "Change";
        }

        if (upperMethod == "POST")
        {
            if (path.Contains("/approve", StringComparison.OrdinalIgnoreCase)) return "Approve";
            if (path.Contains("/cancel", StringComparison.OrdinalIgnoreCase)) return "Cancel";
            if (path.Contains("/send", StringComparison.OrdinalIgnoreCase)) return "Send";
            if (path.Contains("/reminder", StringComparison.OrdinalIgnoreCase)) return "Send";
            if (path.Contains("/payments", StringComparison.OrdinalIgnoreCase)) return "RegisterPayment";
            if (path.Contains("/movements", StringComparison.OrdinalIgnoreCase)) return "StockMovement";
            if (path.Contains("/upgrade", StringComparison.OrdinalIgnoreCase)) return "Upgrade";
            return "Create";
        }

        return upperMethod;
    }

    private static string ResolveEntityName(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length >= 2 && segments[0].Equals("api", StringComparison.OrdinalIgnoreCase)
            && segments[1].Equals("auth", StringComparison.OrdinalIgnoreCase))
        {
            return "Auth";
        }

        if (segments.Length >= 3 && segments[0].Equals("api", StringComparison.OrdinalIgnoreCase)
            && segments[1].Equals("admin", StringComparison.OrdinalIgnoreCase))
        {
            return EntityNames.TryGetValue(segments[2], out var entityName)
                ? entityName
                : ToPascalName(segments[2]);
        }

        if (segments.Length >= 2 && segments[0].Equals("api", StringComparison.OrdinalIgnoreCase)
            && segments[1].Equals("ratings", StringComparison.OrdinalIgnoreCase))
        {
            return "Rating";
        }

        return "ApiRequest";
    }

    private static Guid? ResolveRouteEntityId(HttpContext http)
    {
        foreach (var key in new[] { "id", "tenantId", "templateId", "planId" })
        {
            if (http.Request.RouteValues.TryGetValue(key, out var raw)
                && Guid.TryParse(Convert.ToString(raw), out var id))
            {
                return id;
            }
        }

        return null;
    }

    private static IReadOnlyDictionary<string, string>? SafeQuery(IQueryCollection query)
    {
        if (query.Count == 0) return null;

        var safe = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in query)
        {
            safe[item.Key] = IsSensitiveQueryKey(item.Key) ? "[redacted]" : item.Value.ToString();
        }

        return safe;
    }

    private static bool IsSensitiveQueryKey(string key) =>
        key.Contains("password", StringComparison.OrdinalIgnoreCase)
        || key.Contains("token", StringComparison.OrdinalIgnoreCase)
        || key.Contains("secret", StringComparison.OrdinalIgnoreCase)
        || key.Contains("key", StringComparison.OrdinalIgnoreCase)
        || key.Contains("authorization", StringComparison.OrdinalIgnoreCase);

    private static string RoleDisplay(UserRole? role) => role switch
    {
        UserRole.InstitutionOwner => "Kurum sahibi",
        UserRole.BranchManager => "Şube yöneticisi",
        UserRole.Staff => "Personel",
        _ => "Kullanıcı"
    };

    private static string ActionDisplay(string action) => action switch
    {
        "View" => "görüntüleme",
        "Update" => "güncelleme",
        "Delete" => "silme",
        "Change" => "değişiklik",
        "ChangeStatus" => "durum değişikliği",
        "ChangeNotes" => "not güncelleme",
        "Reschedule" => "yeniden planlama",
        "Approve" => "onaylama",
        "Reject" => "reddetme",
        "Cancel" => "iptal",
        "Send" => "gönderim",
        "RegisterPayment" => "tahsilat",
        "StockMovement" => "stok hareketi",
        "Upgrade" => "yükseltme",
        "Submit" => "kayıt oluşturma",
        _ => "işlem"
    };

    private static string EntityDisplay(string entityName) => entityName switch
    {
        "Customer" => "Müşteri",
        "Appointment" => "Randevu",
        "Expense" => "Gider",
        "ExpenseCategory" => "Gider Kategorisi",
        "Product" => "Ürün",
        "Staff" => "Personel",
        "CustomerAccount" => "Cari Hesap",
        "AccountPayment" => "Tahsilat",
        "PendingOperation" => "Onay İsteği",
        "Branch" => "Şube",
        "CashFlow" => "Kasa",
        "Feature" => "Özellik",
        "AuditLog" => "Log Kayıtları",
        "Notification" => "Bildirim",
        "NotificationLog" => "Bildirim Logu",
        "NotificationTemplate" => "Bildirim Şablonu",
        "Service" => "Hizmet",
        "ServiceCategory" => "Hizmet Kategorisi",
        "ServicePackage" => "Paket",
        "StockMovement" => "Stok Hareketi",
        "Tenant" => "Kurum",
        "Usage" => "Kullanım",
        "Rating" => "Müşteri Puanlama",
        "WhatsApp" => "WhatsApp",
        "SubscriptionPlan" => "Abonelik Planı",
        "Auth" => "Oturum",
        "Adisyonlar" => "Adisyon",
        "Campaigns" => "Kampanya",
        "Loyalty" => "Sadakat",
        "Commissions" => "Prim",
        "Schedule" => "Çizelge",
        _ => entityName
    };

    private static string ToPascalName(string segment)
    {
        var parts = segment.Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Concat(parts.Select(part => string.Concat(char.ToUpperInvariant(part[0]), part[1..])));
    }
}

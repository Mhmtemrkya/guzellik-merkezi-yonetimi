using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Müşteri rolünü yalnızca online portal uçlarına (/api/customer) ve auth uçlarına kısıtlar.
/// Yönetim/platform uçları (/api/admin, /api/platform) yalnız RequireAuthorization istediğinden,
/// kimliği doğrulanmış bir müşteri token'ı buralara erişebilirdi — bu kapı onu 403 ile engeller.
/// Tersi de geçerli: müşteri olmayan roller /api/customer'a giremez.
/// </summary>
public sealed class CustomerScopeMiddleware
{
    private readonly RequestDelegate _next;

    public CustomerScopeMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext http, ICurrentUser currentUser)
    {
        if (currentUser.IsAuthenticated)
        {
            var path = http.Request.Path;
            var isCustomerPath = path.StartsWithSegments("/api/customer");

            if (currentUser.Role == UserRole.Customer)
            {
                // Müşteri yalnızca /api/customer ve /api/auth altında dolaşabilir.
                if (!isCustomerPath && !path.StartsWithSegments("/api/auth"))
                {
                    await WriteForbiddenAsync(http, "Bu alan müşteri hesabıyla kullanılamaz.");
                    return;
                }
            }
            else if (isCustomerPath)
            {
                // Müşteri portalı yalnız müşteri rolüne açıktır.
                await WriteForbiddenAsync(http, "Müşteri portalı yalnızca müşteri hesabıyla kullanılabilir.");
                return;
            }
        }

        await _next(http);
    }

    private static async Task WriteForbiddenAsync(HttpContext http, string message)
    {
        http.Response.StatusCode = StatusCodes.Status403Forbidden;
        http.Response.ContentType = "application/json";
        await http.Response.WriteAsync(JsonSerializer.Serialize(ApiResponse<object>.Fail("Forbidden", message, http.TraceIdentifier)));
    }
}

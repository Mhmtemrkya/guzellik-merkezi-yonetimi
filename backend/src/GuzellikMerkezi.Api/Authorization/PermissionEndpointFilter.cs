using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Api.Authorization;

/// <summary>
/// Endpoint filter — yalnızca PERSONEL (Staff) rolünü sayfa iznine tabi tutar. Kurum sahibi / şube yöneticisi /
/// platform admin tam erişimlidir. Personel ilgili izne sahip değilse 403 (uygulama zarfı) döner.
/// Gerekçe: frontend menü gizleme tek başına güvenlik sınırı DEĞİLDİR; izinsiz personel endpoint'i doğrudan
/// çağırabiliyordu (kritikbulgular #1). Yalnızca çapraz bağımlılığı olmayan hassas alanlara uygulanır.
/// </summary>
public sealed class PermissionEndpointFilter : IEndpointFilter
{
    private readonly string _permission;

    public PermissionEndpointFilter(string permission) => _permission = permission;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();

        // Yönetici roller + platform admin tam erişimli; yalnızca personel izne tabi.
        if (user.Role != UserRole.Staff || user.HasPermission(_permission))
            return await next(context);

        return Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Bu işlem için yetkiniz yok.", context.HttpContext.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
    }
}

public static class PermissionFilterExtensions
{
    /// <summary>Gruptaki tüm endpoint'lere personel sayfa-izni kontrolü ekler.</summary>
    public static RouteGroupBuilder RequirePermission(this RouteGroupBuilder group, string permission)
        => group.AddEndpointFilter(new PermissionEndpointFilter(permission));
}

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
    private readonly bool _writeOnly;

    public PermissionEndpointFilter(string permission, bool writeOnly = false)
    {
        _permission = permission;
        _writeOnly = writeOnly;
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();

        // Yönetici roller + platform admin tam erişimli; yalnızca personel izne tabi.
        if (user.Role != UserRole.Staff) return await next(context);

        // writeOnly: yalnız yazma metodlarını kısıtla (okuma sayfa izniyle serbest).
        if (_writeOnly)
        {
            var method = context.HttpContext.Request.Method;
            var isWrite = HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
            if (!isWrite) return await next(context);
        }

        // Noktalı anahtar = işlem izni (eski kayıtlar için geriye uyumlu kural), düz anahtar = sayfa izni.
        var allowed = _permission.Contains('.')
            ? GuzellikMerkezi.Domain.Permissions.IsActionAllowed(user.Permissions, _permission)
            : user.HasPermission(_permission);
        if (allowed) return await next(context);

        return Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Bu işlem için yetkiniz yok.", context.HttpContext.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
    }
}

public static class PermissionFilterExtensions
{
    /// <summary>Gruptaki tüm endpoint'lere personel izin kontrolü ekler. writeOnly=true → yalnız POST/PUT/PATCH/DELETE kısıtlanır.</summary>
    public static RouteGroupBuilder RequirePermission(this RouteGroupBuilder group, string permission, bool writeOnly = false)
        => group.AddEndpointFilter(new PermissionEndpointFilter(permission, writeOnly));
}

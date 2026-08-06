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

        // writeOnly: yalnız yazma metodlarını kısıtla (okuma sayfa izniyle serbest).
        if (_writeOnly)
        {
            var method = context.HttpContext.Request.Method;
            var isWrite = HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
            if (!isWrite) return await next(context);
        }

        // TEK KARAR NOKTASI: rol modeli (yönetici roller tam erişimli, personel izne tabi) ve
        // noktalı/düz anahtar ayrımı ICurrentUser.IsAllowed → Permissions.IsGrantedTo içinde durur.
        // Buradaki eski "Role != Staff → serbest" kestirmesi aynı kuralın ikinci bir kopyasıydı;
        // servis tarafındaki bileşik kontrollerle ayrışabiliyordu.
        if (user.IsAllowed(_permission)) return await next(context);

        return Results.Json(
            ApiResponse<object>.Fail("Forbidden", "Bu işlem için yetkiniz yok.", context.HttpContext.TraceIdentifier),
            statusCode: StatusCodes.Status403Forbidden);
    }
}

/// <summary>
/// ROL tabanlı yetki kapısı — <see cref="GuzellikMerkezi.Domain.Authorization.RolePermissions"/>
/// tablosunu endpoint'te uygular.
/// <para>
/// <see cref="PermissionEndpointFilter"/> yalnız personeli kısıtlar ve diğer TÜM rolleri "tam
/// erişimli" sayar. Yönetici rollerin birbirinden ayrıldığı uçlarda bu yetmiyordu: rol tablosunda
/// <c>BranchWrite</c> yetkisi OLMAYAN şube yöneticisi, yalnız kimlik doğrulaması istenen şube
/// uçlarından kendi kurumundaki diğer şubeleri oluşturup değiştirebiliyordu.
/// </para>
/// </summary>
public sealed class RolePermissionEndpointFilter : IEndpointFilter
{
    private readonly Permission _required;

    public RolePermissionEndpointFilter(Permission required) => _required = required;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();

        // Platform admin kurum ADINA işlem yapar (tenantId açıkça geçilir) → kurum rol tablosuna tabi değil.
        if (user.IsPlatformAdmin) return await next(context);
        if (user.Role is { } role && GuzellikMerkezi.Domain.Authorization.RolePermissions.For(role).HasFlag(_required))
            return await next(context);

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

    /// <summary>Tek bir endpoint'e personel izin kontrolü ekler (grup dışında tanımlanan uçlar için).</summary>
    public static RouteHandlerBuilder RequirePermission(this RouteHandlerBuilder builder, string permission, bool writeOnly = false)
        => builder.AddEndpointFilter(new PermissionEndpointFilter(permission, writeOnly));

    /// <summary>Rol tablosundaki yetkiyi şart koşar (personel dışındaki rolleri de kapsar).</summary>
    public static RouteHandlerBuilder RequireRolePermission(this RouteHandlerBuilder builder, Permission required)
        => builder.AddEndpointFilter(new RolePermissionEndpointFilter(required));
}

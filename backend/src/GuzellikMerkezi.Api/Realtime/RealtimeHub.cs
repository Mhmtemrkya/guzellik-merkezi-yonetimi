using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GuzellikMerkezi.Api.Realtime;

/// <summary>
/// Anlık güncelleme kanalı. İstemci bağlanır, sunucu "şu konu değişti" der, istemci veriyi
/// yeniden çeker. Veri MESAJLA TAŞINMAZ: yetki kapıları normal HTTP uçlarında olduğu gibi
/// kalsın diye yalnızca "tazele" ipucu gönderilir.
///
/// Gruplar: <c>tenant:{tenantId}</c> (kurum geneli) ve <c>user:{userId}</c> (kişiye özel).
/// </summary>
[Authorize]
public sealed class RealtimeHub : Hub
{
    public const string Path = "/hubs/realtime";

    public static string TenantGroup(Guid tenantId) => $"tenant:{tenantId}";
    public static string UserGroup(Guid userId) => $"user:{userId}";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;
        if (Guid.TryParse(user?.FindFirst("tenant_id")?.Value, out var tenantId) && tenantId != Guid.Empty)
            await Groups.AddToGroupAsync(Context.ConnectionId, TenantGroup(tenantId));

        if (Guid.TryParse(user?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId) && userId != Guid.Empty)
            await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId));

        await base.OnConnectedAsync();
    }
}

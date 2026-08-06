using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GuzellikMerkezi.Api.Realtime;

/// <summary>
/// Anlık güncelleme kanalı. İstemci bağlanır, sunucu "şu konu değişti" der, istemci veriyi
/// yeniden çeker. Veri MESAJLA TAŞINMAZ: yetki kapıları normal HTTP uçlarında olduğu gibi
/// kalsın diye yalnızca "tazele" ipucu gönderilir.
///
/// Gruplar: <c>tenant:{tenantId}</c> (kurum İÇİ personel/yönetici) ve <c>user:{userId}</c>
/// (kişiye özel). MÜŞTERİ oturumları kurum grubuna KATILMAZ — bkz. <see cref="OnConnectedAsync"/>.
/// </summary>
[Authorize]
public sealed class RealtimeHub : Hub
{
    public const string Path = "/hubs/realtime";

    /// <summary>Kurum İÇİ yayın grubu — yalnız personel/yönetici oturumları katılır.</summary>
    public static string TenantGroup(Guid tenantId) => $"tenant:{tenantId}";
    public static string UserGroup(Guid userId) => $"user:{userId}";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;

        // MÜŞTERİ OTURUMU KURUM GRUBUNA ALINMAZ (M11).
        //
        // Online randevu portalının müşteri token'ı da bu hub'a bağlanabiliyor ve kurum geneline
        // giden olayları (onay çözümlendi, adisyon değişti, kasa kapandı…) alıyordu. Olaylar bugün
        // veri taşımasa da KONU ADI ve ZAMANLAMA sızıntısıdır: müşteri, salonun iç işleyişini
        // canlı olarak gözleyebilir. Yükün ileride payload taşıması hâlinde sızıntı büyürdü.
        // Müşteri yalnız KENDİ kişisel grubuna katılır.
        var isCustomer = user?.FindFirst("customer_id") is not null;

        if (!isCustomer
            && Guid.TryParse(user?.FindFirst("tenant_id")?.Value, out var tenantId) && tenantId != Guid.Empty)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, TenantGroup(tenantId));
        }

        if (Guid.TryParse(user?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId) && userId != Guid.Empty)
            await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId));

        await base.OnConnectedAsync();
    }
}

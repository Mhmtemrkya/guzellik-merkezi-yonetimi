using GuzellikMerkezi.Application.Abstractions;
using Microsoft.AspNetCore.SignalR;

namespace GuzellikMerkezi.Api.Realtime;

/// <summary>
/// <see cref="IRealtimeNotifier"/>'ın SignalR uygulaması.
///
/// YAYIN ASLA ÇAĞIRANI BOZMAZ: bir istemciye ulaşamamak iş akışını (onay, satış, randevu)
/// düşürmemeli. Hata yutulur ve loglanır — durum zaten veritabanında olduğundan istemci
/// yeniden bağlandığında doğru veriyi görür.
/// </summary>
public sealed class SignalRRealtimeNotifier : IRealtimeNotifier
{
    private readonly IHubContext<RealtimeHub> _hub;
    private readonly ILogger<SignalRRealtimeNotifier> _logger;

    public SignalRRealtimeNotifier(IHubContext<RealtimeHub> hub, ILogger<SignalRRealtimeNotifier> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public Task PublishToTenantAsync(Guid tenantId, RealtimeEvent payload, CancellationToken ct = default) =>
        SendAsync(RealtimeHub.TenantGroup(tenantId), payload, ct);

    public Task PublishToUserAsync(Guid tenantId, Guid userId, RealtimeEvent payload, CancellationToken ct = default) =>
        SendAsync(RealtimeHub.UserGroup(userId), payload, ct);

    private async Task SendAsync(string group, RealtimeEvent payload, CancellationToken ct)
    {
        try
        {
            await _hub.Clients.Group(group).SendAsync("realtime", payload, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Anlık bildirim gönderilemedi (grup: {Group}, tür: {Kind})", group, payload.Kind);
        }
    }
}

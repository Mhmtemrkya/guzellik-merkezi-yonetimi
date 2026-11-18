using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Services;

/// <summary>Kalıcı silme onayı: kurumun adı aynen (Maydanoz eşitlenmiş adı gönderir).</summary>
public sealed record ConnectorTenantPurgeRequest(string? ConfirmName);

public sealed record ConnectorTenantPurgeDto(Guid TenantId, string Name, string Status);

/// <summary>
/// KALICI KURUM SİLME — MAYDANOZ PLATFORM PANELİNDEN (kullanıcı isteği 18 Kas 2026: "platform kısmında hem Maydanoz'da hem
/// BeautyAsist'te kalıcı kurum silme olsun ki DB şişmesin"). Silme, BeautyAsist platform panelindeki "Kalıcı sil" ile AYNI
/// yoldan yapılır (<see cref="ITenantService.DeleteAsync"/>: tek transaction, model türetimli tablo listesi, denetim kaydı).
/// <para>
/// İki kilit: (1) ayrı bağlayıcı yetkisi <c>tenants.delete</c> — ayar köprüsünün (<c>platform.manage</c>) kurum listesi ya da
/// silme taşımaması bilinçli bir karardır; yıkıcı yetki ayrıca verilir. (2) Kurumun adı aynen gönderilmeli: yanlış
/// kimlikle (ya da arada adı değişmiş kurumla) silme yapılmaz.
/// </para>
/// </summary>
public sealed class ConnectorTenantPurge(GuzellikDbContext db, ITenantService tenants)
{
    public async Task<Result<ConnectorTenantPurgeDto>> PurgeAsync(Guid tenantId, ConnectorTenantPurgeRequest request, CancellationToken ct)
    {
        var name = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);
        if (name is null) return Result<ConnectorTenantPurgeDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        if (!string.Equals((request.ConfirmName ?? string.Empty).Trim(), name.Trim(), StringComparison.Ordinal))
        {
            return Result<ConnectorTenantPurgeDto>.Failure(Error.Conflict(
                "Kurum adı eşleşmedi; kurum yeniden adlandırılmış olabilir. Kurumları eşitleyip yeniden deneyin."));
        }

        var deleted = await tenants.DeleteAsync(tenantId, ct);
        return deleted.IsFailure
            ? Result<ConnectorTenantPurgeDto>.Failure(deleted.Error)
            : Result<ConnectorTenantPurgeDto>.Success(new ConnectorTenantPurgeDto(tenantId, name, "deleted"));
    }
}

using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Connector;

/// <summary>
/// Maydanoz'un eşitlediği kurum satırı. KVKK gereği yalnız abonelik yönetimine gereken alanlar
/// taşınır: yetkili adı, telefon, e-posta, vergi no/dairesi ve ünvan BU SÖZLEŞMEDE YOKTUR
/// (kişisel veri sunucudan çıkmadan elenir, Maydanoz'da süzülmez).
/// <para>Durum ve dönem sabit küçük harfli metinlerdir (<c>trial|active|suspended|cancelled</c>,
/// <c>monthly|yearly</c>); enum sayısı değişirse karşı taraf yanlış okumaz, tanımadığını atlar.</para>
/// </summary>
public sealed record ConnectorTenantDto(
    Guid Id,
    string? Code,
    string Name,
    string Status,
    string? PlanKey,
    string? Period,
    DateTime? TrialEndsAtUtc,
    DateTime? SubscriptionEndsAtUtc,
    int BranchCount,
    bool IsSelfSignup,
    DateTime CreatedAtUtc);

/// <summary>Bağlayıcının okuma uçları: platform servislerinin DTO'ları yerine sözleşmeye özel, en az alanlı görünüm.</summary>
public interface IConnectorQueries
{
    /// <summary>
    /// Bütün kurumlar (iptal edilenler dahil — Maydanoz iptali de bilmeli), oluşturulma sırasıyla.
    /// Sıra kararlıdır: eşitleme sayfa sayfa çekerken yeni kurum yalnız SONA eklenir.
    /// </summary>
    Task<PagedResult<ConnectorTenantDto>> ListTenantsAsync(int page, int pageSize, CancellationToken ct = default);

    Task<ConnectorTenantDto?> GetTenantAsync(Guid id, CancellationToken ct = default);
}

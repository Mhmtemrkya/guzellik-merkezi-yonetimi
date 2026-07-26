namespace GuzellikMerkezi.Application.Features.PublicSalons;

/// <summary>
/// Kurumun KVKK aydınlatma metni ve bu metnin PDF hâli.
/// <paramref name="Text"/> KURUMA ÖZELDİR (Ayarlar'dan düzenlenen metin); hiç düzenlenmemişse
/// yerleşik varsayılan, kurum adı yerleştirilerek döner.
/// </summary>
public sealed record KvkkContentDto(string SalonName, string Text, string? LogoData);

public interface IKvkkDocumentService
{
    /// <summary>Kurumun geçerli KVKK metni. Kurum yoksa null.</summary>
    Task<KvkkContentDto?> GetContentAsync(Guid tenantId, CancellationToken cancellationToken = default);

    /// <summary>Aynı metnin logolu PDF hâli (WhatsApp eki ve "PDF indir" için). Kurum yoksa null.</summary>
    Task<byte[]?> BuildPdfAsync(Guid tenantId, CancellationToken cancellationToken = default);

    /// <summary>Herkese açık vitrin adresinden (slug) kurum Id'sini çözer. Bulunamazsa null.</summary>
    Task<Guid?> ResolveTenantIdBySlugAsync(string slug, CancellationToken cancellationToken = default);
}

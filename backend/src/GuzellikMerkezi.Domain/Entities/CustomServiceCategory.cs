using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kurum bazlı özel hizmet kategorileri. Standart kategoriler (Lazer, Cilt Bakımı, vs.) dışında
/// kuruma özel hizmet tipleri için. Her tenant kendi kategorilerini yönetir.
/// </summary>
public sealed class CustomServiceCategory : Entity
{
    private CustomServiceCategory() { }

    public CustomServiceCategory(Guid tenantId, string name)
    {
        TenantId = tenantId;
        Rename(name);
    }

    public Guid TenantId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public bool IsActive { get; private set; } = true;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Kategori adı boş olamaz.");
        var trimmed = name.Trim();
        if (trimmed.Length > 80) throw new DomainException("Kategori adı 80 karakteri aşamaz.");
        Name = trimmed;
        Touch();
    }

    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }
}

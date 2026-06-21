using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kurum bazlı özel gider kategorileri. "Diğer" kapsamına girip belirli bir tipte tekrar tekrar
/// karşılaşılan giderleri kendi kategorisinde sayabilmek için. Her tenant kendi kategorilerini yönetir.
/// </summary>
public sealed class CustomExpenseCategory : Entity
{
    private CustomExpenseCategory() { }

    public CustomExpenseCategory(Guid tenantId, string name)
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

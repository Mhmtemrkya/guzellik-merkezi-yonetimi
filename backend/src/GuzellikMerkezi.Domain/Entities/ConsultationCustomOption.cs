using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Müşteri bilgi ve onay formundaki "Özel" bölümü için kuruma/şubeye özel checkbox seçeneği.
/// Standart sağlık bayrakları (gebelik, diyabet, vs.) dışında her kurumun/şubenin kendi
/// işaretlenebilir seçeneklerini tanımlamasını sağlar. BranchId null ise kurum geneli,
/// dolu ise yalnızca o şubeye özeldir.
/// </summary>
public sealed class ConsultationCustomOption : Entity
{
    private ConsultationCustomOption() { }

    public ConsultationCustomOption(Guid tenantId, Guid? branchId, string label, int displayOrder = 0)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Rename(label);
        DisplayOrder = displayOrder;
    }

    public Guid TenantId { get; private set; }
    /// <summary>null = kurum geneli; dolu = yalnızca bu şubeye özel.</summary>
    public Guid? BranchId { get; private set; }
    public string Label { get; private set; } = string.Empty;
    public bool IsActive { get; private set; } = true;
    public int DisplayOrder { get; private set; }

    public void Rename(string label)
    {
        if (string.IsNullOrWhiteSpace(label)) throw new DomainException("Seçenek etiketi boş olamaz.");
        var trimmed = label.Trim();
        if (trimmed.Length > 80) throw new DomainException("Seçenek etiketi 80 karakteri aşamaz.");
        Label = trimmed;
        Touch();
    }

    public void SetDisplayOrder(int order) { DisplayOrder = order; Touch(); }
    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }
}

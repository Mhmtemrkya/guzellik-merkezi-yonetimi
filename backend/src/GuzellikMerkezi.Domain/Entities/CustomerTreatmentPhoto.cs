using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Müşterinin işlem günlüğü fotoğrafı (önce/sonra/süreç). Hizmete (opsiyonel) ve çekildiği tarihe bağlanır;
/// güzellik merkezinin "görünür sonuç" akışının çekirdeği — önce/sonra karşılaştırması bu kayıtlardan üretilir.
/// </summary>
public sealed class CustomerTreatmentPhoto : Entity
{
    private CustomerTreatmentPhoto() { }

    public CustomerTreatmentPhoto(
        Guid tenantId,
        Guid? branchId,
        Guid customerId,
        Guid? serviceDefinitionId,
        TreatmentPhotoKind kind,
        string imageUrl,
        DateTime takenAtUtc,
        string? note)
    {
        if (string.IsNullOrWhiteSpace(imageUrl)) throw new DomainException("İşlem fotoğrafı boş olamaz.");
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        ServiceDefinitionId = serviceDefinitionId;
        Kind = kind;
        ImageUrl = imageUrl;
        TakenAtUtc = takenAtUtc.Kind == DateTimeKind.Utc ? takenAtUtc : DateTime.SpecifyKind(takenAtUtc, DateTimeKind.Utc);
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Guid? ServiceDefinitionId { get; private set; }
    public ServiceDefinition? ServiceDefinition { get; private set; }
    public TreatmentPhotoKind Kind { get; private set; }
    public string ImageUrl { get; private set; } = string.Empty;
    public DateTime TakenAtUtc { get; private set; }
    public string? Note { get; private set; }
}

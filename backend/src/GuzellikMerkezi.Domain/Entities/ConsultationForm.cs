using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Müşteri bilgi ve onay formu (müşteri başına tek, güncellenebilir). İşlem uygunluğu açısından önemli
/// müşteri beyanları işlem uygunluğu uyarılarını besler; serbest metinler ve onay da burada tutulur.
/// </summary>
public sealed class ConsultationForm : Entity
{
    private ConsultationForm() { }

    public ConsultationForm(Guid tenantId, Guid? branchId, Guid customerId, ConsultationDetails details)
    {
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        TakenAtUtc = DateTime.UtcNow;
        Apply(details);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid CustomerId { get; private set; }

    // Güvenlik-kritik sağlık bayrakları (her biri bir uyarı üretir)
    public bool IsPregnant { get; private set; }
    public bool IsBreastfeeding { get; private set; }
    public bool HasPacemakerOrImplant { get; private set; }
    public bool HasEpilepsy { get; private set; }
    public bool HasDiabetes { get; private set; }
    public bool HasCancerHistory { get; private set; }
    public bool UsesBloodThinners { get; private set; }
    public bool UsedIsotretinoin { get; private set; }
    public bool HasKeloidTendency { get; private set; }
    public bool HasActiveSkinIssue { get; private set; }
    public bool RecentSunExposure { get; private set; }

    public SkinType SkinType { get; private set; }

    public string? Allergies { get; private set; }
    public string? Medications { get; private set; }
    public string? ChronicConditions { get; private set; }
    public string? Complaint { get; private set; }
    public string? Notes { get; private set; }

    public bool ConsentGiven { get; private set; }
    public DateTime? ConsentAtUtc { get; private set; }
    public string? FilledByName { get; private set; }
    public DateTime TakenAtUtc { get; private set; }

    /// <summary>"Özel" bölümünde işaretlenen kuruma/şubeye özel seçenek etiketlerinin JSON dizisi (anlık görüntü).</summary>
    public string? CustomSelectionsJson { get; private set; }

    public void Apply(ConsultationDetails d)
    {
        IsPregnant = d.IsPregnant;
        IsBreastfeeding = d.IsBreastfeeding;
        HasPacemakerOrImplant = d.HasPacemakerOrImplant;
        HasEpilepsy = d.HasEpilepsy;
        HasDiabetes = d.HasDiabetes;
        HasCancerHistory = d.HasCancerHistory;
        UsesBloodThinners = d.UsesBloodThinners;
        UsedIsotretinoin = d.UsedIsotretinoin;
        HasKeloidTendency = d.HasKeloidTendency;
        HasActiveSkinIssue = d.HasActiveSkinIssue;
        RecentSunExposure = d.RecentSunExposure;
        SkinType = d.SkinType;
        Allergies = Trim(d.Allergies);
        Medications = Trim(d.Medications);
        ChronicConditions = Trim(d.ChronicConditions);
        Complaint = Trim(d.Complaint);
        Notes = Trim(d.Notes);
        FilledByName = Trim(d.FilledByName);
        CustomSelectionsJson = Trim(d.CustomSelectionsJson);
        // Onam ilk verildiği anı korur; geri çekilirse tarih sıfırlanır.
        if (d.ConsentGiven && !ConsentGiven) ConsentAtUtc = DateTime.UtcNow;
        if (!d.ConsentGiven) ConsentAtUtc = null;
        ConsentGiven = d.ConsentGiven;
    }

    private static string? Trim(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>Müşteri bilgi formu alanlarının taşıyıcısı (Application → Domain).</summary>
public sealed record ConsultationDetails(
    bool IsPregnant,
    bool IsBreastfeeding,
    bool HasPacemakerOrImplant,
    bool HasEpilepsy,
    bool HasDiabetes,
    bool HasCancerHistory,
    bool UsesBloodThinners,
    bool UsedIsotretinoin,
    bool HasKeloidTendency,
    bool HasActiveSkinIssue,
    bool RecentSunExposure,
    SkinType SkinType,
    string? Allergies,
    string? Medications,
    string? ChronicConditions,
    string? Complaint,
    string? Notes,
    bool ConsentGiven,
    string? FilledByName,
    string? CustomSelectionsJson = null);

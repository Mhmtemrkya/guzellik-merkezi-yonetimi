using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Consultations;

public sealed record ConsultationFormDto(
    Guid Id,
    Guid CustomerId,
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
    DateTime? ConsentAtUtc,
    string? FilledByName,
    DateTime TakenAtUtc,
    DateTime? UpdatedAtUtc,
    IReadOnlyList<string> CustomSelections);

public sealed record UpsertConsultationRequest(
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
    IReadOnlyList<string>? CustomSelections = null);

/// <summary>"Özel" bölümünde kullanılan, kuruma/şubeye özel işaretlenebilir seçenek tanımı.</summary>
public sealed record ConsultationOptionDto(Guid Id, string Label, Guid? BranchId, bool IsActive, int DisplayOrder);

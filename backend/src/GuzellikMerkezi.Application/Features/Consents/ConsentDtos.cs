using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Consents;

// ---------------------------------------------------------------------------
// Şablon (kurumun yazdığı onam formu metni)
// ---------------------------------------------------------------------------

public sealed record ConsentTemplateDto(
    Guid Id,
    string Title,
    string Body,
    IReadOnlyList<string> CheckItems,
    bool RequiresSignature,
    bool IsActive,
    int SortOrder,
    // Bu formun zorunlu olduğu hizmetler.
    IReadOnlyList<Guid> ServiceIds,
    IReadOnlyList<string> ServiceNames,
    // Bu formun zorunlu olduğu paketler — paketi SATIN ALAN müşteride gerekli olur.
    IReadOnlyList<Guid> PackageIds,
    IReadOnlyList<string> PackageNames);

public sealed record UpsertConsentTemplateRequest(
    string Title,
    string Body,
    IReadOnlyList<string>? CheckItems,
    bool RequiresSignature,
    bool IsActive,
    IReadOnlyList<Guid>? ServiceIds,
    IReadOnlyList<Guid>? PackageIds = null);

// ---------------------------------------------------------------------------
// Müşteri kaydı (şablonun o müşteri/işlem için alınmış kopyası)
// ---------------------------------------------------------------------------

public sealed record ConsentFormDto(
    Guid Id,
    Guid CustomerId,
    string? CustomerName,
    Guid? AppointmentId,
    Guid? TemplateId,
    string Title,
    string Body,
    IReadOnlyList<string> CheckItems,
    IReadOnlyList<string> CheckedItems,
    bool RequiresSignature,
    ConsentFormStatus Status,
    // Aktif imza oturumu anahtarı (yalnız AwaitingSignature iken dolu; imzadan sonra silinir).
    // Tablet bu token ile imzalar; uçlar zaten kurum kimliği ister.
    Guid? SessionToken,
    Guid? ServiceDefinitionId,
    string? ServiceName,
    string? StaffName,
    string? StaffNotes,
    string? SignatureImage,
    DateTime? SignedAtUtc,
    string? SignerName,
    string? StationName,
    DateTime? SessionExpiresAtUtc,
    DateTime CreatedAtUtc);

public sealed record CreateConsentFormRequest(
    Guid CustomerId,
    Guid TemplateId,
    Guid? AppointmentId,
    Guid? ServiceDefinitionId,
    string? StaffNotes,
    // Gereksinim bir PAKETTEN geliyorsa paket kimliği — belgeye işlem adı olarak paket adı basılır.
    Guid? ServicePackageId = null);

public sealed record UpdateConsentFormRequest(string? StaffNotes);

/// <summary>"Tablete Aktar" — tek kullanımlık imza oturumu açar.</summary>
public sealed record StartConsentSessionRequest(string? StationName, int? LifetimeMinutes);

public sealed record SignConsentFormRequest(
    IReadOnlyList<string>? CheckedItems,
    string? SignatureImage,
    string? SignerName);

// ---------------------------------------------------------------------------
// Durum (randevu tamamlama kapısı + müşteri/cari/adisyon uyarısı)
// ---------------------------------------------------------------------------

public sealed record ConsentRequirementDto(
    Guid TemplateId,
    string Title,
    bool RequiresSignature,
    // Bu şablon için müşteride var olan en güncel kayıt (yoksa null).
    Guid? FormId,
    ConsentFormStatus? Status,
    DateTime? SignedAtUtc,
    Guid? ServiceDefinitionId,
    string? ServiceName,
    // Gereksinim paketten geliyorsa paket kimliği/adı (hizmetten geliyorsa null).
    Guid? ServicePackageId = null,
    string? PackageName = null);

public sealed record ConsentStatusDto(
    bool Complete,
    int RequiredCount,
    int SignedCount,
    IReadOnlyList<ConsentRequirementDto> Requirements)
{
    public IReadOnlyList<ConsentRequirementDto> Missing =>
        Requirements.Where(r => r.Status != ConsentFormStatus.Signed).ToList();
}

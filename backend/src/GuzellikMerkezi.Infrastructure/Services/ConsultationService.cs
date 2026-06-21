using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Consultations;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class ConsultationService : IConsultationService
{
    private const int MaxCustomSelections = 40;
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IFeatureService _features;

    public ConsultationService(GuzellikDbContext db, IAuditLogger audit, IFeatureService features)
    {
        _db = db;
        _audit = audit;
        _features = features;
    }

    public async Task<Result<ConsultationFormDto?>> GetAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var form = await _db.ConsultationForms.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.CustomerId == customerId, cancellationToken);
        return Result<ConsultationFormDto?>.Success(form is null ? null : Map(form));
    }

    public async Task<Result<ConsultationFormDto>> UpsertAsync(Guid tenantId, Guid customerId, UpsertConsultationRequest r, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.ClinicalConsultation, cancellationToken))
            return Result<ConsultationFormDto>.Failure(Error.Conflict("Müşteri bilgi ve onay formu paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == customerId, cancellationToken);
        if (customer is null) return Result<ConsultationFormDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        var selections = NormalizeSelections(r.CustomSelections);
        var selectionsJson = selections.Count == 0 ? null : JsonSerializer.Serialize(selections);

        var details = new ConsultationDetails(
            r.IsPregnant, r.IsBreastfeeding, r.HasPacemakerOrImplant, r.HasEpilepsy, r.HasDiabetes,
            r.HasCancerHistory, r.UsesBloodThinners, r.UsedIsotretinoin, r.HasKeloidTendency,
            r.HasActiveSkinIssue, r.RecentSunExposure, r.SkinType, r.Allergies, r.Medications,
            r.ChronicConditions, r.Complaint, r.Notes, r.ConsentGiven, r.FilledByName, selectionsJson);

        var form = await _db.ConsultationForms.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.CustomerId == customerId, cancellationToken);
        var created = form is null;
        if (form is null)
        {
            form = new ConsultationForm(tenantId, customer.BranchId, customerId, details);
            _db.ConsultationForms.Add(form);
        }
        else
        {
            form.Apply(details);
        }

        // İşaretlenen özel seçenekleri kütüphaneye ekle (aynı istekte → personel onay akışıyla tutarlı).
        // Böylece bir kez girilen özel seçenek o kurum/şubede tekrar checkbox olarak çıkar.
        await EnsureOptionsExistAsync(tenantId, customer.BranchId, selections, cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, created ? "Create" : "Update", "ConsultationForm", form.Id,
            created ? "Müşteri bilgi ve onay formu oluşturuldu" : "Müşteri bilgi ve onay formu güncellendi",
            new { form.CustomerId }, cancellationToken);
        return Result<ConsultationFormDto>.Success(Map(form));
    }

    public async Task<Result<IReadOnlyList<ConsultationOptionDto>>> ListOptionsAsync(Guid tenantId, Guid? branchId, CancellationToken cancellationToken = default)
    {
        var items = await _db.ConsultationCustomOptions.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsActive && (x.BranchId == null || x.BranchId == branchId))
            .OrderBy(x => x.DisplayOrder).ThenBy(x => x.Label)
            .Select(x => new ConsultationOptionDto(x.Id, x.Label, x.BranchId, x.IsActive, x.DisplayOrder))
            .ToListAsync(cancellationToken);
        return Result<IReadOnlyList<ConsultationOptionDto>>.Success(items);
    }

    public async Task<Result> DeleteOptionAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var option = await _db.ConsultationCustomOptions.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (option is null) return Result.Failure(Error.NotFound("Özel seçenek bulunamadı."));
        option.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    /// <summary>
    /// Verilen etiketleri kuruma/şubeye özel seçenek kütüphanesinde garanti eder. Kurum geneli (BranchId=null)
    /// ya da bu şube için zaten varsa tekrar eklemez; yoksa müşterinin şubesine özel olarak ekler.
    /// </summary>
    private async Task EnsureOptionsExistAsync(Guid tenantId, Guid? branchId, IReadOnlyList<string> labels, CancellationToken ct)
    {
        if (labels.Count == 0) return;

        // Özel alan OLUŞTURMA ayrı bir paket özelliği: kapalıysa yeni kütüphane seçeneği eklenmez
        // (mevcut seçenekler kullanılmaya devam eder; form seçimleri yine kaydedilir).
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.ClinicalCustomFields, ct)) return;

        var existing = await _db.ConsultationCustomOptions
            .Where(x => x.TenantId == tenantId && (x.BranchId == null || x.BranchId == branchId))
            .Select(x => x.Label)
            .ToListAsync(ct);
        var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

        var order = await _db.ConsultationCustomOptions
            .Where(x => x.TenantId == tenantId && (x.BranchId == null || x.BranchId == branchId))
            .Select(x => (int?)x.DisplayOrder)
            .MaxAsync(ct) ?? 0;

        foreach (var label in labels)
        {
            if (existingSet.Contains(label)) continue;
            existingSet.Add(label);
            _db.ConsultationCustomOptions.Add(new ConsultationCustomOption(tenantId, branchId, label, ++order));
        }
    }

    /// <summary>Özel seçenek etiketlerini temizler: trim, boşları at, büyük/küçük harf duyarsız tekilleştir, 80 karakter ve adet sınırı uygula.</summary>
    private static List<string> NormalizeSelections(IReadOnlyList<string>? raw)
    {
        var result = new List<string>();
        if (raw is null) return result;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in raw)
        {
            if (string.IsNullOrWhiteSpace(item)) continue;
            var trimmed = item.Trim();
            if (trimmed.Length > 80) trimmed = trimmed[..80];
            if (seen.Add(trimmed)) result.Add(trimmed);
            if (result.Count >= MaxCustomSelections) break;
        }
        return result;
    }

    private static IReadOnlyList<string> ParseSelections(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static ConsultationFormDto Map(ConsultationForm f) => new(
        f.Id, f.CustomerId, f.IsPregnant, f.IsBreastfeeding, f.HasPacemakerOrImplant, f.HasEpilepsy,
        f.HasDiabetes, f.HasCancerHistory, f.UsesBloodThinners, f.UsedIsotretinoin, f.HasKeloidTendency,
        f.HasActiveSkinIssue, f.RecentSunExposure, f.SkinType, f.Allergies, f.Medications, f.ChronicConditions,
        f.Complaint, f.Notes, f.ConsentGiven, f.ConsentAtUtc, f.FilledByName, f.TakenAtUtc, f.UpdatedAtUtc,
        ParseSelections(f.CustomSelectionsJson));
}

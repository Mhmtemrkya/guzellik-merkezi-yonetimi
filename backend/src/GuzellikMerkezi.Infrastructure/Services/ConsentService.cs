using System.Text.Json;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Consents;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Onam formu akışı. Şablon → hizmet bağı → müşteri kaydı → tablet imza oturumu → imzalı belge.
///
/// TASARIM NOTLARI:
///  • Şablon metni müşteri kaydına KOPYALANIR; şablon sonradan değişse bile imzalanan belge sabit kalır.
///  • İmza oturumu tek kullanımlıktır: token imzadan sonra silinir, süresi dolan oturum imzalanamaz.
///  • Tablet formu "istasyon adı" ile yoklar (ör. "Kabin 1"). Personel bilgisayardan formu o istasyona
///    gönderir, tablet saniyeler içinde formu ekrana getirir.
/// </summary>
public sealed class ConsentService : IConsentService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IFeatureService _features;

    public ConsentService(GuzellikDbContext db, IAuditLogger audit, ICurrentUser currentUser, IFeatureService features)
    {
        _db = db;
        _audit = audit;
        _currentUser = currentUser;
        _features = features;
    }

    /// <summary>Paket kapısı — YALNIZ yazma yollarında. Okuma serbesttir ki paket düşse bile
    /// imzalanmış belgeler görüntülenebilsin (hukuki kayıt kilitlenmez).</summary>
    private async Task<bool> AllowedAsync(Guid tenantId, CancellationToken ct) =>
        await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.ClinicalConsentForms, ct);

    private static Error PlanError() =>
        Error.Conflict("Onam formu özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz.");

    // =======================================================================
    // Şablonlar
    // =======================================================================

    public async Task<Result<IReadOnlyCollection<ConsentTemplateDto>>> ListTemplatesAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var templates = await _db.ConsentFormTemplates.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.Title)
            .ToListAsync(cancellationToken);

        var links = await LoadLinksAsync(tenantId, cancellationToken);
        var dtos = templates.Select(t => ToTemplateDto(t, links.Where(l => l.TemplateId == t.Id).ToList())).ToList();

        return Result<IReadOnlyCollection<ConsentTemplateDto>>.Success(dtos);
    }

    public async Task<Result<ConsentTemplateDto>> CreateTemplateAsync(Guid tenantId, UpsertConsentTemplateRequest request, CancellationToken cancellationToken = default)
    {
        if (!await AllowedAsync(tenantId, cancellationToken)) return Result<ConsentTemplateDto>.Failure(PlanError());
        if (string.IsNullOrWhiteSpace(request.Title)) return Result<ConsentTemplateDto>.Failure(Error.Validation("Form başlığı zorunlu."));
        if (string.IsNullOrWhiteSpace(request.Body)) return Result<ConsentTemplateDto>.Failure(Error.Validation("Form metni zorunlu."));

        var nextOrder = await _db.ConsentFormTemplates.Where(x => x.TenantId == tenantId)
            .Select(x => (int?)x.SortOrder).MaxAsync(cancellationToken) ?? -1;

        var template = new ConsentFormTemplate(tenantId, request.Title, request.Body, Serialize(request.CheckItems), request.RequiresSignature);
        template.SetSortOrder(nextOrder + 1);
        if (!request.IsActive) template.SetActive(false);
        _db.ConsentFormTemplates.Add(template);
        await _db.SaveChangesAsync(cancellationToken);

        await ReplaceLinksAsync(tenantId, template.Id, request.ServiceIds, request.PackageIds, cancellationToken);
        await _audit.LogAsync(tenantId, null, "Create", "ConsentFormTemplate", template.Id,
            $"Onam formu şablonu eklendi: {template.Title}", new { template.Title }, cancellationToken);

        return await GetTemplateDtoAsync(tenantId, template.Id, cancellationToken);
    }

    public async Task<Result<ConsentTemplateDto>> UpdateTemplateAsync(Guid tenantId, Guid id, UpsertConsentTemplateRequest request, CancellationToken cancellationToken = default)
    {
        var template = await _db.ConsentFormTemplates.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (template is null) return Result<ConsentTemplateDto>.Failure(Error.NotFound("Onam formu bulunamadı."));

        template.Update(request.Title, request.Body, Serialize(request.CheckItems), request.RequiresSignature);
        template.SetActive(request.IsActive);
        await _db.SaveChangesAsync(cancellationToken);

        await ReplaceLinksAsync(tenantId, template.Id, request.ServiceIds, request.PackageIds, cancellationToken);
        await _audit.LogAsync(tenantId, null, "Update", "ConsentFormTemplate", template.Id,
            $"Onam formu şablonu güncellendi: {template.Title}", new { template.Title }, cancellationToken);

        return await GetTemplateDtoAsync(tenantId, template.Id, cancellationToken);
    }

    public async Task<Result> DeleteTemplateAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var template = await _db.ConsentFormTemplates.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (template is null) return Result.Failure(Error.NotFound("Onam formu bulunamadı."));

        // İmzalı kayıtlar SİLİNMEZ (hukuki belge); yalnız şablon ve hizmet bağları kalkar.
        var links = await _db.ServiceConsentForms.Where(x => x.TenantId == tenantId && x.ConsentFormTemplateId == id).ToListAsync(cancellationToken);
        foreach (var link in links) link.SoftDelete();
        template.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);

        await _audit.LogAsync(tenantId, null, "Delete", "ConsentFormTemplate", id,
            $"Onam formu şablonu silindi: {template.Title}", new { template.Title }, cancellationToken);
        return Result.Success();
    }

    // =======================================================================
    // Müşteri kayıtları
    // =======================================================================

    public async Task<Result<IReadOnlyCollection<ConsentFormDto>>> ListCustomerFormsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var rows = await _db.CustomerConsentForms.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.CustomerId == customerId && x.Status != ConsentFormStatus.Cancelled)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        return Result<IReadOnlyCollection<ConsentFormDto>>.Success(rows.Select(ToFormDto).ToList());
    }

    public async Task<Result<ConsentFormDto>> GetFormAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return form is null
            ? Result<ConsentFormDto>.Failure(Error.NotFound("Onam formu kaydı bulunamadı."))
            : Result<ConsentFormDto>.Success(ToFormDto(form));
    }

    public async Task<Result<ConsentFormDto>> CreateFormAsync(Guid tenantId, CreateConsentFormRequest request, CancellationToken cancellationToken = default)
    {
        if (!await AllowedAsync(tenantId, cancellationToken)) return Result<ConsentFormDto>.Failure(PlanError());
        var template = await _db.ConsentFormTemplates.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == request.TemplateId, cancellationToken);
        if (template is null) return Result<ConsentFormDto>.Failure(Error.NotFound("Onam formu şablonu bulunamadı."));

        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == request.CustomerId, cancellationToken);
        if (customer is null) return Result<ConsentFormDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        // Aynı müşteri + şablon için bekleyen/taslak kayıt varsa yenisini açmayız — mükerrer form olmaz.
        var existing = await _db.CustomerConsentForms
            .Where(x => x.TenantId == tenantId && x.CustomerId == request.CustomerId
                && x.ConsentFormTemplateId == request.TemplateId
                && (x.Status == ConsentFormStatus.Draft || x.Status == ConsentFormStatus.AwaitingSignature))
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            existing.UpdateDraft(request.StaffNotes ?? existing.StaffNotes, await ResolveStaffIdAsync(tenantId, cancellationToken), await ResolveStaffNameAsync(tenantId, cancellationToken));
            await _db.SaveChangesAsync(cancellationToken);
            return Result<ConsentFormDto>.Success(ToFormDto(existing));
        }

        Guid? serviceId = request.ServiceDefinitionId;
        string? serviceName = null;
        Guid? appointmentId = request.AppointmentId;

        // Gereksinim paketten geliyorsa belgeye "işlem" olarak PAKET adı basılır ({{hizmet}} bunu kullanır).
        if (request.ServicePackageId is { } packageId)
        {
            serviceName = await _db.ServicePackages.AsNoTracking()
                .Where(p => p.TenantId == tenantId && p.Id == packageId)
                .Select(p => p.Name)
                .FirstOrDefaultAsync(cancellationToken);
        }
        if (appointmentId.HasValue)
        {
            var appointment = await _db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.Id == appointmentId.Value)
                .Select(a => new { a.ServiceDefinitionId })
                .FirstOrDefaultAsync(cancellationToken);
            if (appointment is not null) serviceId ??= appointment.ServiceDefinitionId;
        }
        if (serviceName is null && serviceId.HasValue)
        {
            serviceName = await _db.ServiceDefinitions.AsNoTracking()
                .Where(s => s.Id == serviceId.Value).Select(s => s.Name).FirstOrDefaultAsync(cancellationToken);
        }

        var staffId = await ResolveStaffIdAsync(tenantId, cancellationToken);
        var staffName = await ResolveStaffNameAsync(tenantId, cancellationToken);
        var institutionName = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(cancellationToken);

        // Yer tutucular SUNUCUDA doldurulur: müşteri kaydı belgenin KOPYASIDIR, kopya
        // eksiksiz olmalı. İstemcilere bırakılırsa (tablet, PDF, önizleme) her yüzeyin ayrı ayrı
        // kurum/hizmet bilgisini taşıması gerekir; bir yerde unutulunca müşteri
        // "..................... bünyesinde" yazan bir belge imzalar.
        var body = FillPlaceholders(template.Body, customer.FullName, serviceName, institutionName, staffName, DateTime.UtcNow);

        var form = new CustomerConsentForm(
            tenantId, customer.BranchId, customer.Id, appointmentId, template.Id,
            template.Title, body, template.CheckItemsJson, template.RequiresSignature,
            customer.FullName, serviceId, serviceName,
            staffId, staffName,
            request.StaffNotes);

        _db.CustomerConsentForms.Add(form);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Create", "CustomerConsentForm", form.Id,
            $"Onam formu açıldı: {form.Title}", new { form.CustomerId, form.Title }, cancellationToken);
        return Result<ConsentFormDto>.Success(ToFormDto(form));
    }

    public async Task<Result<ConsentFormDto>> UpdateFormAsync(Guid tenantId, Guid id, UpdateConsentFormRequest request, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (form is null) return Result<ConsentFormDto>.Failure(Error.NotFound("Onam formu kaydı bulunamadı."));
        if (form.IsSigned) return Result<ConsentFormDto>.Failure(Error.Conflict("İmzalanmış form değiştirilemez."));

        form.UpdateDraft(request.StaffNotes, await ResolveStaffIdAsync(tenantId, cancellationToken), await ResolveStaffNameAsync(tenantId, cancellationToken));
        await _db.SaveChangesAsync(cancellationToken);
        return Result<ConsentFormDto>.Success(ToFormDto(form));
    }

    public async Task<Result> CancelFormAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (form is null) return Result.Failure(Error.NotFound("Onam formu kaydı bulunamadı."));
        if (form.IsSigned) return Result.Failure(Error.Conflict("İmzalanmış form iptal edilemez."));
        form.Cancel();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    // =======================================================================
    // İmza oturumu (tablet)
    // =======================================================================

    public async Task<Result<ConsentFormDto>> StartSessionAsync(Guid tenantId, Guid id, StartConsentSessionRequest request, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (form is null) return Result<ConsentFormDto>.Failure(Error.NotFound("Onam formu kaydı bulunamadı."));
        if (form.IsSigned) return Result<ConsentFormDto>.Failure(Error.Conflict("Bu form zaten imzalanmış."));

        // Aynı tablete daha önce gönderilmiş bekleyen formlar taslağa çekilir; tablette
        // sıraya girmiş eski bir form yanlışlıkla imzalanmasın.
        var station = (request.StationName ?? string.Empty).Trim();
        if (station.Length > 0)
        {
            var stale = await _db.CustomerConsentForms
                .Where(x => x.TenantId == tenantId && x.Id != form.Id
                    && x.Status == ConsentFormStatus.AwaitingSignature && x.StationName == station)
                .ToListAsync(cancellationToken);
            foreach (var other in stale) other.CancelSession();
        }

        var lifetime = request.LifetimeMinutes is > 0 and <= 240 ? request.LifetimeMinutes!.Value : CustomerConsentForm.SessionLifetimeMinutes;
        form.StartSession(station, DateTime.UtcNow, lifetime);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, form.BranchId, "Update", "CustomerConsentForm", form.Id,
            $"Onam formu imzaya gönderildi ({(station.Length > 0 ? station : "tablet")}): {form.Title}",
            new { form.CustomerId, form.Title, Station = station }, cancellationToken);
        return Result<ConsentFormDto>.Success(ToFormDto(form));
    }

    public async Task<Result> CancelSessionAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (form is null) return Result.Failure(Error.NotFound("Onam formu kaydı bulunamadı."));
        form.CancelSession();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<ConsentFormDto?>> GetPendingForStationAsync(Guid tenantId, string? stationName, CancellationToken cancellationToken = default)
    {
        var station = (stationName ?? string.Empty).Trim();
        var now = DateTime.UtcNow;
        var query = _db.CustomerConsentForms.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Status == ConsentFormStatus.AwaitingSignature && x.SessionExpiresAtUtc != null && x.SessionExpiresAtUtc > now);
        // İstasyon adı verilmişse yalnız o tablete gönderilenler; verilmemişse ilk bekleyen.
        if (station.Length > 0) query = query.Where(x => x.StationName == station);

        var form = await query.OrderByDescending(x => x.UpdatedAtUtc ?? x.CreatedAtUtc).FirstOrDefaultAsync(cancellationToken);
        return Result<ConsentFormDto?>.Success(form is null ? null : ToFormDto(form));
    }

    public async Task<Result<ConsentFormDto>> GetBySessionAsync(Guid tenantId, Guid sessionToken, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.SessionToken == sessionToken, cancellationToken);
        if (form is null) return Result<ConsentFormDto>.Failure(Error.NotFound("İmza oturumu bulunamadı ya da süresi doldu."));
        if (!form.IsSessionValid(DateTime.UtcNow)) return Result<ConsentFormDto>.Failure(Error.Conflict("İmza oturumunun süresi doldu."));
        return Result<ConsentFormDto>.Success(ToFormDto(form));
    }

    public async Task<Result<ConsentFormDto>> SignAsync(Guid tenantId, Guid sessionToken, SignConsentFormRequest request, CancellationToken cancellationToken = default)
    {
        var form = await _db.CustomerConsentForms.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.SessionToken == sessionToken, cancellationToken);
        if (form is null) return Result<ConsentFormDto>.Failure(Error.NotFound("İmza oturumu bulunamadı ya da kullanılmış."));

        // Zorunlu onay maddelerinin TAMAMI işaretlenmeden imza kabul edilmez.
        var required = Deserialize(form.CheckItemsJson);
        var checkedItems = (request.CheckedItems ?? Array.Empty<string>()).Select(x => x.Trim()).ToList();
        var missing = required.Where(r => !checkedItems.Contains(r, StringComparer.OrdinalIgnoreCase)).ToList();
        if (missing.Count > 0)
            return Result<ConsentFormDto>.Failure(Error.Validation($"Onay maddelerinin tamamı işaretlenmeli. Eksik: {string.Join(", ", missing)}"));

        try
        {
            form.Sign(Serialize(checkedItems), request.SignatureImage, request.SignerName, _currentUser.DeviceInfoJson ?? _currentUser.DeviceId, _currentUser.IpAddress, DateTime.UtcNow);
        }
        catch (Exception ex)
        {
            return Result<ConsentFormDto>.Failure(Error.Conflict(ex.Message));
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, form.BranchId, "Update", "CustomerConsentForm", form.Id,
            $"Onam formu imzalandı: {form.Title}", new { form.CustomerId, form.Title, form.SignedAtUtc }, cancellationToken);
        return Result<ConsentFormDto>.Success(ToFormDto(form));
    }

    // =======================================================================
    // Durum / uyarılar
    // =======================================================================

    public async Task<Result<ConsentStatusDto>> GetAppointmentStatusAsync(Guid tenantId, Guid appointmentId, CancellationToken cancellationToken = default)
    {
        var appointment = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Id == appointmentId)
            .Select(a => new { a.Id, a.CustomerId, a.ServiceDefinitionId })
            .FirstOrDefaultAsync(cancellationToken);
        if (appointment is null) return Result<ConsentStatusDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        // Randevunun hizmeti + müşterinin SATIN ALDIĞI paketler. Paket formları, o paketi alan
        // müşterinin her işleminde geçerlidir; randevu ekranında da görünmesi istenir.
        var packageIds = await OwnedPackageIdsAsync(tenantId, appointment.CustomerId, cancellationToken);
        var status = await BuildStatusAsync(tenantId, appointment.CustomerId, new[] { appointment.ServiceDefinitionId }, packageIds, cancellationToken);
        return Result<ConsentStatusDto>.Success(status);
    }

    public async Task<Result<ConsentStatusDto>> GetCustomerStatusAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        // Gereksinimi doğuran kalemler:
        //  • randevulardaki hizmetler (iptaller hariç),
        //  • satın alınan paketlerden gelen seans hizmetleri,
        //  • satın alınan paketlerin kendisi.
        var serviceIds = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CustomerId == customerId
                && a.Status != AppointmentStatus.Cancelled)
            .Select(a => a.ServiceDefinitionId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var sessionServiceIds = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.CustomerId == customerId)
            .Select(s => s.ServiceDefinitionId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var packageIds = await OwnedPackageIdsAsync(tenantId, customerId, cancellationToken);
        var status = await BuildStatusAsync(tenantId, customerId, serviceIds.Concat(sessionServiceIds).Distinct().ToList(), packageIds, cancellationToken);
        return Result<ConsentStatusDto>.Success(status);
    }

    /// <summary>
    /// Verilen hizmet ve paketlerin onam şablonlarını, müşterideki karşılıklarıyla eşler.
    /// Aynı şablon hem bir hizmete hem bir pakete bağlıysa TEK gereksinim olarak sayılır
    /// (müşteri aynı formu iki kez imzalamaz).
    /// </summary>
    private async Task<ConsentStatusDto> BuildStatusAsync(
        Guid tenantId, Guid customerId,
        IReadOnlyCollection<Guid> serviceIds, IReadOnlyCollection<Guid> packageIds,
        CancellationToken cancellationToken)
    {
        if (serviceIds.Count == 0 && packageIds.Count == 0)
            return new ConsentStatusDto(true, 0, 0, Array.Empty<ConsentRequirementDto>());

        var allLinks = await LoadLinksAsync(tenantId, cancellationToken);
        var links = allLinks
            .Where(l => (l.ServiceId.HasValue && serviceIds.Contains(l.ServiceId.Value))
                     || (l.PackageId.HasValue && packageIds.Contains(l.PackageId.Value)))
            .ToList();
        if (links.Count == 0)
            return new ConsentStatusDto(true, 0, 0, Array.Empty<ConsentRequirementDto>());

        var templateIds = links.Select(l => l.TemplateId).Distinct().ToList();
        var templates = (await _db.ConsentFormTemplates.AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.IsActive)
            .ToListAsync(cancellationToken))
            .Where(t => templateIds.Contains(t.Id))
            .ToList();

        var forms = await _db.CustomerConsentForms.AsNoTracking()
            .Where(f => f.TenantId == tenantId && f.CustomerId == customerId && f.Status != ConsentFormStatus.Cancelled)
            .Select(f => new { f.Id, f.ConsentFormTemplateId, f.Status, f.SignedAtUtc, f.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        var requirements = new List<ConsentRequirementDto>();
        foreach (var template in templates.OrderBy(t => t.SortOrder).ThenBy(t => t.Title))
        {
            var mine = links.Where(l => l.TemplateId == template.Id).ToList();
            // Kaynağı göster: önce hizmet bağı, yoksa paket bağı.
            var serviceLink = mine.FirstOrDefault(l => l.ServiceId.HasValue);
            var packageLink = mine.FirstOrDefault(l => l.PackageId.HasValue);

            // İmzalı kayıt varsa o kazanır; yoksa en güncel taslak/bekleyen kayıt gösterilir.
            var match = forms.Where(f => f.ConsentFormTemplateId == template.Id)
                .OrderByDescending(f => f.Status == ConsentFormStatus.Signed)
                .ThenByDescending(f => f.SignedAtUtc ?? f.CreatedAtUtc)
                .FirstOrDefault();

            requirements.Add(new ConsentRequirementDto(
                template.Id, template.Title, template.RequiresSignature,
                match?.Id, match?.Status, match?.SignedAtUtc,
                serviceLink?.ServiceId, serviceLink?.Name,
                packageLink?.PackageId, packageLink?.Name));
        }

        var signed = requirements.Count(r => r.Status == ConsentFormStatus.Signed);
        return new ConsentStatusDto(signed == requirements.Count, requirements.Count, signed, requirements);
    }

    /// <summary>Müşterinin SATIN ALDIĞI (iptal edilmemiş) paketler — cari satışlar + seans bakiyeleri.</summary>
    private async Task<IReadOnlyCollection<Guid>> OwnedPackageIdsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        // İptal edilen satış onam gereksinimi doğurmaz.
        var fromAccounts = await _db.CustomerAccounts.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CustomerId == customerId
                && a.CancelledAtUtc == null && a.ServicePackageId != null)
            .Select(a => a.ServicePackageId!.Value)
            .ToListAsync(cancellationToken);

        var fromSessions = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.CustomerId == customerId)
            .Select(s => s.ServicePackageId)
            .ToListAsync(cancellationToken);

        return fromAccounts.Concat(fromSessions).Distinct().ToList();
    }

    private sealed record ConsentLink(Guid TemplateId, Guid? ServiceId, Guid? PackageId, string? Name);

    /// <summary>Tüm hizmet/paket bağlarını adlarıyla birlikte okur (MySQL'de Guid listesi .Contains() çevrilemediği için bellekte süzülür).</summary>
    private async Task<List<ConsentLink>> LoadLinksAsync(Guid tenantId, CancellationToken cancellationToken) =>
        await _db.ServiceConsentForms.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Select(x => new ConsentLink(
                x.ConsentFormTemplateId,
                x.ServiceDefinitionId,
                x.ServicePackageId,
                x.ServiceDefinitionId != null
                    ? (x.ServiceDefinition != null ? x.ServiceDefinition.Name : null)
                    : (x.ServicePackage != null ? x.ServicePackage.Name : null)))
            .ToListAsync(cancellationToken);

    // =======================================================================
    // Yardımcılar
    // =======================================================================

    /// <summary>Şablonun hizmet ve paket bağlarını istenen listeyle eşitler (fazlalar soft-delete, eksikler eklenir).</summary>
    private async Task ReplaceLinksAsync(Guid tenantId, Guid templateId,
        IReadOnlyList<Guid>? serviceIds, IReadOnlyList<Guid>? packageIds, CancellationToken cancellationToken)
    {
        var wantedServices = (serviceIds ?? Array.Empty<Guid>()).Distinct().ToList();
        var wantedPackages = (packageIds ?? Array.Empty<Guid>()).Distinct().ToList();
        var current = await _db.ServiceConsentForms
            .Where(x => x.TenantId == tenantId && x.ConsentFormTemplateId == templateId)
            .ToListAsync(cancellationToken);

        foreach (var link in current)
        {
            var keep = link.ServiceDefinitionId.HasValue
                ? wantedServices.Contains(link.ServiceDefinitionId.Value)
                : link.ServicePackageId.HasValue && wantedPackages.Contains(link.ServicePackageId.Value);
            if (!keep) link.SoftDelete();
        }

        var liveServices = current.Where(l => !l.IsDeleted && l.ServiceDefinitionId.HasValue).Select(l => l.ServiceDefinitionId!.Value).ToHashSet();
        var livePackages = current.Where(l => !l.IsDeleted && l.ServicePackageId.HasValue).Select(l => l.ServicePackageId!.Value).ToHashSet();

        foreach (var serviceId in wantedServices.Where(id => !liveServices.Contains(id)))
            _db.ServiceConsentForms.Add(ServiceConsentForm.ForService(tenantId, serviceId, templateId));
        foreach (var packageId in wantedPackages.Where(id => !livePackages.Contains(id)))
            _db.ServiceConsentForms.Add(ServiceConsentForm.ForPackage(tenantId, packageId, templateId));

        await _db.SaveChangesAsync(cancellationToken);
    }

    private async Task<Result<ConsentTemplateDto>> GetTemplateDtoAsync(Guid tenantId, Guid id, CancellationToken cancellationToken)
    {
        var template = await _db.ConsentFormTemplates.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (template is null) return Result<ConsentTemplateDto>.Failure(Error.NotFound("Onam formu bulunamadı."));
        var links = (await LoadLinksAsync(tenantId, cancellationToken)).Where(l => l.TemplateId == id).ToList();
        return Result<ConsentTemplateDto>.Success(ToTemplateDto(template, links));
    }

    /// <summary>Oturumdaki kullanıcıya bağlı personel kaydı (varsa) — forma "kim doldurdu" bilgisi için.</summary>
    private async Task<Guid?> ResolveStaffIdAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId) return null;
        return await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.TenantUserId == userId)
            .Select(s => (Guid?)s.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Belgeye basılacak "uygulayan" adı: personel kaydı → kullanıcı adı soyadı.
    /// E-POSTA KULLANILMAZ — hukuki belgeye giriş adresi basmak hem çirkin hem gereksiz
    /// bilgi ifşasıdır; ad bulunamazsa alan hiç yazılmaz.
    /// </summary>
    private async Task<string?> ResolveStaffNameAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId) return null;
        var staffName = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.TenantUserId == userId)
            .Select(s => s.FullName)
            .FirstOrDefaultAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(staffName)) return staffName;

        // Kurum sahibi / şube müdürünün personel kaydı olmayabilir → kullanıcı adı.
        var userName = await _db.TenantUsers.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.FullName)
            .FirstOrDefaultAsync(cancellationToken);
        return string.IsNullOrWhiteSpace(userName) ? null : userName;
    }

    /// <summary>
    /// Şablon metnindeki yer tutucuları gerçek değerlerle değiştirir:
    /// {{musteri}} {{hizmet}} {{kurum}} {{personel}} {{tarih}}
    /// Karşılığı olmayan alan noktalı boşluk olarak kalır (elle doldurulabilsin).
    /// </summary>
    private static string FillPlaceholders(string body, string? customerName, string? serviceName,
        string? institutionName, string? staffName, DateTime nowUtc)
    {
        const string Blank = ".....................";
        var local = nowUtc.Kind == DateTimeKind.Utc ? nowUtc.ToLocalTime() : nowUtc;
        return Regex.Replace(body ?? string.Empty, @"\{\{\s*(musteri|hizmet|kurum|personel|tarih)\s*\}\}", match =>
        {
            var value = match.Groups[1].Value.ToLowerInvariant() switch
            {
                "musteri" => customerName,
                "hizmet" => serviceName,
                "kurum" => institutionName,
                "personel" => staffName,
                "tarih" => local.ToString("dd.MM.yyyy"),
                _ => null,
            };
            return string.IsNullOrWhiteSpace(value) ? Blank : value;
        }, RegexOptions.IgnoreCase);
    }

    private static ConsentTemplateDto ToTemplateDto(ConsentFormTemplate t, IReadOnlyList<ConsentLink> links)
    {
        var services = links.Where(l => l.ServiceId.HasValue).ToList();
        var packages = links.Where(l => l.PackageId.HasValue).ToList();
        return new ConsentTemplateDto(
            t.Id, t.Title, t.Body, Deserialize(t.CheckItemsJson), t.RequiresSignature, t.IsActive, t.SortOrder,
            services.Select(l => l.ServiceId!.Value).ToList(), services.Select(l => l.Name ?? "—").ToList(),
            packages.Select(l => l.PackageId!.Value).ToList(), packages.Select(l => l.Name ?? "—").ToList());
    }

    private static ConsentFormDto ToFormDto(CustomerConsentForm f) =>
        new(f.Id, f.CustomerId, f.CustomerName, f.AppointmentId, f.ConsentFormTemplateId,
            f.Title, f.Body, Deserialize(f.CheckItemsJson), Deserialize(f.CheckedItemsJson),
            f.RequiresSignature, f.Status, f.SessionToken, f.ServiceDefinitionId, f.ServiceName,
            f.StaffName, f.StaffNotes, f.SignatureImage, f.SignedAtUtc, f.SignerName,
            f.StationName, f.SessionExpiresAtUtc, f.CreatedAtUtc);

    private static string? Serialize(IReadOnlyList<string>? items)
    {
        var clean = (items ?? Array.Empty<string>())
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .ToList();
        return clean.Count == 0 ? null : JsonSerializer.Serialize(clean);
    }

    private static IReadOnlyList<string> Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }
}

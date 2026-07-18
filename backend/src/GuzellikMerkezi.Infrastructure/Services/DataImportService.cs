using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.DataImport;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class DataImportService : IDataImportService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;

    public DataImportService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
    }

    public async Task<Result<BulkImportResultDto>> ImportAsync(Guid tenantId, BulkImportRequest request, CancellationToken cancellationToken = default)
    {
        // Platform admin aktarımında şube bilinmez — BranchId boş gelirse kurumun ilk şubesi kullanılır.
        if (request.BranchId == Guid.Empty)
        {
            var defaultBranchId = await _db.Branches.Where(x => x.TenantId == tenantId)
                .OrderBy(x => x.CreatedAtUtc).Select(x => (Guid?)x.Id).FirstOrDefaultAsync(cancellationToken);
            if (defaultBranchId is null) return Result<BulkImportResultDto>.Failure(Error.NotFound("Kurumun şubesi bulunamadı."));
            request = request with { BranchId = defaultBranchId.Value };
        }
        else if (!await _db.Branches.AnyAsync(x => x.TenantId == tenantId && x.Id == request.BranchId, cancellationToken))
        {
            return Result<BulkImportResultDto>.Failure(Error.NotFound("Şube bulunamadı."));
        }

        var errors = new List<string>();
        int custCreated = 0, custSkipped = 0, svcCreated = 0, svcSkipped = 0, pkgCreated = 0, pkgSkipped = 0, failed = 0;

        // ---- MÜŞTERİLER --------------------------------------------------------
        if (request.Customers is { Count: > 0 })
        {
            var limit = await _usage.CheckLimitAsync(tenantId, "customers", cancellationToken);
            if (limit.IsFailure) return Result<BulkImportResultDto>.Failure(limit.Error);

            // Şifreli kolonlarda SQL karşılaştırması çalışmaz — mevcutlar belleğe alınıp
            // çözülmüş değerler üzerinden mükerrer kontrolü yapılır.
            var existing = await _db.Customers.AsNoTracking()
                .Where(x => x.TenantId == tenantId)
                .Select(x => new { x.FullName, x.Phone })
                .ToListAsync(cancellationToken);
            var seenPhones = new HashSet<string>(existing.Select(x => DigitsOf(x.Phone)).Where(p => p.Length >= 7));
            var seenNames = new HashSet<string>(existing.Select(x => NormalizeName(x.FullName)), StringComparer.Ordinal);

            foreach (var row in request.Customers)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var name = (row.FullName ?? string.Empty).Trim();
                    var phone = (row.Phone ?? string.Empty).Trim();
                    if (name.Length == 0)
                    {
                        failed++;
                        if (errors.Count < 50) errors.Add("Müşteri satırı atlandı: ad boş.");
                        continue;
                    }
                    if (phone.Length == 0)
                    {
                        failed++;
                        if (errors.Count < 50) errors.Add($"'{name}' atlandı: geçerli telefon bulunamadı.");
                        continue;
                    }

                    var digits = DigitsOf(phone);
                    var nameKey = NormalizeName(name);
                    // Mükerrer: aynı telefon ya da (telefon anlamsız kısaysa) aynı ad.
                    if (digits.Length >= 7 ? !seenPhones.Add(digits) : !seenNames.Add(nameKey))
                    {
                        custSkipped++;
                        continue;
                    }
                    if (digits.Length >= 7) seenNames.Add(nameKey);

                    var customer = new Customer(tenantId, request.BranchId, name, phone, NullIfBlank(row.Email));
                    customer.UpdateProfile(row.BirthDate, row.Gender, kvkkConsent: false, NullIfBlank(row.Notes));
                    _db.Customers.Add(customer);
                    custCreated++;

                    if (custCreated % 500 == 0) await _db.SaveChangesAsync(cancellationToken);
                }
                catch (Exception ex)
                {
                    failed++;
                    if (errors.Count < 50) errors.Add($"Müşteri satırı hatası: {ex.Message}");
                }
            }
        }

        // ---- HİZMETLER ---------------------------------------------------------
        if (request.Services is { Count: > 0 })
        {
            var existingNames = new HashSet<string>(
                (await _db.ServiceDefinitions.AsNoTracking().Where(x => x.TenantId == tenantId).Select(x => x.Name).ToListAsync(cancellationToken))
                    .Select(NormalizeName));

            foreach (var row in request.Services)
            {
                try
                {
                    var name = (row.Name ?? string.Empty).Trim();
                    if (name.Length == 0) { failed++; continue; }
                    if (!existingNames.Add(NormalizeName(name))) { svcSkipped++; continue; }

                    var service = new ServiceDefinition(tenantId, null, name,
                        row.DurationMinutes is > 0 ? row.DurationMinutes.Value : 60,
                        row.Price is >= 0 ? row.Price.Value : 0,
                        NullIfBlank(row.Category));
                    if (row.SessionCount is > 0) service.SetDefaultSessions(row.SessionCount.Value);
                    _db.ServiceDefinitions.Add(service);
                    svcCreated++;
                }
                catch (Exception ex)
                {
                    failed++;
                    if (errors.Count < 50) errors.Add($"Hizmet satırı hatası: {ex.Message}");
                }
            }
        }

        // ---- PAKETLER ----------------------------------------------------------
        if (request.Packages is { Count: > 0 })
        {
            var existingPkgNames = new HashSet<string>(
                (await _db.ServicePackages.AsNoTracking().Where(x => x.TenantId == tenantId).Select(x => x.Name).ToListAsync(cancellationToken))
                    .Select(NormalizeName));
            var serviceByName = (await _db.ServiceDefinitions.Where(x => x.TenantId == tenantId).ToListAsync(cancellationToken))
                .GroupBy(x => NormalizeName(x.Name)).ToDictionary(g => g.Key, g => g.First());

            foreach (var row in request.Packages)
            {
                try
                {
                    var name = (row.Name ?? string.Empty).Trim();
                    if (name.Length == 0) { failed++; continue; }
                    if (!existingPkgNames.Add(NormalizeName(name))) { pkgSkipped++; continue; }

                    var sessions = row.SessionCount is > 0 ? row.SessionCount.Value : 1;
                    var total = row.TotalPrice is >= 0 ? row.TotalPrice.Value : 0;

                    // Paket kalemi için aynı adlı hizmet aranır; yoksa otomatik oluşturulur.
                    if (!serviceByName.TryGetValue(NormalizeName(name), out var svc))
                    {
                        svc = new ServiceDefinition(tenantId, null, name, 60, sessions > 0 ? Math.Round(total / sessions, 2) : total, NullIfBlank(row.Category));
                        _db.ServiceDefinitions.Add(svc);
                        serviceByName[NormalizeName(name)] = svc;
                    }

                    var package = new ServicePackage(tenantId, null, name, total, 0, 0, NullIfBlank(row.Description));
                    package.SetCategory(NullIfBlank(row.Category));
                    package.ReplaceItems(new[] { (svc.Id, sessions, sessions > 0 ? Math.Round(total / sessions, 2) : total) });
                    _db.ServicePackages.Add(package);
                    pkgCreated++;
                }
                catch (Exception ex)
                {
                    failed++;
                    if (errors.Count < 50) errors.Add($"Paket satırı hatası: {ex.Message}");
                }
            }
        }

        await _db.SaveChangesAsync(cancellationToken);

        var totalCreated = custCreated + svcCreated + pkgCreated;
        await _audit.LogAsync(tenantId, request.BranchId, "Import", "DataImport", null,
            $"Excel içeri aktarma: {custCreated} müşteri, {svcCreated} hizmet, {pkgCreated} paket eklendi ({custSkipped + svcSkipped + pkgSkipped} mükerrer atlandı, {failed} hatalı).",
            new { custCreated, svcCreated, pkgCreated, custSkipped, svcSkipped, pkgSkipped, failed }, cancellationToken);

        return Result<BulkImportResultDto>.Success(new BulkImportResultDto(
            custCreated, custSkipped, svcCreated, svcSkipped, pkgCreated, pkgSkipped, failed, errors));
    }

    /// <summary>Karşılaştırma anahtarı: ülke kodu/başındaki sıfır farkı elensin diye son 10 hane.</summary>
    private static string DigitsOf(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits.TrimStart('0');
    }

    private static string NormalizeName(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant();

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.DataImport;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
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
        int custCreated = 0, custSkipped = 0, svcCreated = 0, svcSkipped = 0, pkgCreated = 0, pkgSkipped = 0, prodCreated = 0, prodSkipped = 0, staffCreated = 0, staffSkipped = 0, failed = 0;

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

                    // Excel'deki "İçerik" kolonu paketin kapsadığı hizmetleri taşır
                    // ("Lazer (8) + Cilt Bakımı (4)"). Varsa gerçek kalemler kurulur;
                    // yoksa eski davranış: paket adıyla aynı adlı tek kalem.
                    var itemRows = row.Items is { Count: > 0 }
                        ? row.Items.Where(i => !string.IsNullOrWhiteSpace(i.ServiceName)).ToArray()
                        : new[] { new ImportPackageItemRow(name, sessions) };

                    // Kalem başına birim fiyat: toplam, seanslara eşit dağıtılır (Excel birim fiyat taşımıyor).
                    var totalSessions = itemRows.Sum(i => i.SessionCount is > 0 ? i.SessionCount!.Value : 1);
                    var unitPrice = totalSessions > 0 ? Math.Round(total / totalSessions, 2) : total;

                    var items = new List<(Guid, int, decimal)>(itemRows.Length);
                    foreach (var item in itemRows)
                    {
                        var itemName = item.ServiceName.Trim();
                        var itemSessions = item.SessionCount is > 0 ? item.SessionCount!.Value : 1;

                        // Aynı adlı hizmet aranır; yoksa otomatik oluşturulur (aktarım yarıda kalmasın).
                        if (!serviceByName.TryGetValue(NormalizeName(itemName), out var svc))
                        {
                            svc = new ServiceDefinition(tenantId, null, itemName, 60, unitPrice, NullIfBlank(row.Category));
                            _db.ServiceDefinitions.Add(svc);
                            serviceByName[NormalizeName(itemName)] = svc;
                        }
                        items.Add((svc.Id, itemSessions, unitPrice));
                    }

                    var deposit = row.DepositAmount is >= 0 ? row.DepositAmount.Value : 0;
                    var installments = row.InstallmentCount is > 0 ? row.InstallmentCount.Value : 0;

                    var package = new ServicePackage(tenantId, null, name, total, deposit, installments, NullIfBlank(row.Description));
                    package.SetCategory(NullIfBlank(row.Category));
                    package.ReplaceItems(items);
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

        // ---- ÜRÜNLER (STOK) ----------------------------------------------------
        if (request.Products is { Count: > 0 })
        {
            // Mükerrer ölçütü: stok kodu (SKU) → yoksa ürün adı. Barkod tek başına
            // güvenilir değil (aynı ürünün farklı ambalajı aynı barkodu taşıyabiliyor).
            var existingProducts = await _db.Products.AsNoTracking()
                .Where(x => x.TenantId == tenantId)
                .Select(x => new { x.Name, x.Sku })
                .ToListAsync(cancellationToken);
            var existingSkus = new HashSet<string>(existingProducts.Select(x => NormalizeName(x.Sku)).Where(s => s.Length > 0));
            var existingProdNames = new HashSet<string>(existingProducts.Select(x => NormalizeName(x.Name)));

            foreach (var row in request.Products)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var name = (row.Name ?? string.Empty).Trim();
                    if (name.Length == 0) { failed++; continue; }

                    var sku = string.IsNullOrWhiteSpace(row.Sku) ? name : row.Sku!.Trim();
                    if (!existingSkus.Add(NormalizeName(sku)) || !existingProdNames.Add(NormalizeName(name)))
                    {
                        prodSkipped++;
                        continue;
                    }

                    var product = new Product(
                        tenantId,
                        request.BranchId,
                        name,
                        sku,
                        ParseProductCategory(row.Category),
                        string.IsNullOrWhiteSpace(row.Unit) ? "adet" : row.Unit!.Trim(),
                        row.Cost is >= 0 ? row.Cost.Value : 0,
                        row.SalePrice is >= 0 ? row.SalePrice.Value : 0,
                        row.CurrentStock is >= 0 ? row.CurrentStock.Value : 0,
                        row.MinStockLevel is >= 0 ? row.MinStockLevel.Value : 0);
                    product.SetBarcode(NullIfBlank(row.Barcode));
                    product.SetExtras(NullIfBlank(row.Brand), null, null, null, null, null);
                    _db.Products.Add(product);
                    prodCreated++;
                }
                catch (Exception ex)
                {
                    failed++;
                    if (errors.Count < 50) errors.Add($"Ürün satırı hatası: {ex.Message}");
                }
            }
        }

        // ---- PERSONEL ----------------------------------------------------------
        if (request.Staff is { Count: > 0 })
        {
            var limit = await _usage.CheckLimitAsync(tenantId, "staff", cancellationToken);
            if (limit.IsFailure) return Result<BulkImportResultDto>.Failure(limit.Error);

            // Ad şifreli olduğundan SQL'de karşılaştırılamaz — mevcutlar belleğe alınıp çözülmüş
            // değerler üzerinden mükerrer kontrolü yapılır (müşteri akışıyla aynı desen).
            var existingStaff = new HashSet<string>(
                (await _db.StaffMembers.AsNoTracking().Where(x => x.TenantId == tenantId).Select(x => x.FullName).ToListAsync(cancellationToken))
                    .Select(NormalizeName));

            foreach (var row in request.Staff)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var name = (row.FullName ?? string.Empty).Trim();
                    if (name.Length == 0) { failed++; continue; }
                    if (!existingStaff.Add(NormalizeName(name))) { staffSkipped++; continue; }

                    var title = string.IsNullOrWhiteSpace(row.Title) ? "Personel" : row.Title!.Trim();
                    var member = new StaffMember(tenantId, request.BranchId, name, title, NullIfBlank(row.Phone));
                    member.UpdateProfile(name, title, NullIfBlank(row.Phone), NullIfBlank(row.Specialties));
                    if (row.CommissionRate is >= 0) member.SetCommissionRate(row.CommissionRate.Value);
                    _db.StaffMembers.Add(member);
                    staffCreated++;
                }
                catch (Exception ex)
                {
                    failed++;
                    if (errors.Count < 50) errors.Add($"Personel satırı hatası: {ex.Message}");
                }
            }
        }

        await _db.SaveChangesAsync(cancellationToken);

        var totalCreated = custCreated + svcCreated + pkgCreated + prodCreated + staffCreated;
        await _audit.LogAsync(tenantId, request.BranchId, "Import", "DataImport", null,
            $"Excel içeri aktarma: {custCreated} müşteri, {svcCreated} hizmet, {pkgCreated} paket, {prodCreated} ürün, {staffCreated} personel eklendi ({custSkipped + svcSkipped + pkgSkipped + prodSkipped + staffSkipped} mükerrer atlandı, {failed} hatalı).",
            new { custCreated, svcCreated, pkgCreated, prodCreated, staffCreated, custSkipped, svcSkipped, pkgSkipped, prodSkipped, staffSkipped, failed }, cancellationToken);

        return Result<BulkImportResultDto>.Success(new BulkImportResultDto(
            custCreated, custSkipped, svcCreated, svcSkipped, pkgCreated, pkgSkipped, failed, errors, prodCreated, prodSkipped, staffCreated, staffSkipped));
    }

    /// <summary>
    /// Excel'deki serbest kategori metnini <see cref="ProductCategory"/>'ye çevirir.
    /// Tanınmayan değer <c>Other</c> olur — aktarım kategori yüzünden durmasın.
    /// </summary>
    private static ProductCategory ParseProductCategory(string? value)
    {
        var v = NormalizeName(value).Replace(" ", string.Empty);
        if (v.Length == 0) return ProductCategory.SkinCare; // stok sayfasının varsayılanı

        if (Enum.TryParse<ProductCategory>(v, ignoreCase: true, out var parsed)) return parsed;

        if (v.Contains("cilt") || v.Contains("skin")) return ProductCategory.SkinCare;
        if (v.Contains("sarf") || v.Contains("consum")) return ProductCategory.Consumable;
        if (v.Contains("sac") || v.Contains("saç") || v.Contains("hair")) return ProductCategory.HairCare;
        if (v.Contains("makyaj") || v.Contains("makeup")) return ProductCategory.Makeup;
        if (v.Contains("tirnak") || v.Contains("tırnak") || v.Contains("nail")) return ProductCategory.NailCare;
        if (v.Contains("satis") || v.Contains("satış") || v.Contains("sale")) return ProductCategory.Sale;
        return ProductCategory.Other;
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

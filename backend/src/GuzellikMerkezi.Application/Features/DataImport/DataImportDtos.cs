using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.DataImport;

/// <summary>Excel'den analiz edilip normalize edilmiş müşteri satırı.</summary>
public sealed record ImportCustomerRow(string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, string? Notes);

/// <summary>Excel'den analiz edilip normalize edilmiş hizmet satırı.</summary>
public sealed record ImportServiceRow(string Name, string? Category, int? DurationMinutes, decimal? Price, int? SessionCount);

/// <summary>Paket içeriğindeki tek hizmet ("Lazer Epilasyon (8)" parçasından çözülür).</summary>
public sealed record ImportPackageItemRow(string ServiceName, int? SessionCount);

/// <summary>Excel'den analiz edilip normalize edilmiş paket satırı.</summary>
/// <param name="Items">
/// Paketin kapsadığı hizmetler. Boş bırakılırsa paket adıyla aynı adlı tek kalemli
/// varsayılana düşülür (geriye uyumluluk).
/// </param>
public sealed record ImportPackageRow(
    string Name,
    string? Description,
    string? Category,
    decimal? TotalPrice,
    int? SessionCount,
    decimal? DepositAmount = null,
    int? InstallmentCount = null,
    IReadOnlyCollection<ImportPackageItemRow>? Items = null);

/// <summary>Excel'den analiz edilip normalize edilmiş ürün (stok) satırı.</summary>
public sealed record ImportProductRow(
    string Name,
    string? Sku,
    string? Barcode,
    string? Brand,
    string? Category,
    string? Unit,
    decimal? Cost,
    decimal? SalePrice,
    decimal? CurrentStock,
    decimal? MinStockLevel);

/// <summary>
/// Genel toplu içeri aktarma isteği — frontend Excel'i analiz eder, tespit ettiği
/// varlık tipine göre ilgili listeyi doldurur (tek istekte birden çok tip de olabilir).
/// </summary>
public sealed record BulkImportRequest(
    Guid BranchId = default, // boş = kurumun ilk şubesi (platform admin aktarımı)
    IReadOnlyCollection<ImportCustomerRow>? Customers = null,
    IReadOnlyCollection<ImportServiceRow>? Services = null,
    IReadOnlyCollection<ImportPackageRow>? Packages = null,
    IReadOnlyCollection<ImportProductRow>? Products = null);

public sealed record BulkImportResultDto(
    int CustomersCreated, int CustomersSkipped,
    int ServicesCreated, int ServicesSkipped,
    int PackagesCreated, int PackagesSkipped,
    int Failed,
    IReadOnlyCollection<string> Errors,
    int ProductsCreated = 0, int ProductsSkipped = 0);

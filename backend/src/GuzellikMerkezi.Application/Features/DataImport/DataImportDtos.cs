using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.DataImport;

/// <summary>Excel'den analiz edilip normalize edilmiş müşteri satırı.</summary>
public sealed record ImportCustomerRow(string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, string? Notes);

/// <summary>Excel'den analiz edilip normalize edilmiş hizmet satırı.</summary>
public sealed record ImportServiceRow(string Name, string? Category, int? DurationMinutes, decimal? Price, int? SessionCount);

/// <summary>Excel'den analiz edilip normalize edilmiş paket satırı.</summary>
public sealed record ImportPackageRow(string Name, string? Description, string? Category, decimal? TotalPrice, int? SessionCount);

/// <summary>
/// Genel toplu içeri aktarma isteği — frontend Excel'i analiz eder, tespit ettiği
/// varlık tipine göre ilgili listeyi doldurur (tek istekte birden çok tip de olabilir).
/// </summary>
public sealed record BulkImportRequest(
    Guid BranchId,
    IReadOnlyCollection<ImportCustomerRow>? Customers = null,
    IReadOnlyCollection<ImportServiceRow>? Services = null,
    IReadOnlyCollection<ImportPackageRow>? Packages = null);

public sealed record BulkImportResultDto(
    int CustomersCreated, int CustomersSkipped,
    int ServicesCreated, int ServicesSkipped,
    int PackagesCreated, int PackagesSkipped,
    int Failed,
    IReadOnlyCollection<string> Errors);

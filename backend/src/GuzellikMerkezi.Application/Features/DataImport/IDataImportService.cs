using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.DataImport;

public interface IDataImportService
{
    /// <summary>
    /// Excel'den analiz edilmiş satırları toplu kaydeder. Mükerrer kayıtlar (aynı telefon /
    /// aynı ad) atlanır, hatalı satırlar aktarımı durdurmaz — sonuç özetinde raporlanır.
    /// </summary>
    Task<Result<BulkImportResultDto>> ImportAsync(Guid tenantId, BulkImportRequest request, CancellationToken cancellationToken = default);
}

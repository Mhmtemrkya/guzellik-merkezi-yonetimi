using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CustomerAccounts;

public interface ICustomerAccountService
{
    /// <summary>
    /// Cari (satış) listesi. <paramref name="customerId"/> müşteri kartı için,
    /// <paramref name="serviceDefinitionId"/> / <paramref name="servicePackageId"/> ise katalog
    /// (hizmet / paket) kartındaki satış paneli için süzer. Süzgeç verildiğinde satırlar seans,
    /// kalem ve satış durumu ile zenginleştirilir.
    /// </summary>
    Task<Result<PagedResult<CustomerAccountDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default, Guid? customerId = null, Guid? serviceDefinitionId = null, Guid? servicePackageId = null);
    Task<Result<CustomerAccountDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> CreateAsync(Guid tenantId, CreateCustomerAccountRequest request, CancellationToken cancellationToken = default);

    /// <summary>Geçmiş yıllarda yapılmış satışı sisteme elle işler (tahsilat + taksit + kullanılmış seans dahil).</summary>
    Task<Result<CustomerAccountDto>> CreateHistoricalAsync(Guid tenantId, CreateHistoricalSaleRequest request, CancellationToken cancellationToken = default);

    /// <summary>Satışı iptal eder ve gerekçeyi kaydeder (finansal iz silinmez).</summary>
    Task<Result<CustomerAccountDto>> CancelSaleAsync(Guid tenantId, Guid id, CancelSaleRequest request, CancellationToken cancellationToken = default);

    /// <summary>Yanlış iptal edilen satışı geri alır.</summary>
    Task<Result<CustomerAccountDto>> RestoreSaleAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> UpdateAsync(Guid tenantId, Guid id, UpdateCustomerAccountRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAccountRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> RegisterPaymentAsync(Guid tenantId, Guid id, RegisterAccountPaymentRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Müşterinin paketlerindeki hizmet-bazlı kalan seans bakiyeleri.</summary>
    Task<Result<IReadOnlyCollection<CustomerPackageSessionDto>>> GetCustomerSessionsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Pano "Paket Raporu": paket satışı, yapılacak seans ve ay ay taksit takvimi.
    /// <paramref name="fromUtc"/>/<paramref name="toUtc"/> verilirse rapor, o aralıkta (satış tarihi =
    /// cari/adisyon oluşturma) açılmış paketlere göre süzülür (günlük/aylık/yıllık dönem filtresi).
    /// </summary>
    Task<Result<AccountReportDto>> GetReportAsync(Guid tenantId, int months, DateTime? fromUtc = null, DateTime? toUtc = null, CancellationToken cancellationToken = default);
}

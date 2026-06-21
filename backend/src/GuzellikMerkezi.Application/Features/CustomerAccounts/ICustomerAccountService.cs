using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CustomerAccounts;

public interface ICustomerAccountService
{
    Task<Result<PagedResult<CustomerAccountDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> CreateAsync(Guid tenantId, CreateCustomerAccountRequest request, CancellationToken cancellationToken = default);
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

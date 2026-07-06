using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Customers;

public interface ICustomerService
{
    Task<Result<PagedResult<CustomerDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<CustomerDto>> CreateAsync(Guid tenantId, UpsertCustomerRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomerRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    /// <summary>Onaylanmış paket/hizmet satışı olan müşteri Id'leri — yalnızca bunlara randevu verilebilir.</summary>
    Task<Result<IReadOnlyCollection<Guid>>> GetCustomerIdsWithApprovedSalesAsync(Guid tenantId, CancellationToken cancellationToken = default);
    /// <summary>Kalan (tükenmemiş) paket seansı olan müşteri Id'leri — yeni randevu modalı bunları listeler.</summary>
    Task<Result<IReadOnlyCollection<Guid>>> GetCustomerIdsWithBookableSessionsAsync(Guid tenantId, CancellationToken cancellationToken = default);

    /// <summary>Müşteriye VIP etiketi ekle / kaldır.</summary>
    Task<Result<CustomerDto>> SetVipAsync(Guid tenantId, Guid id, SetVipRequest request, CancellationToken cancellationToken = default);
    /// <summary>VIP müşteriler (şube-kapsamlı).</summary>
    Task<Result<PagedResult<CustomerDto>>> GetVipAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);

    /// <summary>Müşteriyi kara listeye al / çıkar (kara listedekiye randevu verilemez).</summary>
    Task<Result<CustomerDto>> SetBlacklistAsync(Guid tenantId, Guid id, SetBlacklistRequest request, CancellationToken cancellationToken = default);
    /// <summary>Kara listedeki müşteriler (şube-kapsamlı).</summary>
    Task<Result<PagedResult<CustomerDto>>> GetBlacklistedAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);
    /// <summary>Pasif müşteriler — eşik (gün) kadar süredir randevu/paket işlemi olmayanlar (şube-kapsamlı).</summary>
    Task<Result<PassiveCustomerListDto>> GetPassiveCustomersAsync(Guid tenantId, CancellationToken cancellationToken = default);
    /// <summary>Pasif müşteri eşiğini (gün) getirir/günceller — kurum geneli ayar.</summary>
    Task<Result<PassiveThresholdDto>> GetPassiveThresholdAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<Result<PassiveThresholdDto>> SetPassiveThresholdAsync(Guid tenantId, SetPassiveThresholdRequest request, CancellationToken cancellationToken = default);
}

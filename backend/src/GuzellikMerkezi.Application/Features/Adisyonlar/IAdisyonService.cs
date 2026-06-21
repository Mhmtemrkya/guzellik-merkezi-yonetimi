using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Adisyonlar;

public interface IAdisyonService
{
    Task<Result<PagedResult<AdisyonDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default);
    Task<Result<AdisyonDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Müşterinin açık (Open) adisyonunu döndürür; yoksa null.</summary>
    Task<Result<AdisyonDto?>> GetOpenForCustomerAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);

    Task<Result<AdisyonDto>> CreateAsync(Guid tenantId, CreateAdisyonRequest request, CancellationToken cancellationToken = default);
    Task<Result<AdisyonDto>> UpdateAsync(Guid tenantId, Guid id, UpdateAdisyonRequest request, CancellationToken cancellationToken = default);
    Task<Result<AdisyonDto>> AddItemAsync(Guid tenantId, Guid id, AddAdisyonItemRequest request, CancellationToken cancellationToken = default);
    Task<Result<AdisyonDto>> RemoveItemAsync(Guid tenantId, Guid id, Guid itemId, CancellationToken cancellationToken = default);

    /// <summary>Hediye çeki / kupon kodunu adisyona uygular: indirim kalemi ekler (onayda redeem edilir).</summary>
    Task<Result<AdisyonDto>> ApplyGiftCardAsync(Guid tenantId, Guid id, ApplyAdisyonGiftCardRequest request, CancellationToken cancellationToken = default);

    /// <summary>Adisyonu onaylar: charge kalemleri cariye borç, tahsilat cariye+kasaya, paket-kullanımı seanstan düşer.</summary>
    Task<Result<AdisyonDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<AdisyonDto>> CancelAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}

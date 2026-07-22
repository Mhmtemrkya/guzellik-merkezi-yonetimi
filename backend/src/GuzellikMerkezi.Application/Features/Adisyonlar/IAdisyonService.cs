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

    /// <summary>
    /// Adisyonu tamamen siler. Açık/İptal → doğrudan silinir. Onaylı → onayda oluşan tüm finansal
    /// kayıtlar (cari tahsilatı, prim, sadakat, stok, satılan seans, hediye çeki) geri alınıp silinir.
    /// Satılan seanslardan biri kullanılmışsa varsayılan olarak engellenir (AdisyonSessionUsed);
    /// <paramref name="force"/> = true ise kullanılmış seanslar korunur, kalan her şey geri alınıp silinir.
    /// </summary>
    Task<Result> DeleteAsync(Guid tenantId, Guid id, bool force = false, CancellationToken cancellationToken = default);

    /// <summary>Verilen UTC aralığındaki adisyon aktivitesi (günlük kart): kalem + tahsilat satırları ve toplamlar.</summary>
    Task<Result<DailyAdisyonDto>> GetDailyAsync(Guid tenantId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken = default);
}
    
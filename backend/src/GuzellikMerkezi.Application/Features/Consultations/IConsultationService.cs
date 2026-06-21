using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Consultations;

/// <summary>Müşteri bilgi ve onay formu — müşteri başına tek, upsert edilir.</summary>
public interface IConsultationService
{
    Task<Result<ConsultationFormDto?>> GetAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);
    Task<Result<ConsultationFormDto>> UpsertAsync(Guid tenantId, Guid customerId, UpsertConsultationRequest request, CancellationToken cancellationToken = default);

    /// <summary>"Özel" bölümü için kuruma + verilen şubeye ait aktif seçenekleri listeler (branchId null → yalnızca kurum geneli).</summary>
    Task<Result<IReadOnlyList<ConsultationOptionDto>>> ListOptionsAsync(Guid tenantId, Guid? branchId, CancellationToken cancellationToken = default);

    /// <summary>Özel seçenek tanımını siler (kütüphaneden kaldırır; geçmiş formlardaki anlık görüntüyü etkilemez).</summary>
    Task<Result> DeleteOptionAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
}

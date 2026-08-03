using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Appointments;

public interface IAppointmentService
{
    Task<Result<PagedResult<AppointmentDto>>> ListAsync(Guid tenantId, DateTime? fromUtc, DateTime? toUtc, PageRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null, Guid? customerId = null);
    Task<Result<AppointmentDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result<AppointmentDto>> CreateAsync(Guid tenantId, CreateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    /// <param name="returnToApproval">
    /// true ise randevu taşındıktan sonra yönetici onay kuyruğuna (Taslak) düşer — müşterinin
    /// online ertelemesi doğrudan takvime yazılmasın diye. Kilit + taze okuma protokolü bu
    /// serviste olduğu için portal da buradan geçer.
    /// </param>
    Task<Result<AppointmentDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null, bool returnToApproval = false);
    Task<Result<AppointmentDto>> ChangeStatusAsync(Guid tenantId, Guid id, ChangeAppointmentStatusRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);

    /// <summary>
    /// Randevuyu ve (verilirse) onu karşılayacak katalog satışını TEK transaction'da açar.
    /// Randevu açılamazsa satış da geri alınır (para bütünlüğü istemci çağrı zincirine bırakılmaz).
    /// </summary>
    Task<Result<AppointmentDto>> CreateWithSaleAsync(Guid tenantId, CreateAppointmentWithSaleRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);

    /// <summary>
    /// Randevuyu "Tamamlandı" yapar ve tahsilatı TEK transaction'da alır (biri düşerse ikisi de
    /// uygulanmaz). Tahsilat verilmezse yalnız durum değişir.
    /// </summary>
    Task<Result<AppointmentDto>> CompleteWithPaymentAsync(Guid tenantId, Guid id, CompleteAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    /// <summary>Kurum yöneticisi taslak randevuyu onaylar (Draft → Scheduled). Personel çağıramaz.</summary>
    Task<Result<AppointmentDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    /// <summary>Kurum yöneticisi aksiyon kutusu: saati gelmiş randevular + onay bekleyen taslaklar.</summary>
    Task<Result<AppointmentInboxDto>> GetInboxAsync(Guid tenantId, DateTime nowUtc, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result<AppointmentDto>> ChangeNotesAsync(Guid tenantId, Guid id, ChangeAppointmentNotesRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);

    /// <summary>
    /// Zaman + durum + notu TEK transaction'da günceller (bkz. <see cref="UpdateAppointmentRequest"/>).
    /// Adımlardan biri başarısız olursa hiçbiri kalıcı olmaz — yarım kaydedilmiş randevu kalmaz.
    /// </summary>
    Task<Result<AppointmentDto>> UpdateAsync(Guid tenantId, Guid id, UpdateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null);
}

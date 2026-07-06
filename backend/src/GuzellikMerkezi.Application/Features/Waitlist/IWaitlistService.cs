using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Waitlist;

public interface IWaitlistService
{
    Task<Result<IReadOnlyCollection<WaitlistEntryDto>>> ListAsync(Guid tenantId, bool? activeOnly, CancellationToken cancellationToken = default);
    Task<Result<WaitlistEntryDto>> CreateAsync(Guid tenantId, CreateWaitlistRequest request, CancellationToken cancellationToken = default);
    Task<Result<WaitlistEntryDto>> SetStatusAsync(Guid tenantId, Guid id, UpdateWaitlistStatusRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// İptal edilen randevunun slotunu bekleme listesindeki ilk (FIFO) uygun kayda teklif olarak işaretler
    /// (Notified). WhatsApp teklif mesajı gönderilebilsin diye seçilen kaydın Id'sini döner (yoksa null).
    /// Çağıran, iptali KAYDETTIKTEN sonra çağırmalı (overlap DB'den okunur).
    /// </summary>
    Task<Result<Guid?>> SelectAndMarkOfferAsync(Guid tenantId, Guid cancelledAppointmentId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Teklif kabul edildi → kayıttaki slotta yeni randevu (Scheduled) açar, kaydı Booked yapar.
    /// "Randevunuz aktifleşti" mesajı için oluşan randevunun Id'sini döner (açılamadıysa null).
    /// </summary>
    Task<Result<Guid?>> AcceptOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Teklif reddedildi → kaydı Cancelled yapar; aynı slot için sıradaki bekleyene teklif işaretler.
    /// Sıradaki kaydın Id'sini döner (yoksa null).
    /// </summary>
    Task<Result<Guid?>> DeclineOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken cancellationToken = default);
}

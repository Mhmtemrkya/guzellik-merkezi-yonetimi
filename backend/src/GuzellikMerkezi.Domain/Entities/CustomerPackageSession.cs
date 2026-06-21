using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Müşterinin satın aldığı bir paketteki <b>hizmet-bazlı</b> seans bakiyesi.
/// Paket satışında (cari hesap açılırken) her paket item'ı için bir kayıt açılır;
/// ilgili hizmetin randevusu Tamamlandı olunca <see cref="TryConsume"/> ile bir seans düşer.
/// </summary>
public sealed class CustomerPackageSession : Entity
{
    private CustomerPackageSession() { }

    public CustomerPackageSession(
        Guid tenantId,
        Guid customerId,
        Guid customerAccountId,
        Guid servicePackageId,
        Guid serviceDefinitionId,
        int totalSessions)
    {
        if (totalSessions < 0) throw new DomainException("Seans sayısı negatif olamaz.");
        TenantId = tenantId;
        CustomerId = customerId;
        CustomerAccountId = customerAccountId;
        ServicePackageId = servicePackageId;
        ServiceDefinitionId = serviceDefinitionId;
        TotalSessions = totalSessions;
        UsedSessions = 0;
    }

    public Guid TenantId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Guid CustomerAccountId { get; private set; }
    public CustomerAccount? CustomerAccount { get; private set; }
    public Guid ServicePackageId { get; private set; }
    public Guid ServiceDefinitionId { get; private set; }
    public ServiceDefinition? ServiceDefinition { get; private set; }
    public int TotalSessions { get; private set; }
    public int UsedSessions { get; private set; }

    public int RemainingSessions => Math.Max(0, TotalSessions - UsedSessions);

    /// <summary>Kalan seans varsa bir seans tüketir ve true döner; yoksa false.</summary>
    public bool TryConsume()
    {
        if (RemainingSessions <= 0) return false;
        UsedSessions++;
        Touch();
        return true;
    }

    /// <summary>Yanlış düşülen seansı geri alır (randevu iptal/geri alma senaryoları için).</summary>
    public void RestoreOne()
    {
        if (UsedSessions > 0)
        {
            UsedSessions--;
            Touch();
        }
    }
}

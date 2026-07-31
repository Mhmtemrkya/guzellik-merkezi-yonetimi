namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// HANGİ ADİSYON KALEMİ, HANGİ PAKET SEANSINDAN, KAÇ ADET TÜKETTİ.
///
/// <para>
/// Adisyon onayı "paketten kullan" kalemini müşterinin EN ESKİ uygun paketinden düşüyordu; iptalde
/// ise ters kayıt "aynı hizmet için EN SON güncellenmiş kullanılmış seans"ı geri kredileyerek TAHMİN
/// yapıyordu. Müşterinin aynı hizmeti içeren birden çok paketi varsa A paketinden düşen seans B
/// paketine geri yazılabiliyor, üstelik yanlış SessionId yedeğe girdiği için geri alma hatayı
/// kalıcılaştırıyordu.
/// </para>
///
/// <para>
/// Bu kayıt tahmini bitirir: tüketim ANINDA (AdisyonItem → CustomerPackageSession) bağı kurulur;
/// iptal/geri alma yalnız bu bağı okur.
/// </para>
/// </summary>
public sealed class PackageSessionUsage : Entity
{
    private PackageSessionUsage() { }

    public PackageSessionUsage(
        Guid tenantId,
        Guid adisyonId,
        Guid adisyonItemId,
        Guid customerPackageSessionId,
        Guid customerId,
        Guid serviceDefinitionId,
        int quantity,
        DateTime consumedAtUtc)
    {
        TenantId = tenantId;
        AdisyonId = adisyonId;
        AdisyonItemId = adisyonItemId;
        CustomerPackageSessionId = customerPackageSessionId;
        CustomerId = customerId;
        ServiceDefinitionId = serviceDefinitionId;
        Quantity = quantity < 1 ? 1 : quantity;
        ConsumedAtUtc = consumedAtUtc.Kind == DateTimeKind.Utc
            ? consumedAtUtc
            : DateTime.SpecifyKind(consumedAtUtc, DateTimeKind.Utc);
    }

    public Guid TenantId { get; private set; }
    public Guid AdisyonId { get; private set; }
    public Guid AdisyonItemId { get; private set; }

    /// <summary>Seansın düşürüldüğü KESİN paket bakiyesi. FK verilmez: satış iptalinde seans satırı silinir.</summary>
    public Guid CustomerPackageSessionId { get; private set; }

    public Guid CustomerId { get; private set; }
    public Guid ServiceDefinitionId { get; private set; }

    /// <summary>Bu seans bakiyesinden düşen adet (bir kalem birden çok paketten düşebilir → birden çok satır).</summary>
    public int Quantity { get; private set; }

    public DateTime ConsumedAtUtc { get; private set; }

    /// <summary>Bir adet daha aynı bakiyeden düşüldüğünde satırı çoğaltmak yerine sayacı artırır.</summary>
    public void Increase(int by = 1)
    {
        if (by <= 0) return;
        Quantity += by;
        Touch();
    }
}

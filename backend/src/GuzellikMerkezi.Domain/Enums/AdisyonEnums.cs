namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Adisyon (açık hesap fişi) durumu. Yalnızca onaylanan adisyon cariye + kasaya aktarılır.</summary>
public enum AdisyonStatus
{
    Open = 0,
    Approved = 1,
    Cancelled = 2,
}

/// <summary>Adisyon kalemi türü — onayda her tür farklı şekilde cariye/kasaya/sesansa işler.</summary>
public enum AdisyonItemType
{
    /// <summary>Verilen hizmet — cariye borç yazar (paketten karşılanmıyorsa).</summary>
    Service = 0,
    /// <summary>Satılan ürün — cariye borç yazar + stok düşer.</summary>
    Product = 1,
    /// <summary>Paketten seans kullanımı — cariye borç YAZMAZ, müşterinin paket seansından düşer.</summary>
    PackageUse = 2,
    /// <summary>Manuel/ek kalem — cariye borç yazar.</summary>
    Extra = 3,
    /// <summary>Tahsilat — onayda cariye RegisterPayment + kasaya gelir olur.</summary>
    Payment = 4,
    /// <summary>İndirim — toplam borçtan düşer.</summary>
    Discount = 5,
    /// <summary>Paket satışı — cariye borç yazar + onayda müşteriye paket seans bakiyesi açılır.</summary>
    PackageSale = 6,
}

namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// Güzellik merkezi ürün kategorileri.
/// </summary>
public enum ProductCategory
{
    /// <summary>Cilt bakım ürünleri (serum, krem, maske vb.)</summary>
    SkinCare = 0,
    /// <summary>Sarf malzeme (eldiven, dezenfektan, kağıt havlu vb.)</summary>
    Consumable = 1,
    /// <summary>Satış ürünleri (müşteriye satılan kozmetikler)</summary>
    Sale = 2,
    /// <summary>Saç bakım ürünleri</summary>
    HairCare = 3,
    /// <summary>Makyaj ürünleri</summary>
    Makeup = 4,
    /// <summary>Tırnak bakım ürünleri</summary>
    NailCare = 5,
    /// <summary>Diğer</summary>
    Other = 99,
}

public enum StockMovementType
{
    /// <summary>Tedarikçiden giriş (alım)</summary>
    Inbound = 0,
    /// <summary>İç kullanım çıkışı (sarf)</summary>
    Outbound = 1,
    /// <summary>Müşteriye satış</summary>
    Sale = 2,
    /// <summary>Manuel sayım/düzeltme</summary>
    Adjustment = 3,
    /// <summary>Bozulma / fire</summary>
    Damage = 4,
}

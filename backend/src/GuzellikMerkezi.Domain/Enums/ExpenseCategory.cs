namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// Güzellik merkezi gider kalemleri. Türk muhasebe pratiğine göre sık kullanılan ana kategoriler.
/// </summary>
public enum ExpenseCategory
{
    /// <summary>Personel maaşı, prim, ikramiye, avans</summary>
    Salary = 0,
    /// <summary>SGK primi, vergi, stopaj</summary>
    Tax = 1,
    /// <summary>Kira (şube/depo)</summary>
    Rent = 2,
    /// <summary>Elektrik, su, doğalgaz, internet</summary>
    Utilities = 3,
    /// <summary>Sarf malzeme (eldiven, dezenfektan, vb.)</summary>
    Supplies = 4,
    /// <summary>Cilt bakım ürün alımı, kozmetik stok</summary>
    Inventory = 5,
    /// <summary>Reklam, sosyal medya, dijital pazarlama</summary>
    Marketing = 6,
    /// <summary>Demirbaş bakım onarım, makine servisi</summary>
    Maintenance = 7,
    /// <summary>Muhasebe, danışmanlık, hukuk</summary>
    Professional = 8,
    /// <summary>Demirbaş alımı (makine, mobilya)</summary>
    Equipment = 9,
    /// <summary>Yiyecek içecek, ofis sarfı</summary>
    Office = 10,
    /// <summary>Diğer</summary>
    Other = 99,
}

public enum ExpensePaymentMethod
{
    Cash = 0,
    Card = 1,
    BankTransfer = 2,
    Check = 3,
}
